# Plan mode rules

## Planning discipline
- Reference specific file paths, not vague layer descriptions
- Every plan must state: (1) which packages are affected, (2) whether IR changes, (3) what tests to write
- IR-touching steps must be marked ⚠️ IR CHANGE
- New adapters must follow the Express adapter as reference

## Output format
- Numbered steps with clear exit criteria per step
- "What could go wrong" section for NestJS or raw SQL work
- Do not produce code in Plan mode — produce plans only