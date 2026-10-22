import http from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../.artifacts/hf-space/', import.meta.url);
const files = ['index.html', 'README.md', 'LICENSE', 'build-info.json', 'assets/app.js', 'assets/style.css', ...['cutout', 'checkerboard', 'partial', 'empty'].map(key => `media/${key}.webm`)];
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', webm: 'video/webm', json: 'application/json' };
http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!files.includes(name)) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const body = await readFile(new URL(name, root)); const headers = { 'Content-Type': types[name.split('.').at(-1)] ?? 'text/plain', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) { const start = Number(range[1]), end = Math.min(body.length - 1, range[2] ? Number(range[2]) : body.length - 1); if (start >= body.length || end < start) { res.writeHead(416); res.end(); return; } res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1 }); res.end(body.subarray(start, end + 1)); }
    else { res.writeHead(200, { ...headers, 'Content-Length': body.length }); res.end(body); }
  } catch { res.writeHead(404); res.end('Build the Space first.'); }
}).listen(4181, '127.0.0.1', () => console.log('Alpha playground: http://127.0.0.1:4181/'));
