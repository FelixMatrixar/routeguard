import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        bg: '#0a0a0a',
        surface: '#111111',
        border: '#1e1e1e',
        green: '#00ff41',
        amber: '#ffb800',
        red: '#ff3333',
        muted: '#555555',
        text: '#cccccc',
      },
    },
  },
  plugins: [],
} satisfies Config;
