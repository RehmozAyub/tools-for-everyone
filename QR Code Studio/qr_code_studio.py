"""
QR Code Studio — Generate & Decode QR Codes
Features: Text, URL, WiFi, vCard, Email, Batch, Decode, SVG/PNG export
Built with Streamlit + qrcode + OpenCV
"""

import streamlit as st
import qrcode
import qrcode.image.svg
from qrcode.constants import (
    ERROR_CORRECT_L,
    ERROR_CORRECT_M,
    ERROR_CORRECT_Q,
    ERROR_CORRECT_H,
)
from PIL import Image
import cv2
import numpy as np
import io
import zipfile
from datetime import datetime

# ─── Page Config ───
st.set_page_config(
    page_title="QR Code Studio",
    page_icon="📱",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── Custom CSS (consistent with PDF Suite / Bulk Renamer) ───
st.markdown("""
<style>
    .main-header {
        font-size: 2.5rem;
        font-weight: 700;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        text-align: center;
        margin-bottom: 0.2rem;
    }
    .sub-header {
        text-align: center;
        color: #888;
        margin-bottom: 2rem;
        font-size: 1.05rem;
    }
    .stDownloadButton > button {
        width: 100%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 8px;
        padding: 0.6rem 1rem;
        font-weight: 600;
    }
    .stDownloadButton > button:hover {
        background: linear-gradient(135deg, #764ba2 0%, #667eea 100%);
        color: white;
    }
    div[data-testid="stSidebar"] {
        background: #0e1117;
    }
    .tool-info {
        padding: 0.8rem 1rem;
        border-radius: 8px;
        background: #1a1a2e;
        border-left: 4px solid #667eea;
        margin-bottom: 1rem;
    }
    .decoded-box {
        padding: 1rem;
        border-radius: 8px;
        background: #1a2a1a;
        border: 1px solid #2d6a4f;
        color: #95d5b2;
        font-family: monospace;
        word-break: break-all;
    }
</style>
""", unsafe_allow_html=True)

# ─── Header ───
st.markdown('<div class="main-header">📱 QR Code Studio</div>', unsafe_allow_html=True)
st.markdown(
    '<div class="sub-header">Generate & decode QR codes — '
    'text, URLs, WiFi, contacts & more</div>',
    unsafe_allow_html=True,
)

# ─── Constants ───
ECC_MAP = {
    "Low (7%)": ERROR_CORRECT_L,
    "Medium (15%)": ERROR_CORRECT_M,
    "Quartile (25%)": ERROR_CORRECT_Q,
    "High (30%)": ERROR_CORRECT_H,
}


# ─── Helpers ───
def make_qr_image(data, ecc, box_size, border, fill_color, back_color):
    """Generate a QR code and return a PIL Image."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=ecc,
        box_size=box_size,
        border=border,
    )
    qr.add_data(data)
    qr.make(fit=True)
    return qr.make_image(fill_color=fill_color, back_color=back_color).convert("RGBA")


def make_qr_svg(data, ecc, box_size, border):
    """Generate a QR code and return SVG bytes."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=ecc,
        box_size=box_size,
        border=border,
    )
    qr.add_data(data)
    qr.make(fit=True)
    factory = qrcode.image.svg.SvgPathImage
    img = qr.make_image(image_factory=factory)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue()


def image_to_bytes(img, fmt="PNG"):
    """Convert PIL Image to bytes."""
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def build_wifi_payload(ssid, password, security, hidden):
    """Build WiFi QR code payload string."""
    # Escape special characters in SSID and password
    special = ['\\', ';', ',', '"', ':']
    escaped_ssid = ssid
    escaped_pw = password
    for ch in special:
        escaped_ssid = escaped_ssid.replace(ch, f"\\{ch}")
        escaped_pw = escaped_pw.replace(ch, f"\\{ch}")

    hidden_str = "H:true" if hidden else ""
    if security == "None":
        return f"WIFI:S:{escaped_ssid};T:nopass;{hidden_str};;"
    return f"WIFI:S:{escaped_ssid};T:{security};P:{escaped_pw};{hidden_str};;"


def build_vcard_payload(first, last, phone, email, org, title, url, note):
    """Build vCard 3.0 payload string."""
    lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        f"N:{last};{first};;;",
        f"FN:{first} {last}",
    ]
    if org:
        lines.append(f"ORG:{org}")
    if title:
        lines.append(f"TITLE:{title}")
    if phone:
        lines.append(f"TEL;TYPE=CELL:{phone}")
    if email:
        lines.append(f"EMAIL:{email}")
    if url:
        lines.append(f"URL:{url}")
    if note:
        lines.append(f"NOTE:{note}")
    lines.append("END:VCARD")
    return "\n".join(lines)


def build_email_payload(to, subject, body):
    """Build mailto payload string."""
    payload = f"mailto:{to}"
    params = []
    if subject:
        params.append(f"subject={subject}")
    if body:
        params.append(f"body={body}")
    if params:
        payload += "?" + "&".join(params)
    return payload


def decode_qr_from_image(img_bytes):
    """Decode QR code(s) from image bytes using OpenCV."""
    arr = np.frombuffer(img_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return []

    detector = cv2.QRCodeDetector()

    # Try multi-QR detection first
    try:
        retval, decoded_list, points, _ = detector.detectAndDecodeMulti(img)
        if retval and decoded_list:
            results = [d for d in decoded_list if d]
            if results:
                return results
    except Exception:
        pass

    # Fallback to single detection
    try:
        data, points, _ = detector.detectAndDecode(img)
        if data:
            return [data]
    except Exception:
        pass

    return []


def parse_wifi_payload(data):
    """Try to parse WiFi QR payload and return dict."""
    if not data.upper().startswith("WIFI:"):
        return None
    info = {}
    # Remove prefix and trailing ;;
    body = data[5:].rstrip(";")
    for part in body.split(";"):
        if ":" in part:
            key, val = part.split(":", 1)
            key = key.upper()
            if key == "S":
                info["SSID"] = val
            elif key == "P":
                info["Password"] = val
            elif key == "T":
                info["Security"] = val
            elif key == "H":
                info["Hidden"] = val
    return info if info else None


def parse_vcard_payload(data):
    """Try to parse vCard payload and return dict."""
    if "BEGIN:VCARD" not in data.upper():
        return None
    info = {}
    for line in data.strip().split("\n"):
        line = line.strip()
        if line.upper().startswith("FN:"):
            info["Name"] = line[3:]
        elif line.upper().startswith("TEL"):
            info["Phone"] = line.split(":", 1)[-1]
        elif line.upper().startswith("EMAIL"):
            info["Email"] = line.split(":", 1)[-1]
        elif line.upper().startswith("ORG:"):
            info["Organization"] = line[4:]
        elif line.upper().startswith("TITLE:"):
            info["Title"] = line[6:]
        elif line.upper().startswith("URL:"):
            info["URL"] = line[4:]
    return info if info else None


# ─── Sidebar ───
with st.sidebar:
    st.markdown("### 🧰 Mode")
    mode = st.radio("", ["✨ Generate", "🔍 Decode"], label_visibility="collapsed")

    st.markdown("---")

    if mode == "✨ Generate":
        st.markdown("### ⚙️ Settings")
        ecc_label = st.selectbox("Error correction", list(ECC_MAP.keys()), index=1)
        ecc = ECC_MAP[ecc_label]

        box_size = st.slider("Module size (px)", 4, 20, 10)
        border = st.slider("Border (modules)", 1, 8, 4)

        st.markdown("**Colors**")
        fill_color = st.color_picker("Foreground", "#000000")
        back_color = st.color_picker("Background", "#FFFFFF")

        export_fmt = st.radio("Export format", ["PNG", "SVG", "Both"], horizontal=True)

    st.markdown("---")
    st.markdown("##### ℹ️ About")
    st.markdown(
        "Free, open-source QR code tool.\n\n"
        "No file uploads to external servers — "
        "**everything runs locally on your machine.**"
    )
    st.markdown("---")
    st.markdown(
        "Made with ❤️ by "
        "[RehmozAyub](https://github.com/RehmozAyub)"
    )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# GENERATE MODE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if mode == "✨ Generate":

    payload_type = st.radio(
        "Payload type",
        ["📝 Text / URL", "📶 WiFi", "👤 vCard Contact", "📧 Email", "📦 Batch (multi-line)"],
        horizontal=True,
    )

    payload = ""

    # ---- TEXT / URL ----
    if payload_type == "📝 Text / URL":
        st.markdown("### 📝 Text / URL")
        payload = st.text_area(
            "Enter text or URL",
            placeholder="https://example.com or any text…",
            height=120,
        )

    # ---- WIFI ----
    elif payload_type == "📶 WiFi":
        st.markdown("### 📶 WiFi Network")
        st.markdown("Generate a QR code that lets people join your WiFi instantly.")

        c1, c2 = st.columns(2)
        ssid = c1.text_input("Network name (SSID)", placeholder="MyWiFi")
        security = c2.selectbox("Security", ["WPA", "WEP", "None"])

        password = ""
        if security != "None":
            password = st.text_input("Password", type="password")

        hidden = st.checkbox("Hidden network")

        if ssid:
            payload = build_wifi_payload(ssid, password, security, hidden)
            with st.expander("🔍 Preview payload"):
                st.code(payload, language="text")

    # ---- VCARD ----
    elif payload_type == "👤 vCard Contact":
        st.markdown("### 👤 vCard Contact")
        st.markdown("Generate a QR code that adds a contact when scanned.")

        c1, c2 = st.columns(2)
        first = c1.text_input("First name", placeholder="John")
        last = c2.text_input("Last name", placeholder="Doe")

        c3, c4 = st.columns(2)
        phone = c3.text_input("Phone", placeholder="+49 123 456 7890")
        email_addr = c4.text_input("Email", placeholder="john@example.com")

        c5, c6 = st.columns(2)
        org = c5.text_input("Organization", placeholder="Acme Inc.")
        title_field = c6.text_input("Job title", placeholder="Engineer")

        url_field = st.text_input("Website", placeholder="https://example.com")
        note = st.text_input("Note", placeholder="Met at conference 2026")

        if first or last:
            payload = build_vcard_payload(
                first, last, phone, email_addr, org, title_field, url_field, note
            )
            with st.expander("🔍 Preview payload"):
                st.code(payload, language="text")

    # ---- EMAIL ----
    elif payload_type == "📧 Email":
        st.markdown("### 📧 Email")
        st.markdown("Generate a QR code that opens a pre-filled email.")

        to = st.text_input("To address", placeholder="hello@example.com")
        subject = st.text_input("Subject", placeholder="Meeting follow-up")
        body = st.text_area("Body", placeholder="Hi there,\n\n", height=100)

        if to:
            payload = build_email_payload(to, subject, body)
            with st.expander("🔍 Preview payload"):
                st.code(payload, language="text")

    # ---- BATCH ----
    elif payload_type == "📦 Batch (multi-line)":
        st.markdown("### 📦 Batch Generate")
        st.markdown("One QR code per line. Download all as a ZIP.")

        batch_input = st.text_area(
            "Enter one item per line",
            placeholder="https://example.com\nhttps://github.com\nHello World",
            height=200,
        )
        items = [line.strip() for line in batch_input.strip().split("\n") if line.strip()]

        if items:
            st.info(f"📦 **{len(items)}** QR codes will be generated.")

            if st.button("📦 Generate Batch", type="primary", use_container_width=True):
                with st.spinner(f"Generating {len(items)} QR codes…"):
                    zbuf = io.BytesIO()
                    with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as zf:
                        for i, item in enumerate(items):
                            img = make_qr_image(
                                item, ecc, box_size, border,
                                fill_color, back_color,
                            )
                            zf.writestr(
                                f"qr_{i + 1:03d}.png",
                                image_to_bytes(img),
                            )

                st.success(f"✅ Generated {len(items)} QR codes")

                # Preview first 4
                preview_cols = st.columns(min(len(items), 4))
                for j in range(min(len(items), 4)):
                    with preview_cols[j]:
                        preview_img = make_qr_image(
                            items[j], ecc, box_size, border,
                            fill_color, back_color,
                        )
                        st.image(preview_img, caption=items[j][:30], width=180)

                st.download_button(
                    "⬇️ Download All (ZIP)",
                    data=zbuf.getvalue(),
                    file_name=f"qr_batch_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip",
                    mime="application/zip",
                    use_container_width=True,
                )

    # ---- SINGLE GENERATE + PREVIEW ----
    if payload_type != "📦 Batch (multi-line)" and payload:
        st.markdown("---")

        if st.button("✨ Generate QR Code", type="primary", use_container_width=True):
            with st.spinner("Generating…"):
                qr_img = make_qr_image(
                    payload, ecc, box_size, border,
                    fill_color, back_color,
                )
                st.session_state["qr_img"] = qr_img
                st.session_state["qr_payload"] = payload

        if "qr_img" in st.session_state:
            qr_img = st.session_state["qr_img"]

            # Preview
            col_preview, col_download = st.columns([1, 1])

            with col_preview:
                st.image(qr_img, caption="Generated QR Code", width=350)

            with col_download:
                st.markdown("#### ⬇️ Download")

                if export_fmt in ("PNG", "Both"):
                    st.download_button(
                        "⬇️ Download PNG",
                        data=image_to_bytes(qr_img, "PNG"),
                        file_name=f"qr_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png",
                        mime="image/png",
                        use_container_width=True,
                    )

                if export_fmt in ("SVG", "Both"):
                    svg_bytes = make_qr_svg(
                        st.session_state["qr_payload"],
                        ecc, box_size, border,
                    )
                    st.download_button(
                        "⬇️ Download SVG",
                        data=svg_bytes,
                        file_name=f"qr_{datetime.now().strftime('%Y%m%d_%H%M%S')}.svg",
                        mime="image/svg+xml",
                        use_container_width=True,
                    )

                # Show payload info
                st.markdown("#### ℹ️ Payload")
                st.code(st.session_state["qr_payload"], language="text")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# DECODE MODE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
else:
    st.markdown("### 🔍 Decode QR Code")
    st.markdown("Upload an image containing one or more QR codes.")

    decode_source = st.radio(
        "Source",
        ["📁 Upload Image", "📷 Camera"],
        horizontal=True,
    )

    img_bytes = None

    if decode_source == "📁 Upload Image":
        uploaded = st.file_uploader(
            "Upload image with QR code(s)",
            type=["png", "jpg", "jpeg", "webp", "bmp"],
            key="decode_upload",
        )
        if uploaded:
            img_bytes = uploaded.read()
            st.image(img_bytes, caption="Uploaded image", width=400)

    else:
        camera = st.camera_input("Take a photo of the QR code")
        if camera:
            img_bytes = camera.read()

    if img_bytes and st.button("🔍 Decode Now", type="primary", use_container_width=True):
        with st.spinner("Scanning for QR codes…"):
            results = decode_qr_from_image(img_bytes)

        if results:
            st.success(f"✅ Found **{len(results)}** QR code(s)")

            for i, data in enumerate(results):
                st.markdown(f"---")
                st.markdown(f"**QR Code {i + 1}**")

                # Show raw data
                st.markdown(
                    f'<div class="decoded-box">{data}</div>',
                    unsafe_allow_html=True,
                )

                # Try to parse structured data
                wifi_info = parse_wifi_payload(data)
                vcard_info = parse_vcard_payload(data)

                if wifi_info:
                    st.markdown("📶 **Detected: WiFi Network**")
                    for k, v in wifi_info.items():
                        st.markdown(f"- **{k}:** {v}")

                elif vcard_info:
                    st.markdown("👤 **Detected: Contact Card**")
                    for k, v in vcard_info.items():
                        st.markdown(f"- **{k}:** {v}")

                elif data.startswith("http://") or data.startswith("https://"):
                    st.markdown(f"🌐 **Detected: URL** — [{data}]({data})")

                elif data.startswith("mailto:"):
                    st.markdown(f"📧 **Detected: Email**")
                    st.markdown(f"[{data}]({data})")

                # Copy-friendly text box
                st.text_area(
                    "Copy decoded text",
                    data,
                    height=80,
                    key=f"decoded_{i}",
                    label_visibility="collapsed",
                )
        else:
            st.error(
                "❌ No QR code detected. Tips:\n"
                "- Make sure the QR code is clearly visible\n"
                "- Try a higher resolution image\n"
                "- Ensure good contrast between the QR code and background"
            )


# ─── Footer ───
st.markdown("---")
st.markdown(
    '<div style="text-align:center; color:#666; font-size:0.85rem;">'
    'QR Code Studio v1.0 · Built with Streamlit + qrcode + OpenCV · '
    '<a href="https://github.com/RehmozAyub/tools-for-everyone" style="color:#667eea;">GitHub</a>'
    "</div>",
    unsafe_allow_html=True,
)
