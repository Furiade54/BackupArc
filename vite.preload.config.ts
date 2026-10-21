import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'preload.cjs',
        chunkFileNames: 'preload.cjs',
        assetFileNames: 'preload.[ext]',
      },
    },
  },
});
