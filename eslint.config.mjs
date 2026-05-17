import routeguard from '@felix-neuro/eslint-plugin-routeguard';

export default [
  routeguard.configs.recommended,
  {
    // Only analyze route/app files — skip tests, configs, tooling
    files: ['examples/**/*.js', 'src/**/*.{js,ts}'],
    ignores: ['**/node_modules/**', '**/dist/**', '**/*.test.*', '**/benchmark/**'],
  },
];
