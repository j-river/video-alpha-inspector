import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, copyFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inspectVideoAlpha, AlphaInspectionError } from '../dist/index.js';
import { createFixtures } from './helpers/fixtures.mjs';

let directory, files;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'video-alpha-test-'));
  files = await createFixtures(directory);
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
const rejectsCode = (action, code) => assert.rejects(action, e => e instanceof AlphaInspectionError && e.code === code);

test('VP9 alpha is decoded even when ffprobe reports yuv420p', async () => {
  const report = await inspectVideoAlpha(files.transparent);
  assert.equal(report.status, 'transparency-detected');
  assert.equal(report.video.codec, 'vp9');
  assert.equal(report.video.pixelFormat, 'yuv420p');
  assert.equal(report.video.alphaMetadata, true);
  assert.equal(report.samples.length, 4);
  for (const sample of report.samples) {
    assert.equal(sample.alpha.min, 0); assert.equal(sample.alpha.max, 255);
    assert.equal(sample.alpha.zeroPixels, 3072); assert.equal(sample.alpha.opaquePixels, 1024);
  }
});

test('an alpha tag on an opaque file is not positive evidence', async () => {
  const tagged = await inspectVideoAlpha(files.alphaOpaque);
  assert.equal(tagged.video.alphaMetadata, true);
  assert.equal(tagged.status, 'no-transparency-observed');
  const opaque = await inspectVideoAlpha(files.opaque);
  assert.equal(opaque.status, 'no-transparency-observed');
  assert.equal(opaque.video.alphaMetadata, false);
});

test('all-transparent frames are reported separately from a visible cutout', async () => {
  const result = await inspectVideoAlpha(files.empty);
  assert.equal(result.status, 'fully-transparent-samples');
  assert.ok(result.samples.every(s => s.alpha.max === 0 && !s.alpha.significantVisibility));
});

test('real VP8 and ProRes 4444 retain decoded transparency', async () => {
  for (const file of [files.vp8, files.prores]) {
    const result = await inspectVideoAlpha(file);
    assert.equal(result.status, 'transparency-detected');
    assert.equal(result.video.alphaMetadata, true);
  }
  const prores = await inspectVideoAlpha(files.prores, { sampleFractions: [0] });
  assert.ok(prores.samples[0].alpha.min > 100 && prores.samples[0].alpha.max < 150);
});

test('ordinary H.264 is an opaque control, not an alpha-capable claim', async () => {
  const result = await inspectVideoAlpha(files.mp4);
  assert.equal(result.status, 'no-transparency-observed');
  assert.equal(result.video.alphaMetadata, false);
  assert.ok(result.samples.every(s => s.alpha.min === 255));
});

test('late visible content is found after a fully transparent first frame', async () => {
  const result = await inspectVideoAlpha(files.late);
  assert.equal(result.samples[0].alpha.max, 0);
  assert.equal(result.samples.at(-1).alpha.max, 255);
  assert.equal(result.status, 'transparency-detected');
});

test('sampling can miss inter-frame transparency; explicit fractions expose it', async () => {
  assert.equal((await inspectVideoAlpha(files.gap)).status, 'no-transparency-observed');
  assert.equal((await inspectVideoAlpha(files.gap, { sampleFractions: [0.35] })).status, 'transparency-detected');
});

test('sample fractions are sorted/deduplicated and scaling is explicit', async () => {
  const result = await inspectVideoAlpha(files.transparent, { sampleFractions: [0.5, 0, 0.5], maxSampleSide: 16 });
  assert.deepEqual(result.sampling.requestedFractions, [0, 0.5]);
  assert.equal(result.samples.length, 2);
  assert.equal(result.samples[0].width, 16); assert.equal(result.samples[0].height, 16);
  assert.equal(result.samples[0].alpha.pixels, 256);
});

test('unknown duration restricts sampling to the first frame', async () => {
  const report = await inspectVideoAlpha(files.raw);
  assert.equal(report.video.durationSeconds, null);
  assert.equal(report.sampling.firstFrameOnly, true);
  assert.equal(report.samples.length, 1);
  assert.equal(report.samples[0].requestedTimeSeconds, 0);
});

test('insufficient significant pixels are inconclusive, not an opaque verdict', async () => {
  const report = await inspectVideoAlpha(files.transparent, { sampleFractions: [0], minPixelFraction: 1 });
  assert.equal(report.status, 'inconclusive');
});

test('a video ending before the container duration causes a missing-frame error', async () => {
  await rejectsCode(() => inspectVideoAlpha(files.shortVideo), 'NO_FRAME');
});

test('local playlists cannot cause HTTP requests through FFmpeg protocols', async () => {
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.writeHead(404); res.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const playlist = join(directory, 'remote-reference.m3u8');
    await writeFile(playlist, `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttp://127.0.0.1:${server.address().port}/segment.ts\n#EXT-X-ENDLIST\n`);
    await rejectsCode(() => inspectVideoAlpha(playlist, { timeoutMs: 5000 }), 'PROBE_FAILED');
    assert.equal(requests, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('positive metadata is insufficient when decoding cannot run', async () => {
  await rejectsCode(() => inspectVideoAlpha(files.transparent, { ffmpegPath: join(directory, 'missing-ffmpeg') }), 'TOOL_UNAVAILABLE');
  await rejectsCode(() => inspectVideoAlpha(files.transparent, { ffmpegPath: process.execPath }), 'DECODE_FAILED');
});

test('missing tools and malformed probe output are not opaque results', async () => {
  await rejectsCode(() => inspectVideoAlpha(files.transparent, { ffprobePath: join(directory, 'missing-ffprobe') }), 'TOOL_UNAVAILABLE');
  await rejectsCode(() => inspectVideoAlpha(files.transparent, { ffprobePath: process.execPath }), 'INVALID_PROBE');
});

test('audio-only, unsupported and damaged files have different errors', async () => {
  await rejectsCode(() => inspectVideoAlpha(files.audio), 'NO_VIDEO');
  await rejectsCode(() => inspectVideoAlpha(files.unsupported), 'UNSUPPORTED_CODEC');
  await rejectsCode(() => inspectVideoAlpha(files.corrupt), 'PROBE_FAILED');
});

test('size, duration and probe-output budgets are enforced', async () => {
  await rejectsCode(() => inspectVideoAlpha(files.transparent, { maxInputBytes: 1 }), 'INPUT_LIMIT');
  await rejectsCode(() => inspectVideoAlpha(files.late, { maxDurationSeconds: 1 }), 'INPUT_LIMIT');
  await rejectsCode(() => inspectVideoAlpha(files.largeMetadata), 'OUTPUT_LIMIT');
});

test('total timeout and AbortSignal stop inspection with typed errors', async () => {
  await rejectsCode(() => inspectVideoAlpha(files.transparent, { timeoutMs: 1 }), 'TIMEOUT');
  const cancelled = new AbortController(); cancelled.abort();
  await rejectsCode(() => inspectVideoAlpha(files.transparent, { signal: cancelled.signal }), 'ABORTED');
  await rejectsCode(() => inspectVideoAlpha(files.transparent, { signal: AbortSignal.timeout(5) }), 'ABORTED');
});

test('URLs, non-files and invalid options are rejected before media execution', async () => {
  for (const path of ['https://example.test/a.webm', 'file:///tmp/a.webm', 'pipe:0', '-', '', null, directory, join(directory, 'missing')]) {
    await rejectsCode(() => inspectVideoAlpha(path), 'INVALID_INPUT');
  }
  for (const options of [null, [], { sampleFractions: [] }, { sampleFractions: [1] }, { sampleFractions: [NaN] },
    { sampleFractions: Array(17).fill(0) }, { maxSampleSide: 2049 }, { timeoutMs: 0 }, { signal: {} }, { ffprobePath: '' }]) {
    await rejectsCode(() => inspectVideoAlpha(files.transparent, options), 'INVALID_OPTIONS');
  }
});

test('paths containing spaces, Unicode and shell punctuation remain literal; input is unchanged', async () => {
  const unusual = join(directory, '中文 cutout & literal.webm');
  await copyFile(files.transparent, unusual);
  const digest = async () => createHash('sha256').update(await readFile(unusual)).digest('hex');
  const before = await digest();
  const result = await inspectVideoAlpha(unusual, { sampleFractions: [0] });
  assert.equal(result.status, 'transparency-detected');
  assert.equal(await digest(), before);
  assert.ok(!JSON.stringify(result).includes(directory), 'reports must not expose the local input path');
});

function cli(args) {
  return spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
}
test('CLI JSON is parseable and --require-transparency distinguishes unmet conditions', () => {
  const good = cli([files.transparent, '--samples', '0', '--json', '--require-transparency']);
  assert.equal(good.status, 0, good.stderr); assert.equal(good.stderr, '');
  assert.equal(JSON.parse(good.stdout).status, 'transparency-detected');
  const opaque = cli([files.opaque, '--samples', '0', '--json', '--require-transparency']);
  assert.equal(opaque.status, 1); assert.equal(JSON.parse(opaque.stdout).status, 'no-transparency-observed');
  const empty = cli([files.empty, '--samples', '0', '--require-transparency']);
  assert.equal(empty.status, 1);
});
test('CLI errors use stderr and exit 2; help needs no FFmpeg', () => {
  for (const args of [[], [files.transparent, '--unknown'], [files.transparent, '--samples', '0,,0.5'], [files.transparent, '--timeout-ms', 'nope']]) {
    const result = cli(args); assert.equal(result.status, 2); assert.equal(result.stdout, ''); assert.match(result.stderr, /INVALID_OPTIONS/);
  }
  assert.equal(cli(['--help']).status, 0); assert.equal(cli(['--version']).stdout, '0.1.0\n');
  const fail = cli([files.corrupt, '--json']); assert.equal(fail.status, 2); assert.equal(fail.stdout, '');
});
