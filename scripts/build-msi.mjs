import path from 'node:path';
import { api } from '@electron-forge/core';

const resultados = await api.make({
  dir: process.cwd(),
  outDir: path.resolve(process.cwd(), 'out-msi'),
  overrideTargets: ['@electron-forge/maker-wix'],
});

for (const resultado of resultados) {
  console.log(resultado.artifacts.join('\n'));
}
