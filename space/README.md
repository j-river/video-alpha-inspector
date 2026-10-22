---
title: Video Alpha Inspector
emoji: 🔍
colorFrom: blue
colorTo: green
sdk: static
app_file: index.html
license: mit
short_description: Check sampled WebM alpha locally, with synthetic controls.
tags:
  - video
  - transparency
  - webm
  - typescript
---

# Video Alpha Inspector

Inspect **browser-decoded alpha pixels** in a local WebM, compare backgrounds,
and learn why a baked checkerboard is not transparency. This static demo uses
the browser-safe statistics entry from
[video-alpha-inspector](https://github.com/j-river/video-alpha-inspector).
Its Node.js / FFmpeg decoder is a separate, independent check.

## Try the controls

- Transparent cutout: a visible subject with clear surroundings.
- Baked checkerboard: opaque squares written into the video itself.
- Partial alpha: a translucent subject.
- Fully transparent: zero alpha throughout the samples, with no visible subject.

All four clips are generated from synthetic RGBA frames during the build. They
contain no user footage, audio, logos, third-party photos or downloaded assets.
The sample generator is in the public source repository.

Choose a clip or a local `.webm`, then switch Checker, Light, Dark and Pink.
The page requests four sample positions: 0%, 25%, 50% and 75%. Color thumbnails
and greyscale alpha masks show what the browser exposed to Canvas. The JSON
report contains statistics and technical dimensions, not filenames or media.

## Limits and interpretation

- Browser input: non-empty WebM up to 64 MiB, 120 seconds, 4,096 px per side and
  8,388,608 source pixels. Samples are never upscaled; long edge at most 512 px.
- Each inspection has a 30-second overall budget and eight seconds per media wait.
- Before inspecting the selected source, a known-transparent VP9 clip must yield
  significant transparent **and** visible pixels. If that control fails, the app
  returns no verdict. A passing control does not certify every file or codec.
- Alpha below 245 counts as transparent; alpha above 10 counts as visible.
  Significance requires at least 1% of the sampled pixels, rounded up. These sets
  overlap for partially transparent pixels.
- A negative result means **no transparency observed by this browser**. Decoder
  alpha loss is still possible. Sampling and downscaling can miss details or
  brief changes. Requested seek times are not verified decoded-frame timestamps.
- ProRes and HEVC alpha are outside this browser demo. It does not remove a
  background, evaluate cutout quality or determine alpha premultiplication.

For an independent local decode, use the repository's FFmpeg CLI, which explicitly
selects libvpx for VP8/VP9 alpha. It also supports ProRes and an H.264 control;
HEVC alpha is not supported. npm registry publication is still pending.

## Privacy

Your selected video stays in browser memory via a local Blob URL. The app has no
upload endpoint, telemetry, persistent storage, remote runtime scripts or API
keys. Bundled controls are loaded from the same static host. External links are
opened only when you choose them. Hosting providers may log page requests.

For video background removal and export workflows, visit
[BG Remover Online](https://bgremover.online/) or its
[transparency checker](https://bgremover.online/converters/transparency-checker/).
This demo does not send your video to that website. Production integration of
the Node.js library is pending; this public playground is independently usable.

## Reproduce

Clone [j-river/video-alpha-inspector](https://github.com/j-river/video-alpha-inspector),
install development dependencies with `npm ci --ignore-scripts`, then run
`npm run build` and `npm run test:space`. Node.js 22+, FFmpeg and ffprobe are
required for development and the synthetic fixture checks. Upload only the ten
files inside `.artifacts/hf-space/`, preserving `assets/` and `media/`, to a
Static Hugging Face Space. Visitors do not need FFmpeg or an account.

MIT licensed. FFmpeg is used to prepare test media but is not shipped in the demo.
