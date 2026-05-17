/**
 * RouteGuard MCP Server
 *
 * Exposes two tools to MCP clients (Claude Desktop, Cursor, VS Code):
 *
 *   analyze_file        — run deterministic ESLint rules on a file
 *   ai_analyze_route    — run AI agent (Granite 3.3 2B) for OWASP rules
 *                         that deterministic analysis cannot reliably catch
 *
 * Protocol: Model Context Protocol (stdio transport)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { isModelReady, MODEL_PATH } from './agent/granite';
import { analyzeRoute, type AIRuleName } from './agent/loop';
import { readFile } from './agent/tools';

// ─── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'routeguard', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// ─── Tool schemas ─────────────────────────────────────────────────────────────

const AnalyzeFileSchema = z.object({
  filePath: z.string().describe('Absolute or project-relative path to a JS/TS route file'),
  projectRoot: z.string().optional().describe('Project root directory (default: cwd)'),
});

const AI_RULES = ['API2', 'API5', 'API6', 'API8', 'API9', 'API10'] as const;

const AIAnalyzeRouteSchema = z.object({
  filePath: z.string().describe('Path to the route file to analyze'),
  route: z.string().optional().describe('Specific route e.g. "GET /orders/:id" (default: all routes in file)'),
  rules: z
    .array(z.enum(AI_RULES))
    .optional()
    .describe('Which AI rules to run (default: all 6)'),
  projectRoot: z.string().optional().describe('Project root directory (default: cwd)'),
  maxSteps: z
    .number()
    .int()
    .min(1)
    .max(15)
    .optional()
    .describe('Max ReAct steps per rule (default: 10)'),
});

// ─── List tools ───────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'analyze_file',
      description:
        'Run RouteGuard deterministic security analysis on a Node.js route file. ' +
        'Detects BOLA/IDOR, mass-assignment, SSRF, SQL injection, command injection, ' +
        'path traversal, open redirect, and hardcoded secrets using static taint analysis.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the route file' },
          projectRoot: { type: 'string', description: 'Project root directory (default: cwd)' },
        },
        required: ['filePath'],
      },
    },
    {
      name: 'ai_analyze_route',
      description:
        'Run the Granite 3.3 2B AI agent to analyze a route for OWASP API Top 10 issues ' +
        'that deterministic analysis cannot catch: broken authentication (API2), ' +
        'broken function-level authorization (API5), business flow abuse (API6), ' +
        'security misconfiguration (API8), inventory drift (API9), and unsafe API ' +
        'consumption (API10). Requires the model to be downloaded first (routeguard setup). ' +
        'Results are always severity: warning. Takes 30s–4min depending on complexity.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the route file to analyze' },
          route: { type: 'string', description: 'Specific route e.g. "GET /orders/:id"' },
          rules: {
            type: 'array',
            items: { type: 'string', enum: AI_RULES },
            description: 'Which rules to run (default: all 6)',
          },
          projectRoot: { type: 'string', description: 'Project root (default: cwd)' },
          maxSteps: { type: 'number', description: 'Max investigation steps per rule (1–15, default 10)' },
        },
        required: ['filePath'],
      },
    },
  ],
}));

// ─── Call tool ────────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'analyze_file') {
    return handleAnalyzeFile(args as z.infer<typeof AnalyzeFileSchema>);
  }

  if (name === 'ai_analyze_route') {
    return handleAIAnalyzeRoute(args as z.infer<typeof AIAnalyzeRouteSchema>);
  }

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// ─── analyze_file handler ─────────────────────────────────────────────────────

async function handleAnalyzeFile(
  args: z.infer<typeof AnalyzeFileSchema>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const projectRoot = args.projectRoot ?? process.cwd();
  const filePath = resolvePath(args.filePath, projectRoot);

  try {
    // Run ESLint programmatically on the file
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({
      overrideConfigFile: undefined,
      useEslintrc: false,
      baseConfig: {
        plugins: ['routeguard'],
        rules: {
          'routeguard/no-bola': 'error',
          'routeguard/no-mass-assignment': 'error',
          'routeguard/no-ssrf': 'error',
          'routeguard/no-sql-injection': 'error',
          'routeguard/no-command-injection': 'error',
          'routeguard/no-path-traversal': 'error',
          'routeguard/no-open-redirect': 'error',
          'routeguard/no-hardcoded-secrets': 'error',
        },
      },
    });

    const results = await eslint.lintFiles([filePath]);
    const findings = results.flatMap(r =>
      r.messages
        .filter(m => m.ruleId?.startsWith('routeguard/'))
        .map(m => ({
          rule: m.ruleId,
          line: m.line,
          column: m.column,
          severity: m.severity === 2 ? 'error' : 'warning',
          message: m.message,
        }))
    );

    const text =
      findings.length === 0
        ? `No security findings in ${args.filePath}`
        : `Found ${findings.length} security issue${findings.length !== 1 ? 's' : ''} in ${args.filePath}:\n\n` +
          findings
            .map(f => `  [${f.severity.toUpperCase()}] ${f.rule}  line ${f.line}:${f.column}\n  ${f.message}`)
            .join('\n\n');

    return { content: [{ type: 'text', text }] };
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: `Analysis failed: ${String(err)}\n\nMake sure @felix-neuro/eslint-plugin-routeguard is installed.`,
        },
      ],
    };
  }
}

// ─── ai_analyze_route handler ─────────────────────────────────────────────────

async function handleAIAnalyzeRoute(
  args: z.infer<typeof AIAnalyzeRouteSchema>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Check model availability first
  if (!isModelReady()) {
    const setupText =
      `Model not found at ${MODEL_PATH}\n\n` +
      `Run the setup command to download Granite 3.3 2B (~1.5GB):\n` +
      `  routeguard setup\n\n` +
      `Returns { modelReady: false } — no error thrown.`;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            modelReady: false,
            findings: [],
            message: setupText,
          }),
        },
      ],
    };
  }

  const projectRoot = args.projectRoot ?? process.cwd();
  const filePath = resolvePath(args.filePath, projectRoot);
  const rules = (args.rules ?? [...AI_RULES]) as AIRuleName[];
  const route = args.route ?? extractFirstRoute(filePath);
  const maxSteps = args.maxSteps ?? 10;

  const allFindings = [];
  let totalSteps = 0;
  const startTime = Date.now();

  for (const rule of rules) {
    process.stderr.write(`[routeguard-agent] analyzing ${rule} for ${route ?? 'all routes'}...\n`);
    try {
      const { finding, stepsUsed, durationMs } = await analyzeRoute(
        rule,
        filePath,
        route ?? `(file: ${args.filePath})`,
        projectRoot,
        maxSteps
      );
      totalSteps += stepsUsed;
      process.stderr.write(`[routeguard-agent] ${rule} done in ${durationMs}ms (${stepsUsed} steps)\n`);
      if (finding) allFindings.push(finding);
    } catch (err) {
      process.stderr.write(`[routeguard-agent] ${rule} error: ${String(err)}\n`);
    }
  }

  const result = {
    modelReady: true,
    findings: allFindings,
    stepsUsed: totalSteps,
    durationMs: Date.now() - startTime,
    modelUsed: 'granite-3.3-2b-instruct-Q4_K_M',
    rulesRun: rules,
  };

  const text =
    allFindings.length === 0
      ? `No AI security findings for route "${route}" in ${args.filePath}.\n\n${JSON.stringify(result, null, 2)}`
      : `Found ${allFindings.length} potential issue${allFindings.length !== 1 ? 's' : ''}:\n\n` +
        allFindings
          .map(
            f =>
              `[${f.confidence.toUpperCase()} confidence] ${f.rule}: ${f.evidence}\n` +
              `  ${f.reasoning}\n` +
              `  → ${f.suggestedReview}`
          )
          .join('\n\n') +
        `\n\n${JSON.stringify(result, null, 2)}`;

  return { content: [{ type: 'text', text }] };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolvePath(filePath: string, projectRoot: string): string {
  if (filePath.startsWith('/') || filePath.match(/^[A-Z]:\\/)) return filePath;
  return `${projectRoot}/${filePath}`;
}

function extractFirstRoute(filePath: string): string {
  const content = readFile(filePath, { maxLines: 50 });
  const match = content.match(/\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)/i);
  if (match) return `${match[1].toUpperCase()} ${match[2]}`;
  return '(unknown route)';
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[routeguard-mcp] Server started. Waiting for MCP client...\n');
}

main().catch(err => {
  process.stderr.write(`[routeguard-mcp] Fatal: ${String(err)}\n`);
  process.exit(1);
});
