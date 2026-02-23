# 🛡️ Metadata Scrubber

A privacy-focused metadata inspector and remover for **images AND documents**.  
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

### 🔍 Inspect Metadata
- **Images:** Categorized EXIF tables (Basic, Camera, GPS, Advanced), interactive GPS map, privacy risk alerts
- **Documents:** Core properties, document info (pages/sheets/slides), hidden sheet detection (XLSX), speaker notes count (PPTX)
- Privacy risk flags for sensitive data (author, GPS, serial numbers, company names)
- Export all metadata as JSON

### 🧹 Strip Single File
- Remove all metadata from any supported file type
- Before/after comparison for images
- Original vs. cleaned size metrics
- Orientation preservation for images (applies EXIF rotation physically)

### 📦 Batch Strip
- Upload mixed file types (images + documents together)
- Summary table with type, file name, metadata count, GPS indicator
- Download all cleaned files as ZIP
- Graceful error handling — failed files get included as originals

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

## Dependencies

- **Streamlit** — Web UI framework
- **Pillow** — Image processing & EXIF reading
- **piexif** — EXIF removal for JPEG/WebP
- **python-docx** — Word document metadata
- **openpyxl** — Excel spreadsheet metadata
- **python-pptx** — PowerPoint metadata
- **PyMuPDF** — PDF metadata & XMP removal
- **pandas** — Table display
- **lxml** — XML processing for Office documents

## License

MIT — see [LICENSE](../LICENSE)
