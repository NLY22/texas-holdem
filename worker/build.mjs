import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(__dirname, 'index.ts');
const outfile = path.join(__dirname, 'dist', 'index.js');

await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  external: ['cloudflare:workers'],
  minify: true,
  sourcemap: false,
});

console.log('Built Cloudflare Worker bundle:', outfile);
