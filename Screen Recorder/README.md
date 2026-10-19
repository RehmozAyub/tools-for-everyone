# Screen Recorder

A screen and camera recorder that runs in your browser. Recordings stay on your device.

Try it live: [Screen Recorder](https://rehmozayub.github.io/tools-for-everyone/Screen%20Recorder/screen_recorder.html)

## Features

| Feature | Details |
|---|---|
| What to record | A whole screen, one window or a browser tab, or just your camera |
| Sound | The sound the screen or tab plays, and your microphone, each with its own volume (up to 200%) and level meter, mixed into one track. Optional noise and echo reduction for the microphone. |
| Camera bubble | Your camera in a circle or rounded square, small, medium or large, in any corner or dragged anywhere, even while recording. Optionally mirrored. |
| Controls | A 3 or 5 second countdown, pause and resume, mute the microphone, and stop from the page or from the browser's own "Stop sharing" button. The tab title shows the time while you work elsewhere. |
| Quality | Original size, 1080p or 720p, at 30 or 60 fps |
| Crash safe | Saved to your device a second at a time. If the tab closes or the browser crashes, the recording is offered for recovery the next time you open the page. |
| Files | MP4 (H.264) where the browser can record it, otherwise WebM. Recordings are kept on this device until you delete them, and open in the [Video Editor](../Video%20Editor/) in one click. |

## Which browsers record system sound

Browsers decide this, not the page:

- **Chrome and Edge on Windows and ChromeOS**: the whole system's sound when you share a screen, or a tab's sound when you share a tab. Keep the audio switch in the sharing window on.
- **Chrome and Edge on a Mac**: a tab's sound only.
- **Firefox and Safari**: no system sound. The microphone works.
- **Phones and tablets**: browsers there cannot share the screen with a web page. Camera recording works.

## How it works

The screen, camera and microphone come from the browser's own capture (`getDisplayMedia` and `getUserMedia`). Sound is mixed with the Web Audio API. When the camera bubble is on, or a window or tab is recorded (they can change size), the picture is drawn into a frame of fixed size, driven by a timer in a worker, so it keeps going while you look at another window. The browser's `MediaRecorder` records H.264, and every second of it is written to IndexedDB. When you stop, [Mediabunny](https://github.com/Vanilagy/mediabunny) copies the picture into a proper MP4 with a duration you can seek in, and turns the sound into AAC when the device can, without encoding the picture again. There is no Python version of this tool.

## Usage

Open [`screen_recorder.html`](screen_recorder.html) through any local web server (screen capture needs `http://localhost` or HTTPS), or use the [live version](https://rehmozayub.github.io/tools-for-everyone/Screen%20Recorder/screen_recorder.html). The pure logic lives in [`recorder-core.js`](recorder-core.js), which also loads in Node.

## License

MIT, see [LICENSE](../LICENSE)
