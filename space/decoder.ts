import { analyzeAlphaPlane } from '../src/browser.js';
import type { AlphaStatistics } from '../src/browser.js';
export interface BrowserSample { requestedTimeSeconds: number; seekPositionSeconds: number; width: number; height: number; alpha: AlphaStatistics }
export interface ObservedFrame { sample: BrowserSample; rgba: ImageData }
export interface BrowserObservation {
  schemaVersion: 1;
  engine: 'html-video-canvas';
  status: 'transparency-detected' | 'fully-transparent-samples' | 'no-transparency-observed' | 'inconclusive';
  knownVp9ControlPassed: true;
  source: { width: number; height: number; durationSeconds: number };
  sampling: { requestedFractions: number[]; maxSampleSide: 512; thresholds: { transparentBelow: 245; visibleAbove: 10; minPixelFraction: 0.01 } };
  samples: BrowserSample[];
  limitations: string[];
}
function cancelled(signal: AbortSignal) { signal.throwIfAborted(); }
function waitFor(video: HTMLVideoElement, event: string, signal: AbortSignal, action: () => void): Promise<void> {
  cancelled(signal);
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => { clearTimeout(timer); video.removeEventListener(event, success); video.removeEventListener('error', failure); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
    const success = () => finish();
    const failure = () => finish(new Error('The browser could not decode this WebM. Use the FFmpeg inspector for an independent check.'));
    const abort = () => finish(new Error('Inspection cancelled or timed out.'));
    const timer = setTimeout(() => finish(new Error('The browser did not provide a frame in time. Try a smaller file or use FFmpeg.')), 8000);
    video.addEventListener(event, success, { once: true }); video.addEventListener('error', failure, { once: true }); signal.addEventListener('abort', abort, { once: true });
    try { action(); } catch { finish(new Error('Could not load this video in the browser.')); }
  });
}
async function decode(url: string, signal: AbortSignal, fractions: number[], progress: (count: number) => void): Promise<{ width: number; height: number; durationSeconds: number; frames: ObservedFrame[] }> {
  const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.preload = 'auto';
  try {
    await waitFor(video, 'loadeddata', signal, () => { video.src = url; video.load(); }); cancelled(signal);
    const width = video.videoWidth, height = video.videoHeight, duration = video.duration;
    if (!width || !height || width > 4096 || height > 4096 || width * height > 8_388_608) throw new Error('Use a video up to 4,096 px per side and 8 MP.');
    if (!Number.isFinite(duration) || duration <= 0 || duration > 120) throw new Error('A finite video duration up to 120 seconds is required. Use FFmpeg for live or unknown-duration WebM.');
    const scale = Math.min(1, 512 / Math.max(width, height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true }); if (!context) throw new Error('Canvas pixel access is unavailable.');
    context.imageSmoothingEnabled = false;
    const frames: ObservedFrame[] = [];
    for (const fraction of fractions) {
      cancelled(signal); const requested = duration * fraction;
      if (Math.abs(video.currentTime - requested) > 0.00001) await waitFor(video, 'seeked', signal, () => { video.currentTime = requested; });
      cancelled(signal); context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height);
      const plane = new Uint8Array(canvas.width * canvas.height);
      for (let i = 0; i < plane.length; i++) plane[i] = rgba.data[i * 4 + 3]!;
      frames.push({ sample: { requestedTimeSeconds: requested, seekPositionSeconds: video.currentTime, width: canvas.width, height: canvas.height, alpha: analyzeAlphaPlane(plane) }, rgba });
      progress(frames.length);
    }
    return { width, height, durationSeconds: duration, frames };
  } finally { video.pause(); video.removeAttribute('src'); video.load(); }
}
export async function observeBrowserAlpha(url: string, controlUrl: string, signal: AbortSignal, progress: (message: string) => void) {
  progress('Checking a known-transparent VP9 control…');
  const control = await decode(controlUrl, signal, [0], () => {});
  const alpha = control.frames[0]!.sample.alpha;
  if (!alpha.significantTransparency || !alpha.significantVisibility) throw new Error('This browser did not preserve alpha in the known-transparent VP9 control. No verdict was produced. Try another browser or use the FFmpeg inspector.');
  const fractions = [0, 0.25, 0.5, 0.75];
  const result = await decode(url, signal, fractions, count => progress(`Reading sample ${count} of 4…`));
  const samples = result.frames.map(frame => frame.sample);
  const transparent = samples.some(s => s.alpha.significantTransparency), visible = samples.some(s => s.alpha.significantVisibility);
  const status = samples.every(s => s.alpha.max === 0) ? 'fully-transparent-samples' : transparent && visible ? 'transparency-detected' : samples.some(s => s.alpha.min < 245) ? 'inconclusive' : 'no-transparency-observed';
  const report: BrowserObservation = { schemaVersion: 1, engine: 'html-video-canvas', status, knownVp9ControlPassed: true,
    source: { width: result.width, height: result.height, durationSeconds: result.durationSeconds },
    sampling: { requestedFractions: fractions, maxSampleSide: 512, thresholds: { transparentBelow: 245, visibleAbove: 10, minPixelFraction: 0.01 } }, samples,
    limitations: ['Browser-observed sampled pixels, not independent FFmpeg decoding or a whole-clip certificate.', 'A passing VP9 control does not verify every codec, file, frame, editor or playback path.', 'A negative result can reflect decoder alpha loss. Unsupported media must be checked independently.', 'Seek positions are browser-reported positions, not verified decoded-frame timestamps.', 'Downscaling and four sample positions can miss brief transparency changes and small details.', 'ProRes and HEVC alpha are outside this browser demo. Cutout quality and premultiplication are not measured.'],
  };
  return { report, frames: result.frames };
}
