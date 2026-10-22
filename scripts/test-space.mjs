import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { inspectVideoAlpha } from '../dist/index.js';
const root = new URL('../.artifacts/hf-space/', import.meta.url);
const expected = { cutout: 'transparency-detected', checkerboard: 'no-transparency-observed', partial: 'transparency-detected', empty: 'fully-transparent-samples' };
for (const [name, status] of Object.entries(expected)) {
  const report = await inspectVideoAlpha(fileURLToPath(new URL(`media/${name}.webm`, root)));
  assert.equal(report.status, status, name);
  assert.equal(report.video.width, 256); assert.equal(report.video.height, 144); assert.equal(report.samples.length, 4);
  if (name === 'checkerboard') assert.ok(report.samples.every(s => s.alpha.min === 255));
  if (name === 'partial') assert.ok(report.samples.every(s => s.alpha.partialPixels > 0 && s.alpha.max < 255));
}
assert.deepEqual((await readdir(root)).sort(), ['LICENSE', 'README.md', 'assets', 'build-info.json', 'index.html', 'media']);
assert.deepEqual((await readdir(new URL('assets/', root))).sort(), ['app.js', 'style.css']);
assert.deepEqual((await readdir(new URL('media/', root))).sort(), ['checkerboard.webm', 'cutout.webm', 'empty.webm', 'partial.webm']);
const html = await readFile(new URL('index.html', root), 'utf8'); assert.match(html, /connect-src 'none'/);
assert.doesNotMatch(html, /<(?:script|link)\b[^>]*(?:src|href)=["']https?:/i);
const js = await readFile(new URL('assets/app.js', root), 'utf8');
assert.doesNotMatch(js, /node:|\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB)\b/);
console.log('Static Space passed: 4 FFmpeg-verified synthetic clips, exact 10-file allowlist, no remote runtime scripts or scene uploads.');
