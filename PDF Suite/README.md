# 📄 PDF Suite

A comprehensive, all-in-one PDF toolkit built with **Streamlit** and **PyMuPDF**.  
Everything runs locally — no files are uploaded to external servers.

## Features

| Tool | Description |
|------|-------------|
| 🔗 Merge PDFs | Combine multiple PDFs into one |
| ✂️ Split PDF | Extract pages or split into individual files |
| 🗜️ Compress PDF | Reduce file size with adjustable quality |
| 📝 Extract Text | Pull text out as `.txt` or `.md` |
| 🖼️ PDF → Images | Convert pages to PNG / JPEG / WebP |
| 📄 Images → PDF | Combine images into a PDF |
| 🔄 Rotate Pages | Rotate all or specific pages |
| 💧 Watermark | Add customizable diagonal text watermarks |
| 🔢 Page Numbers | Stamp page numbers in various formats |
| 🔒 Protect PDF | Password-protect with AES-256 encryption |

## Installation

```bash
pip install -r requirements.txt
```

## Usage

```bash
cd "PDF Suite"
streamlit run pdf_suite.py
```

Then open `http://localhost:8501` in your browser.

## Dependencies

- **Streamlit** — Web UI framework  
- **PyMuPDF (fitz)** — Fast, full-featured PDF processing  
- **Pillow** — Image handling for conversions & compression  

## License

MIT — see [LICENSE](../LICENSE)
