# Image Compressor

A browser-based image compressor and converter. No install, no upload.

Try it live: [Image Compressor](https://rehmozayub.github.io/tools-for-everyone/Image%20Compressor/image_compressor.html)

## Features

| Feature | Description |
|---|---|
| Compress | Reduce JPG, PNG, and WebP file size with an adjustable quality slider |
| Convert | Switch between JPEG, PNG, and WebP, or keep the original format |
| Resize | Cap the output to a max width and height while keeping the aspect ratio |
| Batch | Process any number of images at once, download individually or as a ZIP |

## How it works

Everything runs through the HTML5 Canvas API directly in your browser. Each image is drawn to a canvas at the target size and re-encoded at the chosen quality with `canvas.toBlob()`. Nothing is ever sent to a server, there is no Python version of this tool.

## Usage

Open [`image_compressor.html`](image_compressor.html) in any modern browser, or use the [live version](https://rehmozayub.github.io/tools-for-everyone/Image%20Compressor/image_compressor.html). No installation needed.

## License

MIT, see [LICENSE](../LICENSE)
