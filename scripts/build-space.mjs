import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const out = new URL('../.artifacts/hf-space/', import.meta.url);
await mkdir(new URL('assets/', out), { recursive: true }); await mkdir(new URL('media/', out), { recursive: true });
for (const [source, target] of [['space/index.html', 'index.html'], ['space/style.css', 'assets/style.css'], ['space/README.md', 'README.md'], ['LICENSE', 'LICENSE']]) await writeFile(new URL(target, out), await readFile(new URL(`../${source}`, import.meta.url)));
await build({ entryPoints: [fileURLToPath(new URL('../space/app.ts', import.meta.url))], outfile: fileURLToPath(new URL('assets/app.js', out)), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'none' });
// Entirely generated RGBA frames: no user footage, downloaded media or font files.
const width = 256, height = 144, count = 24;
for (const kind of ['cutout', 'checkerboard', 'partial', 'empty']) {
  const raw = Buffer.alloc(width * height * count * 4);
  for (let frame = 0; frame < count; frame++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = ((frame * height + y) * width + x) * 4;
    const cx = width / 2 + Math.sin(frame / 4) * 18, cy = height / 2;
    const distance = Math.hypot(x - cx, y - cy), subject = distance < 42;
    if (kind === 'checkerboard') { const grey = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 175 : 238; raw[i] = raw[i + 1] = raw[i + 2] = grey; raw[i + 3] = 255; }
    if (kind !== 'empty' && subject) {
      const highlight = x < cx - 9 && y < cy - 8;
      raw[i] = highlight ? 142 : 12; raw[i + 1] = highlight ? 226 : 143; raw[i + 2] = highlight ? 235 : 166;
      raw[i + 3] = kind === 'partial' ? 128 : 255;
      if (Math.abs(x - cx) < 15 && Math.abs(y - cy) < 5) { raw[i] = 242; raw[i + 1] = 250; raw[i + 2] = 251; }
    }
  }
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', '12', '-i', 'pipe:0', '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', kind === 'checkerboard' ? 'yuv420p' : 'yuva420p', '-lossless', '1', '-auto-alt-ref', '0', '-threads', '1', '-deadline', 'realtime', '-map_metadata', '-1', '-y', fileURLToPath(new URL(`media/${kind}.webm`, out))], { input: raw, windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 });
  if (result.status !== 0) throw new Error('Synthetic WebM generation requires FFmpeg with libvpx-vp9.');
}
const fingerprints = {};
for (const source of ['src/alpha.ts', 'src/browser.ts', 'space/app.ts', 'space/decoder.ts', 'space/index.html', 'space/style.css', 'space/README.md', 'scripts/build-space.mjs']) fingerprints[source] = createHash('sha256').update(await readFile(new URL(`../${source}`, import.meta.url))).digest('hex');
await writeFile(new URL('build-info.json', out), JSON.stringify({ library: 'video-alpha-inspector', source: 'https://github.com/j-river/video-alpha-inspector', version: '0.1.0', sha256: fingerprints, media: 'Four generated 256×144 VP9 clips, 24 frames each; no user media.' }, null, 2) + '\n');
console.log('Static alpha playground built: .artifacts/hf-space/ (10 public files).');
