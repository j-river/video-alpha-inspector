import { observeBrowserAlpha } from './decoder.js';
import type { ObservedFrame } from './decoder.js';
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = byId<HTMLVideoElement>('video'), file = byId<HTMLInputElement>('file');
const inspect = byId<HTMLButtonElement>('inspect'), cancel = byId<HTMLButtonElement>('cancel'), download = byId<HTMLButtonElement>('download');
const progress = byId('progress'), badge = byId('badge'), title = byId('verdict-title'), detail = byId('verdict-detail');
const frames = byId('frames'), output = byId<HTMLTextAreaElement>('report'), info = byId('video-info');
const sourceName = byId('source-name');
const names: Record<string, string> = { cutout: 'Synthetic transparent cutout', checkerboard: 'Synthetic baked checkerboard', partial: 'Synthetic partial alpha', empty: 'Synthetic fully transparent clip' };
let source = { url: new URL('./media/cutout.webm', document.baseURI).href, name: names.cutout!, local: false };
const controlUrl = source.url;
let controller: AbortController | undefined;
let reportText = '';
function invalidate() {
  controller?.abort(); controller = undefined; reportText = ''; output.value = ''; frames.replaceChildren(); info.textContent = '';
  download.disabled = true; cancel.disabled = true; inspect.disabled = false;
  title.textContent = 'Ready to inspect'; detail.textContent = 'Choose a source to inspect the alpha pixels decoded by this browser.';
  badge.textContent = 'Ready'; badge.dataset.state = 'ready';
}
function showFrames(observed: ObservedFrame[]) {
  for (const [index, frame] of observed.entries()) {
    const card = document.createElement('article'); card.className = 'frame-card';
    const heading = document.createElement('h4'); heading.textContent = `${[0, 25, 50, 75][index]}% · ${frame.sample.requestedTimeSeconds.toFixed(2)}s requested`;
    const picture = document.createElement('canvas'), mask = document.createElement('canvas');
    for (const canvas of [picture, mask]) { canvas.width = frame.rgba.width; canvas.height = frame.rgba.height; }
    picture.setAttribute('role', 'img'); picture.setAttribute('aria-label', `Sample ${index + 1} colors`);
    mask.setAttribute('role', 'img'); mask.setAttribute('aria-label', `Sample ${index + 1} alpha mask`);
    picture.getContext('2d')!.putImageData(frame.rgba, 0, 0);
    const maskData = new ImageData(mask.width, mask.height);
    for (let i = 0; i < frame.rgba.data.length; i += 4) { const alpha = frame.rgba.data[i + 3]!; maskData.data[i] = maskData.data[i + 1] = maskData.data[i + 2] = alpha; maskData.data[i + 3] = 255; }
    mask.getContext('2d')!.putImageData(maskData, 0, 0);
    const stats = document.createElement('p'); const a = frame.sample.alpha;
    stats.textContent = `α ${a.min}–${a.max} · mean ${a.mean.toFixed(1)}\n${(a.transparentFraction * 100).toFixed(1)}% below 245`;
    card.append(heading, picture, mask, stats); frames.append(card);
  }
}
async function run() {
  invalidate(); const current = new AbortController(); controller = current;
  const timer = setTimeout(() => current.abort(), 30_000);
  inspect.disabled = true; cancel.disabled = false; progress.dataset.error = 'false';
  sourceName.textContent = source.name; video.src = source.url; video.load();
  badge.textContent = 'Checking'; title.textContent = 'Reading video…';
  try {
    const result = await observeBrowserAlpha(source.url, controlUrl, current.signal, message => { if (controller === current) progress.textContent = message; });
    if (controller !== current) return;
    const descriptions = {
      'transparency-detected': ['Transparency observed', 'Significant transparent and visible pixels were found in the sampled browser frames. This does not measure cutout quality.'],
      'fully-transparent-samples': ['All sampled alpha is zero', 'These samples contain no visible subject. A blank clip is different from a visible cutout.'],
      'no-transparency-observed': ['No transparency observed', 'The sampled browser pixels are opaque at these thresholds. This does not prove the file lacks alpha: check with FFmpeg or another compatible destination.'],
      'inconclusive': ['Inconclusive samples', 'Some lower alpha values exist, but they do not meet the configured significance and visibility criteria.'],
    };
    const [heading, explanation] = descriptions[result.report.status]; title.textContent = heading!; detail.textContent = explanation!;
    badge.textContent = 'Sampled'; info.textContent = `${result.report.source.width} × ${result.report.source.height} · ${result.report.source.durationSeconds.toFixed(2)}s · 4 samples · known VP9 control passed`;
    showFrames(result.frames); reportText = JSON.stringify(result.report, null, 2); output.value = reportText; download.disabled = false;
    progress.textContent = 'Inspection complete. Change the background to compare the preview.';
  } catch (error) {
    if (controller !== current) return;
    title.textContent = 'No verdict produced'; detail.textContent = error instanceof Error ? error.message : 'Could not inspect this video.';
    progress.textContent = current.signal.aborted ? 'Inspection cancelled or timed out. No partial report was saved.' : 'Inspection failed. Try another sample or use the FFmpeg inspector.';
    progress.dataset.error = 'true'; badge.textContent = 'Not verified'; badge.dataset.state = 'error';
  } finally { clearTimeout(timer); if (controller === current) { controller = undefined; inspect.disabled = false; cancel.disabled = true; } }
}
function replaceSource(url: string, name: string, local: boolean) {
  invalidate(); video.pause(); video.removeAttribute('src'); video.load();
  if (source.local) URL.revokeObjectURL(source.url);
  source = { url, name, local }; sourceName.textContent = name;
}
document.querySelectorAll<HTMLButtonElement>('[data-sample]').forEach(button => button.addEventListener('click', () => {
  const key = button.dataset.sample!; if (!Object.hasOwn(names, key)) return;
  replaceSource(new URL(`./media/${key}.webm`, document.baseURI).href, names[key]!, false); file.value = '';
  document.querySelectorAll('[data-sample]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); void run();
}));
document.querySelectorAll<HTMLButtonElement>('.backgrounds button').forEach(button => button.addEventListener('click', () => {
  byId('stage').dataset.background = button.dataset.background;
  document.querySelectorAll('.backgrounds button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
}));
file.addEventListener('change', () => {
  const chosen = file.files?.[0]; if (!chosen) return;
  invalidate(); video.pause(); video.removeAttribute('src'); video.load();
  if (source.local) URL.revokeObjectURL(source.url);
  source = { url: '', name: chosen.name, local: false }; sourceName.textContent = chosen.name;
  document.querySelectorAll('[data-sample]').forEach(item => item.setAttribute('aria-pressed', 'false'));
  if (!/\.webm$/i.test(chosen.name) || !chosen.size || chosen.size > 64 * 1024 * 1024) {
    title.textContent = 'Choose a supported file'; detail.textContent = 'Use a non-empty local .webm file up to 64 MiB. No verdict was produced.'; progress.textContent = 'Unsupported file or size. Choose another file.'; progress.dataset.error = 'true'; badge.textContent = 'Check file'; badge.dataset.state = 'error'; inspect.disabled = true; return;
  }
  source = { url: URL.createObjectURL(chosen), name: chosen.name, local: true }; void run();
});
inspect.addEventListener('click', () => { if (source.url) void run(); });
cancel.addEventListener('click', () => controller?.abort());
download.addEventListener('click', () => {
  if (!reportText) return; const url = URL.createObjectURL(new Blob([reportText], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'browser-alpha-report.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
});
window.addEventListener('pagehide', () => { controller?.abort(); if (source.local) URL.revokeObjectURL(source.url); });
void run();
