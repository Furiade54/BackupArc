import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/main/index.ts',
      formats: ['cjs'],
      fileName: () => 'main.cjs',
    },
    rollupOptions: {
      // Dependencias de Node que no deben empaquetarse en el bundle del main
      external: ['mssql', 'dotenv'],
    },
  },
});
