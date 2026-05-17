/**
 * Investigation tools available to the ReAct agent.
 *
 * Each tool is designed to be repo-agnostic: no assumed paths, no assumed
 * naming conventions. The agent uses search_code to locate patterns wherever
 * they happen to live.
 *
 * Tool list:
 *   read_file          — read a file (up to maxLines)
 *   list_directory     — list files and subdirs in a directory
 *   find_files         — glob pattern match
 *   search_code        — grep for a pattern (ripgrep if available, else fallback)
 *   resolve_import     — resolve an import path to an absolute file path
 *   find_symbol_definition — find where a function/class/const is defined
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, resolve, dirname, extname } from 'path';
import { execSync } from 'child_process';
import { glob } from 'glob';

// Detect ripgrep once at module load
let ripgrepAvailable: boolean | null = null;
function hasRipgrep(): boolean {
  if (ripgrepAvailable !== null) return ripgrepAvailable;
  try {
    execSync('rg --version', { stdio: 'pipe' });
    ripgrepAvailable = true;
  } catch {
    ripgrepAvailable = false;
    process.stderr.write('[routeguard-agent] ripgrep not found — using slower fallback search\n');
  }
  return ripgrepAvailable;
}

// ─── Tool result types ────────────────────────────────────────────────────────

export interface SearchResult {
  file: string;
  line: number;
  snippet: string; // 3-line context around the match
}

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
}

// ─── Tool implementations ─────────────────────────────────────────────────────

export function readFile(
  filePath: string,
  options: { maxLines?: number; startLine?: number } = {}
): string {
  const { maxLines = 200, startLine = 1 } = options;
  if (!existsSync(filePath)) return `[Error: file not found: ${filePath}]`;

  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const slice = lines.slice(startLine - 1, startLine - 1 + maxLines);
  return slice.join('\n');
}

export function listDirectory(dirPath: string): FileEntry[] {
  if (!existsSync(dirPath)) return [];
  const entries = readdirSync(dirPath, { withFileTypes: true });
  return entries
    .filter(e => !e.name.startsWith('.'))
    .map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }));
}

export async function findFiles(
  pattern: string,
  rootDir: string
): Promise<string[]> {
  const matches = await glob(pattern, { cwd: rootDir, absolute: true });
  return matches.slice(0, 50);
}

export function searchCode(
  query: string,
  options: { filePattern?: string; rootDir?: string; maxResults?: number } = {}
): SearchResult[] {
  const { filePattern = '*.{ts,js,mjs,cjs}', rootDir = process.cwd(), maxResults = 20 } = options;

  if (hasRipgrep()) {
    return searchWithRipgrep(query, { filePattern, rootDir, maxResults });
  }
  return searchWithFallback(query, { filePattern, rootDir, maxResults });
}

function searchWithRipgrep(
  query: string,
  opts: { filePattern: string; rootDir: string; maxResults: number }
): SearchResult[] {
  try {
    const cmd = [
      'rg',
      '--json',
      '-C', '1',
      '--glob', opts.filePattern,
      '--max-count', '1',
      '--',
      JSON.stringify(query),
    ].join(' ');

    const raw = execSync(cmd, { cwd: opts.rootDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const results: SearchResult[] = [];

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(line); } catch { continue; }

      if (parsed['type'] !== 'match') continue;

      const data = parsed['data'] as Record<string, unknown>;
      const path = (data['path'] as Record<string, unknown>)?.['text'] as string;
      const lineNum = (data['line_number'] as number) ?? 0;
      const text = (data['lines'] as Record<string, unknown>)?.['text'] as string ?? '';

      results.push({ file: path, line: lineNum, snippet: text.trimEnd() });
      if (results.length >= opts.maxResults) break;
    }
    return results;
  } catch {
    return [];
  }
}

function searchWithFallback(
  query: string,
  opts: { filePattern: string; rootDir: string; maxResults: number }
): SearchResult[] {
  const results: SearchResult[] = [];
  const extensions = ['.ts', '.js', '.mjs', '.cjs'];

  function walkDir(dir: string) {
    if (results.length >= opts.maxResults) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      if (results.length >= opts.maxResults) break;
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;

      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walkDir(full);
      } else if (extensions.includes(extname(entry))) {
        searchInFile(full, query, results, opts.maxResults);
      }
    }
  }

  walkDir(opts.rootDir);
  return results;
}

function searchInFile(
  filePath: string,
  query: string,
  results: SearchResult[],
  maxResults: number
): void {
  let content: string;
  try { content = readFileSync(filePath, 'utf8'); } catch { return; }

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(query)) {
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length - 1, i + 1);
      const snippet = lines.slice(start, end + 1).join('\n');
      results.push({ file: filePath, line: i + 1, snippet });
      if (results.length >= maxResults) return;
    }
  }
}

export function resolveImport(
  importPath: string,
  fromFile: string
): string | null {
  const dir = dirname(fromFile);

  // Relative import
  if (importPath.startsWith('.')) {
    const candidates = ['', '.ts', '.js', '/index.ts', '/index.js'].map(
      ext => resolve(dir, importPath + ext)
    );
    return candidates.find(existsSync) ?? null;
  }

  // Node module — find in node_modules
  try {
    return require.resolve(importPath, { paths: [dir] });
  } catch {
    return null;
  }
}

export function findSymbolDefinition(
  symbolName: string,
  rootDir: string
): SearchResult[] {
  const patterns = [
    `function ${symbolName}`,
    `const ${symbolName}`,
    `class ${symbolName}`,
    `export function ${symbolName}`,
    `export const ${symbolName}`,
    `export class ${symbolName}`,
    `export default function ${symbolName}`,
  ];

  const allResults: SearchResult[] = [];
  for (const pattern of patterns) {
    const found = searchCode(pattern, { rootDir, maxResults: 5 });
    allResults.push(...found);
    if (allResults.length >= 5) break;
  }
  return allResults.slice(0, 5);
}
