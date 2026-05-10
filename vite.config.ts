import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
// GitHub Pages (project site): https://lubava7.github.io/waterOutPuzzle/
const GITHUB_PAGES_BASE = '/waterOutPuzzle/';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? GITHUB_PAGES_BASE : '/',
}));
