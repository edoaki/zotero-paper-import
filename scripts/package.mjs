import { mkdir, copyFile, readFile, cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const root = `release/${manifest.id}`;
// Recreate only generated package outputs; removed files must not linger in a ZIP.
await rm(root, { recursive: true, force: true });
await rm(`release/${manifest.id}-${manifest.version}.zip`, { force: true });
await mkdir(root, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) await copyFile(`dist/${file}`, `${root}/${file}`);
for (const file of ['LICENSE', 'THIRD-PARTY-LICENSES.txt', 'README.md', 'INSTALL.txt']) await copyFile(file, `${root}/${file}`);
await cp('docs', `${root}/docs`, { recursive: true });
execFileSync('zip', ['-qr', `${manifest.id}-${manifest.version}.zip`, manifest.id], { cwd: 'release' });
console.log(`release/${manifest.id}-${manifest.version}.zip`);
