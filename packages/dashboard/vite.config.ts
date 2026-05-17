import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  // Serve benchmark/results/ as static assets so the dashboard can fetch
  // eslint-output.json and report.md from /results/
  publicDir: resolve(__dirname, '../../benchmark/results'),
  server: { port: 4747 },
  build: { outDir: 'dist' },
});
