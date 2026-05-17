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
export declare function analyzeRoute(rule: AIRuleName, filePath: string, route: string, projectRoot: string, maxSteps?: number): Promise<{
    finding: AIFinding | null;
    stepsUsed: number;
    durationMs: number;
}>;
