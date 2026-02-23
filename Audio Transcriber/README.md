# 🎙️ Audio Transcriber

A web-based audio transcription tool powered by **OpenAI Whisper API**, built with **Streamlit**.  
Handles files of any size with automatic chunking for files larger than 25 MB.

## Features

| Feature | Description |
|---------|-------------|
| 🎤 Multi-format | Supports MP3, WAV, FLAC, M4A, OGG, AAC, WMA |
| 📦 Large file support | Automatically splits files > 25 MB into chunks |
| 💾 Auto-save | Saves transcript to the same folder as the audio file |
| ⬇️ Download | Download transcript as `.txt` |
| 💰 Cost-effective | Uses Whisper API at ~$0.006 per minute of audio |

## Prerequisites

- **FFmpeg** must be installed and available on your system PATH
  - **Anaconda users:** `conda install -c conda-forge ffmpeg`
  - **Manual install:** Download from [ffmpeg.org](https://ffmpeg.org/download.html)
- **OpenAI API key** — get one at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

## Installation

```bash
pip install -r requirements.txt
```

## Configuration

Create a `.env` file in the `Audio Transcriber/` directory:

```env
OPENAI_API_KEY=sk-your-key-here
```

Alternatively, you can paste the API key directly in the sidebar when running the app.

## Usage

```bash
cd "Audio Transcriber"
streamlit run audio_transcriber_streamlit.py
```

Then open `http://localhost:8501` in your browser.

1. Enter your OpenAI API key (or load from `.env`)
2. Upload an audio file
3. Click **Start Transcription**
4. Download or copy the result

## How It Works

- Files under 25 MB are sent directly to the Whisper API
- Larger files are automatically split into ~20 MB chunks, transcribed individually, and merged back together
- Temporary files are cleaned up after processing

## Dependencies

- **Streamlit** — Web UI framework
- **OpenAI** — Whisper API client
- **pydub** — Audio file processing & chunking
- **python-dotenv** — Environment variable management
- **FFmpeg** — Audio codec support (system dependency)

## License

MIT — see [LICENSE](../LICENSE)
