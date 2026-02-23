# 🔍 EXIF Stripper + Inspector

A privacy-focused image metadata tool built with **Streamlit**, **Pillow**, and **piexif**.  
Inspect, analyze, and strip EXIF data from your images — everything runs locally.

## Features

### 🔍 Inspect Metadata
| Feature | Description |
|---------|-------------|
| 📋 Categorized view | Metadata sorted into Basic, Camera, GPS, and Advanced tabs |
| ⚠️ Privacy alerts | Flags sensitive tags (GPS, serial numbers, owner names) |
| 🗺️ GPS map | Shows photo location on an interactive map if GPS data exists |
| 📜 JSON export | Download all metadata as a structured JSON file |

### 🧹 Strip Metadata
| Feature | Description |
|---------|-------------|
| 🖼️ Single image | Strip all EXIF from one image with before/after comparison |
| 📦 Batch mode | Process multiple images at once, download as ZIP |
| 🔄 Preserve orientation | Applies EXIF rotation physically before stripping (no flipped photos) |
| 📊 Size comparison | Shows original vs. cleaned file size and tags removed |

### Privacy Tags Detected
- GPS coordinates & altitude
- Camera / lens serial numbers
- Owner name, artist, copyright
- Unique image IDs

## Installation

```bash
pip install -r requirements.txt
```

## Usage

```bash
cd "EXIF Stripper"
streamlit run exif_stripper.py
```

Then open `http://localhost:8501` in your browser.

## Supported Formats

JPEG, PNG, WebP, TIFF, BMP, HEIC

## Dependencies

- **Streamlit** — Web UI framework
- **Pillow** — Image processing & EXIF reading
- **piexif** — EXIF removal for JPEG/WebP
- **pandas** — Metadata table display

## License

MIT — see [LICENSE](../LICENSE)
