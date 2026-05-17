// Bundles all internal @routeguard/* workspace packages into a single dist/index.js
// so the published npm package has zero runtime dependencies.
// eslint and @typescript-eslint/utils are kept external — users already have them.

import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: 'dist/index.js',
  // Keep eslint and @typescript-eslint/* external — peer dependencies
  external: ['eslint', '@typescript-eslint/utils', '@typescript-eslint/*'],
  // Silence the "mixed module" warning from @typescript-eslint packages
  logLevel: 'warning',
});

// Patch the cjs output so `module.exports = plugin` works for both
// import (esm interop) and require()
const content = readFileSync('dist/index.js', 'utf8');
if (!content.includes('module.exports.default')) {
  writeFileSync('dist/index.js', content + '\nmodule.exports.default = module.exports;\n');
}

console.log('Bundle written to dist/index.js');
