# HLS video playback

`hls.light.min.mjs` is the unmodified light ES module build of **hls.js 1.7.4**,
published by the [video-dev/hls.js](https://github.com/video-dev/hls.js) project.
The upstream license notice is included in `hls.LICENSE.txt`; the Apache 2.0
license text is included in `Apache-2.0.txt`.

Source: `https://cdn.jsdelivr.net/npm/hls.js@1.7.4/dist/hls.light.min.mjs`

SHA-256: `3d82a88cf9ae0d9aaab3cbe9ff6ecbb64bb89c54a399c34ae9bf8b559baeb20f`

The reader imports this local file only after a user clicks Play on an HLS
video. It uses hls.js when Media Source Extensions support the video codecs,
and falls back to native HLS when MSE is unavailable or the module cannot load.
No CDN script is loaded at runtime. Workers are disabled so the player does
not require a blob-worker exception in the site's content security policy.
