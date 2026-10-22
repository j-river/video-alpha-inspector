import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAlphaPlane, AlphaInspectionError } from '../dist/index.js';

test('alpha statistics distinguish zero, partial and opaque pixels without changing input', () => {
  const input = Uint8Array.from([0, 10, 11, 127, 244, 245, 255]);
  const original = input.slice();
  const stats = analyzeAlphaPlane(input);
  assert.equal(stats.pixels, 7);
  assert.equal(stats.min, 0); assert.equal(stats.max, 255);
  assert.equal(stats.zeroPixels, 1); assert.equal(stats.opaquePixels, 1); assert.equal(stats.partialPixels, 5);
  assert.equal(stats.transparentPixels, 5); assert.equal(stats.visiblePixels, 5);
  assert.equal(stats.mean, 892 / 7);
  assert.equal(stats.significantTransparency, true);
  assert.deepEqual(input, original);
});

test('fully opaque and fully transparent alpha planes remain distinct', () => {
  const opaque = analyzeAlphaPlane(new Uint8Array(100).fill(255));
  assert.equal(opaque.significantTransparency, false); assert.equal(opaque.significantVisibility, true);
  const empty = analyzeAlphaPlane(new Uint8Array(100));
  assert.equal(empty.significantTransparency, true); assert.equal(empty.significantVisibility, false);
});

test('minimum fraction uses a ceiling and strict alpha thresholds', () => {
  const alpha = new Uint8Array(101).fill(255); alpha[0] = 0;
  assert.equal(analyzeAlphaPlane(alpha).significantTransparency, false);
  alpha[1] = 0;
  assert.equal(analyzeAlphaPlane(alpha).significantTransparency, true);
  assert.equal(analyzeAlphaPlane(Uint8Array.from([244, 245]), { transparentBelow: 245 }).transparentPixels, 1);
  assert.equal(analyzeAlphaPlane(Uint8Array.from([10, 11]), { visibleAbove: 10 }).visiblePixels, 1);
});

test('buffers and subarray views only analyze the supplied region', () => {
  const buffer = Buffer.from([255, 0, 128, 255]);
  const stats = analyzeAlphaPlane(buffer.subarray(1, 3));
  assert.equal(stats.pixels, 2); assert.equal(stats.max, 128); assert.equal(stats.opaquePixels, 0);
});

test('invalid planes and thresholds produce typed errors', () => {
  for (const plane of [[], null, new Uint8Array(), new Uint16Array(1), new Uint8Array(16_777_217)]) {
    assert.throws(() => analyzeAlphaPlane(plane), e => e instanceof AlphaInspectionError && e.code === 'INVALID_INPUT');
  }
  for (const options of [null, [], { transparentBelow: 0 }, { visibleAbove: 255 }, { transparentBelow: 100, visibleAbove: 100 },
    { minPixelFraction: 0 }, { minPixelFraction: NaN }, { transparentBelow: '245' }]) {
    assert.throws(() => analyzeAlphaPlane(Uint8Array.of(0), options), e => e.code === 'INVALID_OPTIONS');
  }
});
