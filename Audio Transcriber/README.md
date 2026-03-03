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

## Installation

**FFmpeg** must be installed and available on your system PATH:
- **Anaconda:** `conda install -c conda-forge ffmpeg`
- **Manual:** Download from [ffmpeg.org](https://ffmpeg.org/download.html)

Then install Python dependencies:

```bash
pip install -r requirements.txt
```

## Usage

```bash
cd "Audio Transcriber"
streamlit run audio_transcriber_streamlit.py
```

Then open `http://localhost:8501` in your browser.

Enter your **OpenAI API key** in the sidebar, or create a `.env` file in the `Audio Transcriber/` directory:

```env
OPENAI_API_KEY=sk-your-key-here
```

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
