import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The game is served from the site root and from /preview/<branch>/,
  // so every asset path has to be relative.
  base: './',
  build: {
    // Phaser alone is larger than the default warning threshold.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
