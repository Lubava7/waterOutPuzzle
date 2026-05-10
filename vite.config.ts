import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
// Относительный base — работает на GitHub Pages при любом регистре в URL
// (/waterOutPuzzle/ vs /wateroutpuzzle/) и без привязки к имени репозитория.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? './' : '/',
}));
