# Video Editor

A video editor that runs in your browser. Your videos never leave your device.

Try it live: [Video Editor](https://rehmozayub.github.io/tools-for-everyone/Video%20Editor/video_editor.html)

## Features

| Job | How |
|---|---|
| Trim and cut | Drag the edges of a clip, or type the start and end. To take a part out of the middle, split at both ends of it and delete the piece. |
| Join | Add several videos and pictures, then drag them on the timeline into the order you want. |
| Crop, rotate, flip | Draw the crop on the preview, free or locked to 16:9, 9:16, 1:1 or 4:5. Turn a quarter at a time and flip either way. |
| Speed | 0.25× to 4× per clip. Voices keep their normal pitch, in the preview and in the export. |
| Text | Titles and captions with a box, an outline or a shadow, any colour, three fonts. Drag them on the picture and on the timeline. |
| Sound | Change a clip's volume up to 200% or mute it. Add music or a voice-over with its own volume and fades. |
| Shape | Keep the first clip's shape, or make the whole video 16:9, 9:16, 1:1, 4:5 or 4:3, with black bars, a blurred background or the edges cut off. |
| Export | MP4 (H.264 and AAC) or WebM (VP9 and Opus), at 1080p, 720p, 480p or the original size, 24, 30 or 60 fps. |

Everything can be undone and redone. Keyboard: Space plays, S splits, Delete removes, Ctrl+Z undoes, the arrow keys step one frame. Recordings from the [Screen Recorder](../Screen%20Recorder/) open here in one click, and a finished video can go on to Video Converter or Audio Transcriber.

## How it works

The preview plays your files with the browser's own player and draws every frame through the same code the export uses, so what you see is what you get. The export reads each file with [Mediabunny](https://github.com/Vanilagy/mediabunny), draws the frames, and encodes them with your device's video encoder (WebCodecs). Sound is mixed a few seconds at a time, so long videos do not fill up memory, and speed changes go through a time stretcher (WSOLA) that keeps pitch.

It needs a browser with WebCodecs video encoding: Chrome or Edge, Firefox 130 or later, or Safari 16.4 or later. Files the browser cannot decode (some HEVC or AVI files, for example) can be turned into an MP4 in [Video Converter](../Video%20Converter/) first. There is no Python version of this tool.

## Usage

Open [`video_editor.html`](video_editor.html) through any local web server, or use the [live version](https://rehmozayub.github.io/tools-for-everyone/Video%20Editor/video_editor.html). The pure editing logic lives in [`editor-core.js`](editor-core.js), which also loads in Node.

## License

MIT, see [LICENSE](../LICENSE)
