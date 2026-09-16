# Video Converter

A browser-based video converter: video to GIF, and video compression. No install, no upload.

Try it live: [Video Converter](https://rehmozayub.github.io/tools-for-everyone/Video%20Converter/video_converter.html)

## Features

| Tool | Description |
|---|---|
| Video to GIF | Convert a video clip to an animated GIF, with control over frame rate, max width, and clip duration |
| Compress Video | Shrink a video's file size with three compression levels and an optional max resolution, output is always MP4 |

## How it works

This tool runs a real build of [ffmpeg](https://ffmpeg.org/) compiled to WebAssembly ([ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)), entirely in your browser. The engine (about 9MB) downloads once on first use and is cached by your browser after that, so every conversion happens on your own device. There is no Python version of this tool.

Because it runs single-threaded WebAssembly (no server, no special hosting headers required), it works best on short clips. Longer or very large videos will take longer to process and use more memory.

## Usage

Open [`video_converter.html`](video_converter.html) in any modern browser, or use the [live version](https://rehmozayub.github.io/tools-for-everyone/Video%20Converter/video_converter.html). No installation needed.

## License

MIT, see [LICENSE](../LICENSE)
