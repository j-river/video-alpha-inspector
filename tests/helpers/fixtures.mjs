import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function generate(args) {
  const result = spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '1', ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Fixture generation failed: ${result.error?.message ?? result.stderr}`);
}

/** Only lavfi-generated shapes and silence; no downloaded or user media. */
export async function createFixtures(dir) {
  await mkdir(dir, { recursive: true });
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const check = spawnSync(tool, ['-version'], { windowsHide: true, stdio: 'ignore', timeout: 10_000 });
    if (check.status !== 0) throw new Error(`${tool} is required: real-media tests must not be skipped.`);
  }
  const paths = Object.fromEntries([
    ['transparent', 'transparent.webm'], ['opaque', 'opaque.webm'], ['alphaOpaque', 'alpha-opaque.webm'],
    ['empty', 'empty.webm'], ['vp8', 'transparent-vp8.webm'], ['prores', 'transparent.mov'],
    ['mp4', 'opaque.mp4'], ['late', 'late.webm'], ['gap', 'gap.webm'],
    ['audio', 'audio.wav'], ['unsupported', 'unsupported.mkv'], ['corrupt', 'corrupt.webm'],
    ['largeMetadata', 'metadata.mp4'], ['raw', 'duration-unknown.h264'], ['shortVideo', 'short-video.webm'],
  ].map(([key, name]) => [key, join(dir, name)]));
  const rgba = 'color=c=blue:s=64x64:r=10:d=1,format=rgba';
  const alphaSource = 'color=c=black@0.0:s=64x64:r=10:d=1,format=rgba';
  const moving = 'color=c=black@0.0:s=64x64:r=10:d=4,format=rgba';
  const box = (input, file, codec = 'libvpx-vp9', enable) => generate([
    '-f', 'lavfi', '-i', input,
    '-vf', `drawbox=x=16:y=16:w=32:h=32:color=blue@1:replace=1:t=fill${enable ? `:enable='${enable}'` : ''},format=yuva420p`,
    '-c:v', codec, ...(codec === 'libvpx-vp9' ? ['-lossless', '1'] : []), '-auto-alt-ref', '0', '-deadline', 'realtime', '-cpu-used', '8', '-g', '9999', '-threads', '1', '-y', file,
  ]);
  box(alphaSource, paths.transparent);
  box(alphaSource, paths.vp8, 'libvpx');
  generate(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10:d=1', '-c:v', 'libvpx-vp9', '-threads', '1', '-deadline', 'realtime', '-y', paths.opaque]);
  generate(['-f', 'lavfi', '-i', rgba, '-vf', 'format=yuva420p', '-c:v', 'libvpx-vp9', '-lossless', '1', '-auto-alt-ref', '0', '-threads', '1', '-deadline', 'realtime', '-y', paths.alphaOpaque]);
  generate(['-f', 'lavfi', '-i', alphaSource, '-vf', 'format=yuva420p', '-c:v', 'libvpx-vp9', '-lossless', '1', '-auto-alt-ref', '0', '-threads', '1', '-deadline', 'realtime', '-y', paths.empty]);
  generate(['-f', 'lavfi', '-i', 'color=c=blue@0.5:s=64x64:r=10:d=1,format=yuva444p10le', '-c:v', 'prores_ks', '-profile:v', '4444', '-threads', '1', '-pix_fmt', 'yuva444p10le', '-y', paths.prores]);
  generate(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10:d=1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-y', paths.mp4]);
  generate(['-i', paths.mp4, '-c:v', 'copy', '-f', 'h264', '-y', paths.raw]);
  generate(['-i', paths.opaque, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-c:v', 'copy', '-c:a', 'libopus', '-t', '3', '-y', paths.shortVideo]);
  // A visible box appears over a transparent canvas at one of the later samples.
  box(moving, paths.late, 'libvpx-vp9', 'gte(t,2.8)');
  // Change alpha only between sample instants: a negative sampling result is not proof.
  generate(['-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10:d=4,format=rgba',
    '-vf', "colorchannelmixer=aa=0.5:enable='between(t,1.2,1.7)',format=yuva420p",
    '-c:v', 'libvpx-vp9', '-threads', '1', '-auto-alt-ref', '0', '-deadline', 'realtime', '-g', '9999', '-y', paths.gap]);
  generate(['-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '0.2', '-y', paths.audio]);
  generate(['-f', 'lavfi', '-i', 'color=c=blue:s=16x16:r=1:d=1', '-c:v', 'ffv1', '-threads', '1', '-y', paths.unsupported]);
  await writeFile(paths.corrupt, 'Not a video. Synthetic corrupt fixture.');
  const metadata = join(dir, 'large.ffmetadata');
  await writeFile(metadata, `;FFMETADATA1\ncomment=${'x'.repeat(2_200_000)}\n`);
  generate(['-i', paths.mp4, '-f', 'ffmetadata', '-i', metadata, '-map_metadata', '1', '-c', 'copy', '-y', paths.largeMetadata]);
  return paths;
}
