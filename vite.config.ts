import { defineConfig } from 'vite';

export default defineConfig({
  // The game is served from the site root and from /preview/<branch>/,
  // so every asset path has to be relative.
  base: './',
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
