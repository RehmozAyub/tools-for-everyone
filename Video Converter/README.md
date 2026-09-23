# Video Converter

A browser-based video converter: video to GIF, compression and format conversion. No install, and your videos never leave your device.

Try it live: [Video Converter](https://rehmozayub.github.io/tools-for-everyone/Video%20Converter/video_converter.html)

## Features

| Tool | Description |
|---|---|
| Video to GIF | Trim with a preview player, choose frame rate and width, and a proper colour palette for clean GIFs |
| Compress video | Presets such as "Email, under 25 MB" and "Discord, under 10 MB", or any target size, with resolution set by the short side so portrait videos work |
| Convert | MP4 (web optimised), WebM, or extract the sound as MP3 or M4A, with an option to remove audio |

Every job can be cancelled, shows time left, and warns before you leave the page mid-encode.

## How it works

Where the browser has a suitable built-in video encoder, the tool uses it through WebCodecs ([Mediabunny](https://github.com/Vanilagy/mediabunny)), which is much faster. Otherwise it runs [ffmpeg](https://ffmpeg.org/) compiled to WebAssembly ([ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)). The ffmpeg engine is about 31 MB unpacked, about 9 MB to download, and is kept on your device after the first use, so later visits start instantly and work offline. There is no Python version of this tool.

## Usage

Open [`video_converter.html`](video_converter.html) through any local web server, or use the [live version](https://rehmozayub.github.io/tools-for-everyone/Video%20Converter/video_converter.html).

## License

MIT, see [LICENSE](../LICENSE)
