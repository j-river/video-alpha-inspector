import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/index.ts'], outfile: 'dist/index.js', bundle: true, format: 'esm', platform: 'node', target: 'node22', packages: 'external' }),
  build({ entryPoints: ['src/index.ts'], outfile: 'dist/index.cjs', bundle: true, format: 'cjs', platform: 'node', target: 'node22', packages: 'external' }),
  build({ entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js', bundle: true, format: 'esm', platform: 'node', target: 'node22', packages: 'external', banner: { js: '#!/usr/bin/env node' } }),
  build({ entryPoints: ['src/browser.ts'], outfile: 'dist/browser.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true }),
]);
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--emitDeclarationOnly'], { stdio: 'inherit' });
await copyFile('dist/types/index.d.ts', 'dist/index.d.ts');
await writeFile('dist/index.d.cts', (await readFile('dist/types/index.d.ts', 'utf8')).replaceAll('./alpha.js', './alpha.cjs'));
await copyFile('dist/types/alpha.d.ts', 'dist/alpha.d.ts');
await copyFile('dist/types/alpha.d.ts', 'dist/alpha.d.cts');
await copyFile('dist/types/browser.d.ts', 'dist/browser.d.ts');
