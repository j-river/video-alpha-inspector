import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { AlphaInspectionError, analyzeAlphaPlane, finite, invalid, objectOptions, thresholds } from './alpha.js';
import type { AlphaThresholds, AlphaStatistics, Thresholds } from './alpha.js';
export { AlphaInspectionError, analyzeAlphaPlane } from './alpha.js';
export type { AlphaErrorCode, AlphaThresholds, AlphaStatistics } from './alpha.js';

export interface InspectionOptions extends AlphaThresholds {
  ffmpegPath?: string;
  ffprobePath?: string;
  /** Fractions of reported duration in [0,1), at most 16. Default [0,.25,.5,.75]. */
  sampleFractions?: readonly number[];
  /** Maximum sampled long edge; never upscales. Default 512, maximum 2048. */
  maxSampleSide?: number;
  /** Total budget for probing and all decoding. Default 60,000; maximum 300,000. */
  timeoutMs?: number;
  /** Default 512 MiB; maximum 2 GiB. */
  maxInputBytes?: number;
  /** Default 600 seconds; maximum 3,600 seconds. Unknown duration uses first frame only. */
  maxDurationSeconds?: number;
  signal?: AbortSignal;
}

export interface FrameSample {
  /** Requested seek position; FFmpeg may return the next available frame. */
  requestedTimeSeconds: number;
  width: number;
  height: number;
  alpha: AlphaStatistics;
}

export interface AlphaInspection {
  status: 'transparency-detected' | 'fully-transparent-samples' | 'no-transparency-observed' | 'inconclusive';
  video: {
    streamIndex: number;
    codec: string;
    pixelFormat: string | null;
    width: number;
    height: number;
    durationSeconds: number | null;
    /** A metadata hint, not proof that any pixel is transparent. */
    alphaMetadata: boolean;
  };
  sampling: { requestedFractions: number[]; firstFrameOnly: boolean; thresholds: Thresholds };
  samples: FrameSample[];
}

interface ProcessOptions { deadline: number; signal: AbortSignal | undefined; maxBytes: number; tool: 'ffmpeg' | 'ffprobe' }
function checkCancelled(signal: AbortSignal | undefined, deadline: number): void {
  if (signal?.aborted) throw new AlphaInspectionError('ABORTED', 'Inspection was cancelled.');
  if (Date.now() >= deadline) throw new AlphaInspectionError('TIMEOUT', 'Inspection exceeded its time budget.');
}

async function run(bin: string, args: string[], options: ProcessOptions): Promise<Buffer> {
  checkCancelled(options.signal, options.deadline);
  return new Promise((resolveRun, reject) => {
    const child = spawn(bin, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let bytes = 0, stderrBytes = 0, done = false;
    let failure: AlphaInspectionError | undefined;
    const stop = (error: AlphaInspectionError) => { failure ??= error; child.kill('SIGKILL'); };
    const abort = () => stop(new AlphaInspectionError('ABORTED', 'Inspection was cancelled.'));
    const timer = setTimeout(() => stop(new AlphaInspectionError('TIMEOUT', 'Inspection exceeded its time budget.')),
      Math.max(1, options.deadline - Date.now()));
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const finish = (error?: AlphaInspectionError) => {
      if (done) return;
      done = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolveRun(Buffer.concat(chunks, bytes));
    };
    child.stdout.on('data', (chunk: Buffer) => {
      if (failure) return;
      if (bytes + chunk.length > options.maxBytes) {
        stop(new AlphaInspectionError('OUTPUT_LIMIT', `${options.tool} exceeded the output limit.`)); return;
      }
      bytes += chunk.length; chunks.push(chunk);
    });
    // Drain stderr without retaining filenames, embedded metadata or unbounded diagnostics.
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 65_536) stop(new AlphaInspectionError('OUTPUT_LIMIT', `${options.tool} exceeded the diagnostic limit.`));
    });
    child.on('error', () => finish(failure ?? new AlphaInspectionError('TOOL_UNAVAILABLE', `Could not start ${options.tool}; install it or supply its executable path.`)));
    child.on('close', (code) => finish(failure ?? (code === 0 ? undefined : new AlphaInspectionError(
      options.tool === 'ffprobe' ? 'PROBE_FAILED' : 'DECODE_FAILED',
      options.tool === 'ffprobe' ? 'ffprobe could not inspect this file.' : 'FFmpeg could not decode an alpha sample; check the file and installed decoders.',
    ))));
  });
}

function binary(value: string | undefined, fallback: string): string {
  const name = value ?? fallback;
  if (typeof name !== 'string' || !name.trim() || name.includes('\0') || name.length > 4096) invalid('Executable paths must be non-empty strings.');
  return name;
}
function positiveNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Inspect local video samples. No URL inputs, network access, uploads or source-file writes. */
export async function inspectVideoAlpha(file: string, options: InspectionOptions = {}): Promise<AlphaInspection> {
  objectOptions(options);
  const alphaThresholds = thresholds(options);
  const timeoutMs = finite(options.timeoutMs ?? 60_000, 1, 300_000, 'timeoutMs', true);
  const maxSampleSide = finite(options.maxSampleSide ?? 512, 1, 2048, 'maxSampleSide', true);
  const maxInputBytes = finite(options.maxInputBytes ?? 536_870_912, 1, 2_147_483_648, 'maxInputBytes', true);
  const maxDuration = finite(options.maxDurationSeconds ?? 600, 0.001, 3600, 'maxDurationSeconds');
  const ffmpeg = binary(options.ffmpegPath, 'ffmpeg');
  const ffprobe = binary(options.ffprobePath, 'ffprobe');
  const requested = options.sampleFractions ?? [0, 0.25, 0.5, 0.75];
  if (!Array.isArray(requested) || requested.length === 0 || requested.length > 16) invalid('Provide between 1 and 16 sample fractions.');
  const fractions = [...new Set(requested.map(f => finite(f, 0, 1 - Number.EPSILON, 'sampleFractions')))].sort((a, b) => a - b);
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) invalid('signal must be an AbortSignal.');
  const deadline = Date.now() + timeoutMs;
  checkCancelled(options.signal, deadline);
  if (typeof file !== 'string' || !file.trim() || file.includes('\0') || file.length > 32_768 ||
    (/^[a-z][a-z0-9+.-]*:/i.test(file) && !/^[a-z]:[\\/]/i.test(file))) {
    throw new AlphaInspectionError('INVALID_INPUT', 'Provide a local file path, not a URL or protocol.');
  }
  let input: string;
  let size: number;
  try {
    input = await realpath(resolve(file));
    const stats = await stat(input);
    if (!stats.isFile() || stats.size === 0) throw new Error('Not a non-empty file');
    size = stats.size;
  } catch { throw new AlphaInspectionError('INVALID_INPUT', 'The input must be a readable, non-empty regular file.'); }
  if (size > maxInputBytes) throw new AlphaInspectionError('INPUT_LIMIT', 'The input exceeds maxInputBytes.');
  const raw = await run(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file', '-show_format', '-show_streams', '-of', 'json', input],
    { deadline, signal: options.signal, maxBytes: 2_097_152, tool: 'ffprobe' });
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    const candidate = record(parsed);
    if (!candidate || !Array.isArray(candidate.streams)) throw new Error('Invalid shape');
    data = candidate;
  } catch { throw new AlphaInspectionError('INVALID_PROBE', 'ffprobe did not return valid stream JSON.'); }
  const streams = data.streams as unknown[];
  const stream = streams.map(record).find(s => s?.codec_type === 'video' && record(s.disposition)?.attached_pic !== 1);
  if (!stream) throw new AlphaInspectionError('NO_VIDEO', 'The file has no ordinary video stream.');
  const width = positiveNumber(stream.width), height = positiveNumber(stream.height);
  const streamIndex = stream.index;
  if (width === null || height === null || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
    typeof streamIndex !== 'number' || !Number.isSafeInteger(streamIndex) || streamIndex < 0) {
    throw new AlphaInspectionError('INVALID_PROBE', 'Invalid video dimensions or stream index.');
  }
  if (width > 8192 || height > 8192 || width * height > 33_554_432) {
    throw new AlphaInspectionError('INPUT_LIMIT', 'Video dimensions exceed 8192 per side or 33,554,432 pixels.');
  }
  const codec = typeof stream.codec_name === 'string' ? stream.codec_name : '';
  if (!['vp9', 'vp8', 'prores', 'h264'].includes(codec)) {
    throw new AlphaInspectionError('UNSUPPORTED_CODEC', 'Supported codecs are VP9, VP8, ProRes and H.264; HEVC alpha is not supported.');
  }
  const durationSeconds = positiveNumber(stream.duration) ?? positiveNumber(record(data.format)?.duration);
  if (durationSeconds !== null && durationSeconds > maxDuration) {
    throw new AlphaInspectionError('INPUT_LIMIT', 'Video duration exceeds maxDurationSeconds.');
  }
  const pixelFormat = typeof stream.pix_fmt === 'string' ? stream.pix_fmt : null;
  const tags = record(stream.tags);
  const alphaMetadata = Object.entries(tags ?? {}).some(([key, value]) => key.toLowerCase() === 'alpha_mode' && String(value) === '1') ||
    /^(yuva|rgba|bgra|argb|abgr|gbrap|ya)/.test(pixelFormat ?? '');
  const scale = Math.min(1, maxSampleSide / Math.max(width, height));
  const sampledWidth = Math.max(1, Math.round(width * scale));
  const sampledHeight = Math.max(1, Math.round(height * scale));
  const points = durationSeconds === null ? [0] : fractions.map(f => f * durationSeconds);
  const decoder = codec === 'vp9' ? ['-c:v', 'libvpx-vp9'] : codec === 'vp8' ? ['-c:v', 'libvpx'] : [];
  const samples: FrameSample[] = [];
  for (const point of points) {
    const plane = await run(ffmpeg, ['-nostdin', '-hide_banner', '-v', 'error', '-protocol_whitelist', 'file',
      ...(point > 0 ? ['-ss', point.toFixed(6)] : []), ...decoder, '-threads', '1', '-i', input, '-map', `0:${streamIndex}`,
      '-an', '-sn', '-dn', '-vf', `format=rgba,alphaextract,scale=${sampledWidth}:${sampledHeight}:flags=neighbor`,
      '-frames:v', '1', '-threads', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
      { deadline, signal: options.signal, maxBytes: sampledWidth * sampledHeight, tool: 'ffmpeg' });
    if (plane.length !== sampledWidth * sampledHeight) throw new AlphaInspectionError('NO_FRAME', 'No complete frame was available at a requested sample point.');
    samples.push({ requestedTimeSeconds: point, width: sampledWidth, height: sampledHeight, alpha: analyzeAlphaPlane(plane, alphaThresholds) });
  }
  const transparent = samples.some(s => s.alpha.significantTransparency);
  const visible = samples.some(s => s.alpha.significantVisibility);
  const allZero = samples.every(s => s.alpha.max === 0);
  const anyBelowThreshold = samples.some(s => s.alpha.min < alphaThresholds.transparentBelow);
  const status = allZero ? 'fully-transparent-samples' : transparent && visible ? 'transparency-detected' :
    anyBelowThreshold ? 'inconclusive' : 'no-transparency-observed';
  return {
    status,
    video: { streamIndex, codec, pixelFormat, width, height, durationSeconds, alphaMetadata },
    sampling: { requestedFractions: fractions, firstFrameOnly: durationSeconds === null, thresholds: alphaThresholds },
    samples,
  };
}
