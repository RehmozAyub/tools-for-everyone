# Image Compressor

A browser-based image compressor and converter. No install, and your images never leave your device.

Try it live: [Image Compressor](https://rehmozayub.github.io/tools-for-everyone/Image%20Compressor/image_compressor.html)

## Features

| Feature | Description |
|---|---|
| Compress | Adjustable quality, or a target file size such as "under 200 KB" |
| Convert | JPEG, PNG, WebP and AVIF, or keep the original format |
| Never bigger | If a result is not smaller than the original, the original is kept |
| Compare | A before and after slider with 100% zoom, and a quality override per image |
| Smaller PNGs | Optional colour reduction, the technique TinyPNG uses |
| Best compression | Optional MozJPEG, libwebp and OxiPNG encoders from [jSquash](https://github.com/jamsinclair/jSquash) |
| Resize | Max size, long edge, percent, square, or presets such as 1080p and 4K |
| Location data | Removes GPS and camera details by default, or keeps them in JPEGs |
| Batch | Add, paste or drop any number of images, then download one by one or as a ZIP |

## How it works

Images are decoded and re-encoded in background workers (`compress-worker.js`, sharing `compress-core.js`), so the page stays responsive during big batches. It falls back to the main thread in browsers without OffscreenCanvas. The optional encoders load from jsDelivr only when you pick them. There is no Python version of this tool.

## Usage

Open [`image_compressor.html`](image_compressor.html) through any local web server, or use the [live version](https://rehmozayub.github.io/tools-for-everyone/Image%20Compressor/image_compressor.html).

## License

MIT, see [LICENSE](../LICENSE)
