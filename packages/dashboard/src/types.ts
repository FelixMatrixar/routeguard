// ESLint JSON output types
export interface ESLintMessage {
  ruleId: string | null;
  severity: number;
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  nodeType?: string;
}

export interface ESLintFile {
  filePath: string;
  messages: ESLintMessage[];
  errorCount: number;
  warningCount: number;
  fixableErrorCount: number;
  fixableWarningCount: number;
}

// Parsed/normalized types for dashboard
export interface Finding {
  rule: string;
  shortRule: string;
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface RuleStats {
  rule: string;
  shortRule: string;
  count: number;
}

export interface ParsedData {
  findings: Finding[];
  byRule: RuleStats[];
  byFile: Map<string, Finding[]>;
  totalFiles: number;
  totalFindings: number;
  errorCount: number;
  warningCount: number;
}

// Benchmark report types (parsed from report.md)
export interface BenchmarkRow {
  rule: string;
  tp: number;
  fp: number;
  fn: number;
  precision: string;
  recall: string;
  f1: string;
}

export interface BenchmarkData {
  generated: string;
  totalFindings: number;
  rows: BenchmarkRow[];
  overall: BenchmarkRow | null;
}
