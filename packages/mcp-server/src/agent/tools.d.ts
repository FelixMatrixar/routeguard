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
export interface SearchResult {
    file: string;
    line: number;
    snippet: string;
}
export interface FileEntry {
    name: string;
    type: 'file' | 'directory';
}
export declare function readFile(filePath: string, options?: {
    maxLines?: number;
    startLine?: number;
}): string;
export declare function listDirectory(dirPath: string): FileEntry[];
export declare function findFiles(pattern: string, rootDir: string): Promise<string[]>;
export declare function searchCode(query: string, options?: {
    filePattern?: string;
    rootDir?: string;
    maxResults?: number;
}): SearchResult[];
export declare function resolveImport(importPath: string, fromFile: string): string | null;
export declare function findSymbolDefinition(symbolName: string, rootDir: string): SearchResult[];
