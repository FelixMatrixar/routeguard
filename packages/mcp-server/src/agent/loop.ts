/**
 * ReAct agent loop for RouteGuard AI security analysis.
 *
 * Decision call (≤400 tokens): do I have enough context? if not, what tool to call?
 * Judgment call (≤600 tokens): given all evidence, is this vulnerable?
 *
 * Context management:
 * - Evidence is summarized when it exceeds TOKEN_BUDGET characters
 * - File contents are referenced by filename after first read (no duplication)
 */

import { think } from './granite';
import {
  readFile,
  listDirectory,
  findFiles,
  searchCode,
  resolveImport,
  findSymbolDefinition,
  type SearchResult,
} from './tools';
import {
  BROKEN_AUTH_SKILL,
  BROKEN_AUTH_OUTPUT_SCHEMA,
} from './knowledge/broken-auth';
import {
  FUNCTION_AUTH_SKILL,
  FUNCTION_AUTH_OUTPUT_SCHEMA,
} from './knowledge/function-auth';
import {
  SECURITY_CONFIG_SKILL,
  SECURITY_CONFIG_OUTPUT_SCHEMA,
} from './knowledge/security-config';
import {
  API_CONSUMPTION_SKILL,
  API_CONSUMPTION_OUTPUT_SCHEMA,
} from './knowledge/api-consumption';
import {
  BUSINESS_FLOW_SKILL,
  BUSINESS_FLOW_OUTPUT_SCHEMA,
} from './knowledge/business-flow';
import {
  INVENTORY_SKILL,
  INVENTORY_OUTPUT_SCHEMA,
} from './knowledge/inventory';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AIRuleName = 'API2' | 'API5' | 'API6' | 'API8' | 'API9' | 'API10';

export interface AIFinding {
  rule: AIRuleName;
  route: string;
  confidence: 'high' | 'medium' | 'low';
  severity: 'warning';
  evidence: string;
  reasoning: string;
  suggestedReview: string;
}

interface EvidenceEntry {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

interface AgentContext {
  goal: string;
  filePath: string;
  route: string;
  evidence: EvidenceEntry[];
  filesRead: Set<string>;
}

interface DecisionOutput {
  action: 'TOOL' | 'CONCLUDE';
  tool?: string;
  args?: Record<string, unknown>;
  reasoning?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKEN_BUDGET = 3000; // chars; summarize evidence above this

const SKILL_MAP: Record<AIRuleName, { systemPrompt: string; schema: Record<string, unknown> }> = {
  API2:  { systemPrompt: BROKEN_AUTH_SKILL,     schema: BROKEN_AUTH_OUTPUT_SCHEMA },
  API5:  { systemPrompt: FUNCTION_AUTH_SKILL,   schema: FUNCTION_AUTH_OUTPUT_SCHEMA },
  API6:  { systemPrompt: BUSINESS_FLOW_SKILL,   schema: BUSINESS_FLOW_OUTPUT_SCHEMA },
  API8:  { systemPrompt: SECURITY_CONFIG_SKILL, schema: SECURITY_CONFIG_OUTPUT_SCHEMA },
  API9:  { systemPrompt: INVENTORY_SKILL,       schema: INVENTORY_OUTPUT_SCHEMA },
  API10: { systemPrompt: API_CONSUMPTION_SKILL, schema: API_CONSUMPTION_OUTPUT_SCHEMA },
};

// ─── Loop entry point ─────────────────────────────────────────────────────────

export async function analyzeRoute(
  rule: AIRuleName,
  filePath: string,
  route: string,
  projectRoot: string,
  maxSteps = 10
): Promise<{ finding: AIFinding | null; stepsUsed: number; durationMs: number }> {
  const start = Date.now();
  const skill = SKILL_MAP[rule];

  const initialContent = readFile(filePath, { maxLines: 150 });
  const ctx: AgentContext = {
    goal: `Analyze route "${route}" in file "${filePath}" for ${rule} (${ruleTitle(rule)}).`,
    filePath,
    route,
    evidence: [{ tool: 'read_file', args: { filePath }, result: initialContent }],
    filesRead: new Set([filePath]),
  };

  let stepsUsed = 0;
  while (stepsUsed < maxSteps) {
    stepsUsed++;

    const decisionPrompt = buildDecisionPrompt(ctx);
    const decisionRaw = await think({
      systemPrompt: skill.systemPrompt,
      userPrompt: decisionPrompt,
      maxTokens: 400,
    });

    const decision = parseDecision(decisionRaw);
    process.stderr.write(`[agent:${rule}] step ${stepsUsed} → ${decision.action}${decision.tool ? `:${decision.tool}` : ''}\n`);

    if (decision.action === 'CONCLUDE' || !decision.tool) {
      const judgmentPrompt = buildJudgmentPrompt(ctx, rule);
      const judgmentRaw = await think({
        systemPrompt: skill.systemPrompt,
        userPrompt: judgmentPrompt,
        maxTokens: 600,
      });
      const finding = parseJudgment(judgmentRaw, rule, route);
      return { finding, stepsUsed, durationMs: Date.now() - start };
    }

    const toolResult = await executeTool(decision.tool, decision.args ?? {}, projectRoot, ctx);
    ctx.evidence.push({ tool: decision.tool, args: decision.args ?? {}, result: toolResult });

    // Summarize evidence if too large
    if (evidenceLength(ctx) > TOKEN_BUDGET) {
      summarizeEvidence(ctx);
    }
  }

  // Step cap — return low confidence
  const finding: AIFinding = {
    rule,
    route,
    confidence: 'low',
    severity: 'warning',
    evidence: 'Analysis incomplete — step cap reached.',
    reasoning: `Reached maximum ${maxSteps} steps without a definitive conclusion. The codebase may be too complex for automated analysis.`,
    suggestedReview: `Manually review ${filePath} for ${ruleTitle(rule)} issues.`,
  };
  return { finding, stepsUsed, durationMs: Date.now() - start };
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildDecisionPrompt(ctx: AgentContext): string {
  const evidenceSummary = ctx.evidence
    .map(e => `[${e.tool}(${JSON.stringify(e.args)})]\n${e.result.slice(0, 400)}`)
    .join('\n\n---\n\n');

  return `Goal: ${ctx.goal}

Evidence gathered so far:
${evidenceSummary}

Based on this evidence, decide:
1. Do you have enough information to reach a conclusion?
2. If not, which tool should you call next and with what arguments?

Available tools:
- read_file(filePath, startLine?, maxLines?) — read a source file
- list_directory(dirPath) — list files in a directory
- find_files(pattern, rootDir) — glob search for files
- search_code(query, filePattern?, rootDir?, maxResults?) — search for code patterns
- resolve_import(importPath, fromFile) — find where an import resolves to
- find_symbol_definition(symbolName, rootDir) — find where a symbol is defined

Respond with JSON only:
{ "action": "TOOL" | "CONCLUDE", "tool": "tool_name", "args": {...}, "reasoning": "why" }

If CONCLUDE: set tool to null/omit it.`;
}

function buildJudgmentPrompt(ctx: AgentContext, rule: AIRuleName): string {
  const evidenceSummary = ctx.evidence
    .map(e => `[${e.tool}]\n${e.result.slice(0, 500)}`)
    .join('\n\n---\n\n');

  return `Goal: ${ctx.goal}

All evidence gathered:
${evidenceSummary}

Based on all evidence above, provide your final security judgment.
Respond with the JSON schema defined in your system prompt. JSON only — no prose.`;
}

// ─── Tool executor ────────────────────────────────────────────────────────────

async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  projectRoot: string,
  ctx: AgentContext
): Promise<string> {
  try {
    switch (toolName) {
      case 'read_file': {
        const fp = String(args['filePath'] ?? '');
        const absPath = fp.startsWith('/') || fp.match(/^[A-Z]:\\/) ? fp : `${projectRoot}/${fp}`;
        if (ctx.filesRead.has(absPath)) {
          return `[already read — see earlier evidence for ${absPath}]`;
        }
        ctx.filesRead.add(absPath);
        return readFile(absPath, {
          maxLines: Number(args['maxLines'] ?? 200),
          startLine: Number(args['startLine'] ?? 1),
        });
      }
      case 'list_directory': {
        const dir = String(args['dirPath'] ?? projectRoot);
        const absDir = dir.startsWith('/') || dir.match(/^[A-Z]:\\/) ? dir : `${projectRoot}/${dir}`;
        const entries = listDirectory(absDir);
        return JSON.stringify(entries, null, 2);
      }
      case 'find_files': {
        const pattern = String(args['pattern'] ?? '**/*.ts');
        const root = String(args['rootDir'] ?? projectRoot);
        const files = await findFiles(pattern, root);
        return files.join('\n');
      }
      case 'search_code': {
        const results: SearchResult[] = searchCode(String(args['query'] ?? ''), {
          filePattern: args['filePattern'] as string | undefined,
          rootDir: String(args['rootDir'] ?? projectRoot),
          maxResults: Number(args['maxResults'] ?? 20),
        });
        if (results.length === 0) return '[no matches found]';
        return results
          .map(r => `${r.file}:${r.line}\n${r.snippet}`)
          .join('\n\n');
      }
      case 'resolve_import': {
        const resolved = resolveImport(
          String(args['importPath'] ?? ''),
          String(args['fromFile'] ?? ctx.filePath)
        );
        return resolved ?? '[not found]';
      }
      case 'find_symbol_definition': {
        const results = findSymbolDefinition(
          String(args['symbolName'] ?? ''),
          String(args['rootDir'] ?? projectRoot)
        );
        if (results.length === 0) return '[symbol not found]';
        return results.map(r => `${r.file}:${r.line}\n${r.snippet}`).join('\n\n');
      }
      default:
        return `[unknown tool: ${toolName}]`;
    }
  } catch (err) {
    return `[tool error: ${String(err)}]`;
  }
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseDecision(raw: string): DecisionOutput {
  const json = extractJSON(raw);
  if (!json) return { action: 'CONCLUDE' };
  try {
    const parsed = JSON.parse(json) as DecisionOutput;
    if (parsed.action === 'TOOL' && parsed.tool) return parsed;
    return { action: 'CONCLUDE' };
  } catch {
    return { action: 'CONCLUDE' };
  }
}

function parseJudgment(raw: string, rule: AIRuleName, route: string): AIFinding | null {
  const json = extractJSON(raw);
  if (!json) return null;

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const confidence = (['high', 'medium', 'low'].includes(String(parsed['confidence']))
      ? parsed['confidence']
      : 'low') as 'high' | 'medium' | 'low';

    return buildFinding(rule, route, confidence, parsed);
  } catch {
    return null;
  }
}

function buildFinding(
  rule: AIRuleName,
  route: string,
  confidence: 'high' | 'medium' | 'low',
  parsed: Record<string, unknown>
): AIFinding | null {
  switch (rule) {
    case 'API2':
      if (parsed['hasAuthentication'] === true) return null;
      return {
        rule, route, confidence, severity: 'warning',
        evidence: String(parsed['evidence'] ?? ''),
        reasoning: String(parsed['reasoning'] ?? ''),
        suggestedReview: String(parsed['missingGuard'] ?? 'Add authentication middleware.'),
      };
    case 'API5':
      if (parsed['hasRoleCheck'] === true) return null;
      return {
        rule, route, confidence, severity: 'warning',
        evidence: String(parsed['evidence'] ?? ''),
        reasoning: String(parsed['reasoning'] ?? ''),
        suggestedReview: String(parsed['missingGuard'] ?? 'Add role/permission check.'),
      };
    case 'API6':
      if (!parsed['hasSensitiveFlow'] || parsed['hasAbusePrevention'] === true) return null;
      return {
        rule, route, confidence, severity: 'warning',
        evidence: String(parsed['evidence'] ?? ''),
        reasoning: String(parsed['reasoning'] ?? ''),
        suggestedReview: String(parsed['missingPrevention'] ?? 'Add rate limiting or CAPTCHA.'),
      };
    case 'API8': {
      const misconfigs = Array.isArray(parsed['misconfigurations']) ? parsed['misconfigurations'] : [];
      if (misconfigs.length === 0) return null;
      return {
        rule, route, confidence, severity: 'warning',
        evidence: misconfigs.map((m: Record<string, unknown>) => String(m['type'] ?? '')).join(', '),
        reasoning: String(parsed['reasoning'] ?? ''),
        suggestedReview: misconfigs.map((m: Record<string, unknown>) => String(m['suggestedFix'] ?? '')).join('; '),
      };
    }
    case 'API9': {
      const issues = Array.isArray(parsed['issues']) ? parsed['issues'] : [];
      if (issues.length === 0) return null;
      return {
        rule, route, confidence, severity: 'warning',
        evidence: issues.map((i: Record<string, unknown>) => String(i['type'] ?? '')).join(', '),
        reasoning: String(parsed['reasoning'] ?? ''),
        suggestedReview: 'Audit API versioning and remove debug/test endpoints.',
      };
    }
    case 'API10':
      if (parsed['hasUnsafeConsumption'] !== true) return null;
      return {
        rule, route, confidence, severity: 'warning',
        evidence: String(parsed['evidence'] ?? ''),
        reasoning: String(parsed['reasoning'] ?? ''),
        suggestedReview: 'Validate external API responses with a schema (zod, joi, yup) before use.',
      };
    default:
      return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractJSON(text: string): string | null {
  // Find first { and last } to extract embedded JSON
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + 1);
}

function evidenceLength(ctx: AgentContext): number {
  return ctx.evidence.reduce((acc, e) => acc + e.result.length, 0);
}

function summarizeEvidence(ctx: AgentContext): void {
  // Keep the first entry (initial file read) and the last 3 entries
  if (ctx.evidence.length <= 4) return;
  const first = ctx.evidence[0];
  const recent = ctx.evidence.slice(-3);
  const skipped = ctx.evidence.length - 4;
  ctx.evidence = [
    first,
    { tool: '[summary]', args: {}, result: `[${skipped} earlier steps omitted to save context]` },
    ...recent,
  ];
}

function ruleTitle(rule: AIRuleName): string {
  const titles: Record<AIRuleName, string> = {
    API2: 'Broken Authentication',
    API5: 'Broken Function Level Authorization',
    API6: 'Business Flow Abuse',
    API8: 'Security Misconfiguration',
    API9: 'Improper Inventory Management',
    API10: 'Unsafe API Consumption',
  };
  return titles[rule];
}
