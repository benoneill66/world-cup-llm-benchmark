import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the app from a project subpath (/world-cup-llm-benchmark/),
// so production builds need that absolute base for BrowserRouter + asset URLs.
// Dev and tests run at the root.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/world-cup-llm-benchmark/' : '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  test: {
    environment: 'jsdom',
  },
}));
