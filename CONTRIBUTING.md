# Contributing

Use Node.js 22+ and an FFmpeg build with libvpx, prores_ks and libx264.
Run `npm ci --ignore-scripts`, `npm run check` and `npm run test:package`.

Report the Node/FFmpeg versions, codec, pixel format, sample settings and expected
behavior. Prefer a tiny synthetic reproducer. Do not post private videos,
credentials, signed download URLs or unredacted metadata.

New codec support needs a reproducible alpha-bearing fixture and an opaque
control. Do not infer transparency solely from metadata or convert decoder errors
into negative results. Keep the sampling limitations visible in public docs.

Keep the core independent of any service account, renderer or background-removal
provider. Contributions are accepted under the project's MIT license.
