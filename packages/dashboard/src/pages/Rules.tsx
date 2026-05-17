import type { ParsedData } from '../types';

interface RulesProps {
  data: ParsedData | null;
}

const RULE_DESCRIPTIONS: Record<string, { description: string; suggestion: string }> = {
  'no-bola': {
    description: 'Detects Broken Object Level Authorization (BOLA/IDOR): DB reads with user-controlled filters lacking ownership checks.',
    suggestion: 'Add a userId/ownerId filter alongside the tainted parameter.',
  },
  'no-mass-assignment': {
    description: 'Detects DB writes using raw req.body, allowing attackers to overwrite any field including privileged ones.',
    suggestion: 'Destructure or whitelist specific fields from req.body before passing to ORM.',
  },
  'no-ssrf': {
    description: 'Detects Server-Side Request Forgery: outbound HTTP requests using user-controlled URLs.',
    suggestion: 'Validate and allowlist URLs; never pass req.query/req.body directly to fetch/axios.',
  },
  'no-sql-injection': {
    description: 'Detects raw SQL queries with string-interpolated user input.',
    suggestion: 'Use parameterized queries with placeholders instead of string concatenation.',
  },
  'no-command-injection': {
    description: 'Detects shell command execution with user-controlled arguments.',
    suggestion: 'Avoid exec/execSync with user input; use spawn with argument arrays instead.',
  },
  'no-path-traversal': {
    description: 'Detects file system operations with user-controlled paths that lack sanitization.',
    suggestion: 'Use path.basename() and validate against an allowlist of directories.',
  },
  'no-open-redirect': {
    description: 'Detects res.redirect() calls with user-controlled destination URLs.',
    suggestion: 'Validate redirect targets against an allowlist; never pass query params directly.',
  },
  'no-hardcoded-secrets': {
    description: 'Detects hardcoded secrets, keys, and tokens passed to crypto/JWT functions.',
    suggestion: 'Use environment variables (process.env.SECRET) instead of string literals.',
  },
};

export function Rules({ data }: RulesProps) {
  const ruleMap = new Map(
    (data?.byRule ?? []).map(r => [r.shortRule, r.count])
  );

  return (
    <div className="space-y-3">
      {Object.entries(RULE_DESCRIPTIONS).map(([rule, meta]) => {
        const count = ruleMap.get(rule) ?? 0;
        return (
          <div key={rule} className="card space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-green text-sm font-bold">routeguard/{rule}</span>
              <span className={`text-xs ${count > 0 ? 'badge-red' : 'badge-muted'}`}>
                {count} finding{count !== 1 ? 's' : ''}
              </span>
            </div>
            <p className="text-text text-xs leading-relaxed">{meta.description}</p>
            <div className="flex items-start gap-2 text-xs">
              <span className="text-amber shrink-0">→</span>
              <span className="text-muted">{meta.suggestion}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
