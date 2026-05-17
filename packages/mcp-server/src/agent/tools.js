"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.readFile = readFile;
exports.listDirectory = listDirectory;
exports.findFiles = findFiles;
exports.searchCode = searchCode;
exports.resolveImport = resolveImport;
exports.findSymbolDefinition = findSymbolDefinition;
const fs_1 = require("fs");
const path_1 = require("path");
const child_process_1 = require("child_process");
const glob_1 = require("glob");
// Detect ripgrep once at module load
let ripgrepAvailable = null;
function hasRipgrep() {
    if (ripgrepAvailable !== null)
        return ripgrepAvailable;
    try {
        (0, child_process_1.execSync)('rg --version', { stdio: 'pipe' });
        ripgrepAvailable = true;
    }
    catch {
        ripgrepAvailable = false;
        process.stderr.write('[routeguard-agent] ripgrep not found — using slower fallback search\n');
    }
    return ripgrepAvailable;
}
// ─── Tool implementations ─────────────────────────────────────────────────────
function readFile(filePath, options = {}) {
    const { maxLines = 200, startLine = 1 } = options;
    if (!(0, fs_1.existsSync)(filePath))
        return `[Error: file not found: ${filePath}]`;
    const content = (0, fs_1.readFileSync)(filePath, 'utf8');
    const lines = content.split('\n');
    const slice = lines.slice(startLine - 1, startLine - 1 + maxLines);
    return slice.join('\n');
}
function listDirectory(dirPath) {
    if (!(0, fs_1.existsSync)(dirPath))
        return [];
    const entries = (0, fs_1.readdirSync)(dirPath, { withFileTypes: true });
    return entries
        .filter(e => !e.name.startsWith('.'))
        .map(e => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }));
}
async function findFiles(pattern, rootDir) {
    const matches = await (0, glob_1.glob)(pattern, { cwd: rootDir, absolute: true });
    return matches.slice(0, 50);
}
function searchCode(query, options = {}) {
    const { filePattern = '*.{ts,js,mjs,cjs}', rootDir = process.cwd(), maxResults = 20 } = options;
    if (hasRipgrep()) {
        return searchWithRipgrep(query, { filePattern, rootDir, maxResults });
    }
    return searchWithFallback(query, { filePattern, rootDir, maxResults });
}
function searchWithRipgrep(query, opts) {
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
        const raw = (0, child_process_1.execSync)(cmd, { cwd: opts.rootDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        const results = [];
        for (const line of raw.split('\n')) {
            if (!line.trim())
                continue;
            let parsed;
            try {
                parsed = JSON.parse(line);
            }
            catch {
                continue;
            }
            if (parsed['type'] !== 'match')
                continue;
            const data = parsed['data'];
            const path = data['path']?.['text'];
            const lineNum = data['line_number'] ?? 0;
            const text = data['lines']?.['text'] ?? '';
            results.push({ file: path, line: lineNum, snippet: text.trimEnd() });
            if (results.length >= opts.maxResults)
                break;
        }
        return results;
    }
    catch {
        return [];
    }
}
function searchWithFallback(query, opts) {
    const results = [];
    const extensions = ['.ts', '.js', '.mjs', '.cjs'];
    function walkDir(dir) {
        if (results.length >= opts.maxResults)
            return;
        let entries;
        try {
            entries = (0, fs_1.readdirSync)(dir);
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (results.length >= opts.maxResults)
                break;
            if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist')
                continue;
            const full = (0, path_1.join)(dir, entry);
            const stat = (0, fs_1.statSync)(full);
            if (stat.isDirectory()) {
                walkDir(full);
            }
            else if (extensions.includes((0, path_1.extname)(entry))) {
                searchInFile(full, query, results, opts.maxResults);
            }
        }
    }
    walkDir(opts.rootDir);
    return results;
}
function searchInFile(filePath, query, results, maxResults) {
    let content;
    try {
        content = (0, fs_1.readFileSync)(filePath, 'utf8');
    }
    catch {
        return;
    }
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(query)) {
            const start = Math.max(0, i - 1);
            const end = Math.min(lines.length - 1, i + 1);
            const snippet = lines.slice(start, end + 1).join('\n');
            results.push({ file: filePath, line: i + 1, snippet });
            if (results.length >= maxResults)
                return;
        }
    }
}
function resolveImport(importPath, fromFile) {
    const dir = (0, path_1.dirname)(fromFile);
    // Relative import
    if (importPath.startsWith('.')) {
        const candidates = ['', '.ts', '.js', '/index.ts', '/index.js'].map(ext => (0, path_1.resolve)(dir, importPath + ext));
        return candidates.find(fs_1.existsSync) ?? null;
    }
    // Node module — find in node_modules
    try {
        return require.resolve(importPath, { paths: [dir] });
    }
    catch {
        return null;
    }
}
function findSymbolDefinition(symbolName, rootDir) {
    const patterns = [
        `function ${symbolName}`,
        `const ${symbolName}`,
        `class ${symbolName}`,
        `export function ${symbolName}`,
        `export const ${symbolName}`,
        `export class ${symbolName}`,
        `export default function ${symbolName}`,
    ];
    const allResults = [];
    for (const pattern of patterns) {
        const found = searchCode(pattern, { rootDir, maxResults: 5 });
        allResults.push(...found);
        if (allResults.length >= 5)
            break;
    }
    return allResults.slice(0, 5);
}
