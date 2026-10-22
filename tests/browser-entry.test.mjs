import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as browser from '../dist/browser.js';
import * as node from '../dist/index.js';
test('browser statistics match the Node entry and preserve typed errors', () => {
  for (const plane of [Uint8Array.of(0, 128, 255), Uint8Array.of(255), new Uint8Array(1024)]) {
    for (const options of [{}, { transparentBelow: 200, visibleAbove: 20, minPixelFraction: 0.2 }]) assert.deepEqual(browser.analyzeAlphaPlane(plane, options), node.analyzeAlphaPlane(plane, options));
  }
  assert.throws(() => browser.analyzeAlphaPlane(new Uint8Array()), error => error instanceof browser.AlphaInspectionError && error.code === 'INVALID_INPUT');
  assert.equal(browser.inspectVideoAlpha, undefined);
});
test('browser bundle imports no Node modules and makes no network calls', async () => {
  const source = await readFile(new URL('../dist/browser.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /node:|\brequire\s*\(|\bfetch\s*\(|\bXMLHttpRequest\b|\bspawn\s*\(/);
});
