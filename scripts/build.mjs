import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
const pdf = await build({
  entryPoints: ['src/pdf-runtime.ts'], bundle: true, write: false,
  platform: 'browser', format: 'iife', target: 'es2022', external: ['node:*'], minify: true, legalComments: 'eof',
});
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/main.ts'], outfile: 'dist/main.js', bundle: true,
  platform: 'node', format: 'cjs', target: 'es2022', external: ['obsidian', 'electron'],
  define: { __ZPI_PDF_WORKER_SOURCE__: JSON.stringify(pdf.outputFiles[0].text) },
  sourcemap: false, minify: true, legalComments: 'eof',
});
for (const name of ['manifest.json', 'styles.css']) await copyFile(name, `dist/${name}`);
console.log('Built dist/main.js, manifest.json, styles.css');
