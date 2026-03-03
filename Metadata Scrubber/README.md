# 🛡️ Metadata Scrubber

A privacy-focused metadata inspector and remover for **images and documents**.  
Built with **Streamlit** — everything runs locally, no file uploads to external servers.

## Supported Formats

| Type | Formats | What Gets Stripped/Processed |
|------|---------|-------------------|
| 🖼️ Images | JPG, PNG, WebP, TIFF, BMP | EXIF data, GPS coordinates, camera serial numbers, owner names |
| 📝 Word | DOCX | Author, company, last editor, revision history, tracked changes, comments |
| 📄 PDF | PDF | Author, creator app, producer, XMP metadata, creation/mod dates. Supports embedded image extraction. |
| 📊 Excel | XLSX | Author, company, manager, hidden sheets detected, named ranges |
| 📽️ PowerPoint | PPTX | Author, company, last editor, speaker notes count, comments |

## Features

### 🚀 App Modes & Input Methods
- **Multi-Source Inputs:** Upload local files directly or fetch them from a **URL**.
- **Scrub & Edit Mode:** The standard mode for inspecting, selecting, and stripping metadata.
- **Compare Mode:** Side-by-side metadata diff viewer for two files. Easily compare metadata fields to spot differences.

### 🔍 Inspect & Extract
- **Images:** Categorized EXIF tables (Basic, Camera, GPS, Advanced, All), interactive GPS map.
- **Documents:** Properties table + document info (pages, sheets, slides, comments, hidden sheets, speaker notes).
- **PDF Asset Extraction:** Extract embedded images directly from PDF files.
- Privacy risk flags for sensitive data.
- Export metadata as JSON per file.

### 🧹 Strip & Edit
- **Selective Metadata Removal:** Choose exactly which tags to keep or remove before scrubbing.
- Remove all metadata from any supported file type.
- Orientation preservation for images.
- Per-file or batch stripping.
- Download individual cleaned files or all as a ZIP archive.

### Unified Single-Page UI
Upload one or many files (images + documents mixed) in one go. Everything is on a single page:
- **Summary table** at the top with file type, metadata count, GPS indicator, and risk count
- **Metrics row** showing total files, images vs. docs, metadata count, and privacy risks
- **Strip All** button to batch-process everything and download as ZIP
- **Per-file expanders** with full metadata inspection, privacy alerts, and individual strip + download

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
- **PyMuPDF (fitz)** — PDF metadata, XMP removal, & image extraction
- **requests** — URL file fetching
- **pandas** — Table display
- **lxml** — XML processing

## License

MIT — see [LICENSE](../LICENSE)
