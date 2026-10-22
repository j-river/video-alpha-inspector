# Design and evidence

## Why pixels and metadata are separate

An alpha-capable codec or an `alpha_mode` tag says nothing about whether useful
transparent pixels were actually exported. In WebM, alpha side data may coexist
with ffprobe reporting `yuv420p`. A native VP9 decoder can discard that side data,
so this package explicitly requests the libvpx VP9/VP8 decoder.

The pipeline is:

1. Resolve/stat a local regular file and enforce its size limit.
2. Run ffprobe with file-only input protocols and capped JSON output.
3. Select one non-cover-art video stream, validate codec/dimensions/duration.
4. Request sampled frames with the decoder appropriate for that codec.
5. Convert to 8-bit RGBA, extract its alpha plane and scale with nearest neighbor.
6. Count transparent/visible pixels and report samples plus aggregate status.

Format conversion gives opaque input a 255 alpha value. The metadata hint is
reported separately and does not skip decoding or establish success. Converting
high-bit-depth ProRes to 8-bit alpha loses precision; thresholds are explicitly
defined in that 8-bit domain.

Requested fractions are not exact frame timestamps. Per-point seeking prioritizes
a small, inspectable implementation; long-GOP clips may decode repeatedly and
hit the shared timeout. Unknown duration restricts inspection to the first frame.
A failed or missing sample is an error, not negative evidence.

## Interpreting results

The default minimum is 1% of sampled pixels per frame. A significant transparent
sample and a significant visible sample can be different frames. Use individual
`samples[i].alpha` values if your application requires both in the same frame.

Fully zero-alpha samples receive a separate status. Some low alpha values below
the significance threshold yield `inconclusive`. `no-transparency-observed` is
deliberately limited to requested samples, not a guarantee about the entire file.

Nearest-neighbor downscaling and sparse time sampling can miss real transparency.
Tests include a clip with alpha changes between default sampling points: the
default check misses it while an explicit 35% sample detects it. This limitation
is part of the contract, not a whole-clip certification feature.

## Reproducible media cases

All fixtures are generated locally from FFmpeg lavfi sources; the generator is
`tests/helpers/fixtures.mjs`. No downloaded video or personal media is included.

- VP9/VP8: transparent canvas with an opaque central square.
- VP9: ordinary opaque, fully opaque alpha plane, entirely zero alpha plane.
- ProRes 4444: uniform partial alpha.
- H.264: opaque control.
- Temporal changes: late visible box and a brief alpha change between samples.
- Invalid controls: audio-only WAV, unsupported FFV1, damaged file, oversized metadata.

The tests assert pixel counts, not only the final status. Type and package tests
exercise both exports. Tests require the media tools and never silently skip.

## Website relationship

Prepared for the transparent-video inspection workflow of
[BG Remover Online](https://bgremover.online/). The library has no site-specific
provider calls, accounts, payments, storage configuration, upload services or
background-removal models. Website adoption/deployment is pending.

## Primary references

- [FFmpeg alphaextract filter](https://ffmpeg.org/ffmpeg-filters.html#alphaextract)
- [FFmpeg format filter](https://ffmpeg.org/ffmpeg-filters.html#format-1)
- [FFmpeg scale filter](https://ffmpeg.org/ffmpeg-filters.html#scale)
- [FFmpeg protocol whitelist](https://ffmpeg.org/ffmpeg-protocols.html#Protocol-Options)
- [FFmpeg command-line documentation](https://ffmpeg.org/ffmpeg.html)

These documents describe the underlying tools. The repository's own generated
media tests establish the narrower compatibility claims of this package.
