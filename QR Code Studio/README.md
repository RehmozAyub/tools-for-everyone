# 📱 QR Code Studio

A full-featured QR code generator and decoder built with **Streamlit**, **qrcode**, and **OpenCV**.  
Everything runs locally — no files are uploaded to external servers.

## Features

### Generate
| Mode | Description |
|------|-------------|
| 📝 Text / URL | Plain text or any URL |
| 📶 WiFi | Generates scannable WiFi join QR (WPA/WEP/Open) |
| 👤 vCard Contact | Full contact card (name, phone, email, org, title, URL) |
| 📧 Email | Pre-filled mailto link (to, subject, body) |
| 📦 Batch | One QR per line, download all as ZIP |

### Decode
- Upload an image or use your camera
- Detects **multiple QR codes** in a single image
- Auto-parses WiFi, vCard, URL, and Email payloads
- Copy-friendly text output

### Customization
- 4 error correction levels (L / M / Q / H)
- Adjustable module size and border
- Custom foreground & background colors
- Export as **PNG**, **SVG**, or both

## Installation

```bash
pip install -r requirements.txt
```

## Usage

```bash
cd "QR Code Studio"
streamlit run qr_code_studio.py
```

Then open `http://localhost:8501` in your browser.

## Dependencies

- **Streamlit** — Web UI framework
- **qrcode[pil]** — QR code generation with PIL support
- **Pillow** — Image handling
- **OpenCV (headless)** — QR code detection & decoding
- **NumPy** — Image array processing

## License

MIT — see [LICENSE](../LICENSE)
