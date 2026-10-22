# video-alpha-inspector

Inspect **decoded alpha pixels** in local videos with Node.js and FFmpeg.
Get a typed report or JSON from the CLI, instead of treating an `alpha_mode`
tag or a checkerboard preview as proof of transparency.

Useful for export checks, transparent-video pipelines, and media-tool backends.
The package has **no runtime npm dependencies**. FFmpeg and ffprobe are separate
system requirements; no binaries are bundled or downloaded during installation.

Need a ready-made workflow? [BG Remover Online](https://bgremover.online/)
provides video background removal and a
[transparency checker](https://bgremover.online/converters/transparency-checker/).
This library was prepared for that workflow; deployment into the website is pending.

## Run from GitHub

**Registry publication is pending.** The repository is usable now; there is no
public npm installation command until the first registry release.

Requirements: Node.js 22 or newer, FFmpeg and ffprobe on PATH. The FFmpeg build
must include `libvpx-vp9` and `libvpx` decoders for VP9/VP8 alpha. Tests also
require the `libvpx-vp9`, `libvpx`, `prores_ks` and `libx264` encoders.
See the [official FFmpeg download page](https://ffmpeg.org/download.html) for builds.

```sh
git clone https://github.com/j-river/video-alpha-inspector.git
cd video-alpha-inspector
npm ci --ignore-scripts
npm run check
node dist/cli.js ./cutout.webm --json
```

`npm pack` builds an installable local tarball. Install it in another project
with `npm install /path/to/video-alpha-inspector-0.1.0.tgz`.
After installation, the command is `video-alpha`.

## API

```js
import { inspectVideoAlpha } from 'video-alpha-inspector';

const report = await inspectVideoAlpha('./cutout.webm', {
  sampleFractions: [0, 0.25, 0.5, 0.75],
  timeoutMs: 60_000,
});

console.log(report.status);
console.log(report.video.alphaMetadata); // A hint, independently reported.
console.log(report.samples[0].alpha.transparentFraction);
```

CommonJS is supported: `const { inspectVideoAlpha } = require('video-alpha-inspector')`.
Type declarations ship for both module formats. To use the source checkout
directly, import from `./dist/index.js` after building.

| Status | Meaning |
| --- | --- |
| `transparency-detected` | At least one sample has significant transparent pixels, and at least one has significant visible pixels. They may be different frames. |
| `fully-transparent-samples` | Every sampled alpha value is exactly zero. The sampled frames contain no visible subject. |
| `no-transparency-observed` | All sampled alpha values are at or above the transparency threshold. This is not proof about unsampled frames. |
| `inconclusive` | Some lower alpha values exist, but the configured significance/visibility criteria are not met. |

`video` contains codec, pixel format, stream index, dimensions, reported duration,
and the metadata hint. Each sample includes its **requested** seek time, sampled
dimensions, and alpha statistics. The input filename and full ffprobe metadata
are not included in reports.

### Sampling and thresholds

By default the inspector requests a frame at 0%, 25%, 50% and 75% of the reported
duration. It selects the first video stream excluding attached cover art. If
duration is unknown, only the first frame is requested and
`sampling.firstFrameOnly` is true. Times are seek requests, not measured frame
timestamps; FFmpeg may return the next available frame. A missing sample fails
with `NO_FRAME`, rather than producing a negative transparency result.

Samples preserve aspect ratio and are never upscaled. Their long edge is at most
512 pixels by default, using nearest-neighbor scaling. Default significance is
at least 1% of sampled pixels (rounded up): alpha **<245** counts as transparent,
and alpha **>10** counts as visible. These sets intentionally overlap, because a
partially transparent pixel can be visible.

```js
const report = await inspectVideoAlpha('./overlay.mov', {
  maxSampleSide: 1024,
  transparentBelow: 250,
  visibleAbove: 5,
  minPixelFraction: 0.005,
});
```

Sampling can miss short changes between requested frames and small features
lost during scaling. It cannot certify a whole clip, assess cutout quality,
prove that a target browser displays alpha, or distinguish straight from
premultiplied color. A baked-in checkerboard with opaque alpha remains opaque.

### Supported codecs

| Codec | Decode path | Verified with generated fixtures |
| --- | --- | --- |
| VP9 / WebM | Explicit `libvpx-vp9` | Transparent, opaque with/without alpha metadata, all-zero alpha, temporal changes |
| VP8 / WebM | Explicit `libvpx` | Transparent cutout |
| ProRes / MOV | Native FFmpeg decoder | ProRes 4444 with partial alpha |
| H.264 / MP4 | Native FFmpeg decoder | Opaque control |

The inspector decodes pixels even if metadata does not advertise alpha.
VP8/VP9 use libvpx explicitly to preserve WebM alpha side data. A missing decoder
produces an error. **HEVC with alpha is not supported**, and other codecs are
rejected rather than silently assumed opaque. General playback/encoding support
of FFmpeg is broader than the verified scope of this library.

### Pure alpha statistics

`analyzeAlphaPlane` accepts an 8-bit `Uint8Array` with **one alpha byte per pixel**,
not interleaved RGBA. It does no I/O and does not change the input.

```js
import { analyzeAlphaPlane } from 'video-alpha-inspector';

const stats = analyzeAlphaPlane(Uint8Array.from([0, 128, 255]));
// zeroPixels=1, partialPixels=1, opaquePixels=1
// transparentPixels=2, visiblePixels=2 with the default thresholds
```

The statistics also expose min/max/mean, fractions, and significance booleans.
This package entry imports Node.js modules; a standalone browser entry is not
included in v0.1.0.

### Limits, cancellation and errors

| Option / bound | Default | Maximum |
| --- | --- | --- |
| `timeoutMs` | 60,000 total for probe and decodes | 300,000 |
| `maxInputBytes` | 512 MiB | 2 GiB |
| `maxDurationSeconds` | 600 | 3,600 |
| `maxSampleSide` | 512 | 2,048 |
| `sampleFractions` | `[0,.25,.5,.75]` | 16 values, each >=0 and <1; sorted and deduplicated |
| Source dimensions | — | 8,192 per side and 33,554,432 pixels |
| ffprobe JSON / stderr | — | 2 MiB / 64 KiB per process |
| `analyzeAlphaPlane` input | — | 16,777,216 pixels |

Decoded stdout is capped at the expected one-frame alpha-plane size. Processes
are killed on timeout, cancellation or output overflow. Executables can be
selected with `ffmpegPath` and `ffprobePath`; these are paths, not shell commands.

```js
import { AlphaInspectionError, inspectVideoAlpha } from 'video-alpha-inspector';

try {
  await inspectVideoAlpha('./cutout.webm', { signal: AbortSignal.timeout(5000) });
} catch (error) {
  if (error instanceof AlphaInspectionError) console.error(error.code, error.message);
  else throw error;
}
```

Error codes: `INVALID_OPTIONS`, `INVALID_INPUT`, `INPUT_LIMIT`, `TOOL_UNAVAILABLE`,
`PROBE_FAILED`, `INVALID_PROBE`, `NO_VIDEO`, `UNSUPPORTED_CODEC`, `DECODE_FAILED`,
`NO_FRAME`, `OUTPUT_LIMIT`, `TIMEOUT`, `ABORTED`.
Errors reject the promise; they are never converted to an opaque-file result.

## CLI

```sh
video-alpha ./cutout.webm
video-alpha ./cutout.webm --json --require-transparency
video-alpha ./overlay.mov --samples 0,0.1,0.5,0.9 --max-sample-side 1024
video-alpha ./cutout.webm --timeout-ms 10000 --ffmpeg /path/to/ffmpeg
```

Exit codes: **0** means inspection completed (or the requested condition passed),
**1** means `--require-transparency` was requested but its condition was unmet,
and **2** means an error. That condition accepts only `transparency-detected`;
fully transparent samples do not count as a visible cutout. JSON/text reports
go to stdout, errors to stderr. Use `--` before a filename beginning with `-`.
`--help` and `--version` do not need FFmpeg.

## Privacy and operation

Only local, non-empty regular files are accepted. The library starts processes
without a shell, restricts FFmpeg input protocols to `file`, performs no uploads
or telemetry, and does not overwrite source files. No provider account or API
key is required. Your chosen FFmpeg binaries and local filesystem are trusted.

FFmpeg is a complex native media parser. These limits bound process time and
captured output; they are not an OS memory sandbox or protection against every
malicious file. A server accepting untrusted media should use maintained FFmpeg
builds, isolated workers and appropriate OS resource limits.

## Development

```sh
npm ci --ignore-scripts
npm run check
npm run test:package
npm run demo
```

Tests generate small clips from synthetic shapes and silence. They use actual
FFmpeg decoding, not only mocked metadata, and **fail** if required tools/codecs
are missing. No user media or binaries are stored in Git. The package test
installs the actual tarball in a temporary project and checks ESM, CommonJS,
type declarations and CLI behavior. CI covers Node 22/24 on Linux and Windows.
See the actual run before interpreting this matrix as passing evidence.

The demo prints a summary for generated clips. To inspect your own file:
`node examples/inspect.mjs ./cutout.webm` after building.

See [design and evidence](docs/design.md), [contribution notes](CONTRIBUTING.md)
and [the changelog](CHANGELOG.md).

## License

MIT © j-river. FFmpeg is a separate executable with its own
[licensing requirements](https://ffmpeg.org/legal.html); it is not distributed
in this package. This is an independent project, not an official FFmpeg product.
