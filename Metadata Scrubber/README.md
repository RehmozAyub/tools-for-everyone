# 🛡️ Metadata Scrubber

A privacy-focused metadata inspector and remover for **images and documents**.  
Built with **Streamlit** — everything runs locally, no file uploads to external servers.

## Supported Formats

| Type | Formats | What Gets Stripped |
|------|---------|-------------------|
| 🖼️ Images | JPG, PNG, WebP, TIFF, BMP | EXIF data, GPS coordinates, camera serial numbers, owner names |
| 📝 Word | DOCX | Author, company, last editor, revision history, tracked changes, comments |
| 📄 PDF | PDF | Author, creator app, producer, XMP metadata, creation/mod dates |
| 📊 Excel | XLSX | Author, company, manager, hidden sheets detected, named ranges |
| 📽️ PowerPoint | PPTX | Author, company, last editor, speaker notes count, comments |

## Features

### Unified Single-Page UI
Upload one or many files (images + documents mixed) in one go. Everything is on a single page:

- **Summary table** at the top with file type, metadata count, GPS indicator, and risk count
- **Metrics row** showing total files, images vs. docs, metadata count, and privacy risks
- **Strip All** button to batch-process everything and download as ZIP
- **Per-file expanders** with full metadata inspection, privacy alerts, and individual strip + download

### Inspect
- **Images:** Categorized EXIF tables (Basic, Camera, GPS, Advanced, All), interactive GPS map
- **Documents:** Properties table + document info (pages, sheets, slides, comments, hidden sheets, speaker notes)
- Privacy risk flags for sensitive data
- Export metadata as JSON per file

### Strip
- Remove all metadata from any supported file type
- Orientation preservation for images
- Per-file or batch stripping
- Download individual cleaned files or all as ZIP

## Installation

```bash
pip install -r requirements.txt
```

## Usage

```bash
cd "Metadata Scrubber"
streamlit run metadata_scrubber.py
```

Then open `http://localhost:8501` in your browser.

## Dependencies

- **Streamlit** — Web UI
- **Pillow** — Image processing & EXIF reading
- **piexif** — EXIF removal for JPEG/WebP
- **python-docx** — Word document metadata
- **openpyxl** — Excel spreadsheet metadata
- **python-pptx** — PowerPoint metadata
- **PyMuPDF** — PDF metadata & XMP removal
- **pandas** — Table display
- **lxml** — XML processing

## License

MIT — see [LICENSE](../LICENSE)
