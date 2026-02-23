"""
PDF Suite — Your all-in-one PDF toolkit
Features: Merge, Split, Compress, Extract Text, PDF↔Images, Rotate, Watermark, Page Numbers, Protect
Built with Streamlit + PyMuPDF
"""

import streamlit as st
import fitz  # PyMuPDF
from PIL import Image
import io
import zipfile
from datetime import datetime

# ─── Page Config ───
st.set_page_config(
    page_title="PDF Suite",
    page_icon="📄",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── Custom CSS ───
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
</style>
""", unsafe_allow_html=True)

# ─── Header ───
st.markdown('<div class="main-header">📄 PDF Suite</div>', unsafe_allow_html=True)
st.markdown('<div class="sub-header">Your all-in-one PDF toolkit — merge, split, compress, extract & more</div>', unsafe_allow_html=True)

# ─── Sidebar Navigation ───
TOOLS = {
    "🔗 Merge PDFs": "merge",
    "✂️ Split PDF": "split",
    "🗜️ Compress PDF": "compress",
    "📝 Extract Text": "extract_text",
    "🖼️ PDF → Images": "pdf_to_images",
    "📄 Images → PDF": "images_to_pdf",
    "🔄 Rotate Pages": "rotate",
    "💧 Add Watermark": "watermark",
    "🔢 Page Numbers": "page_numbers",
    "🔒 Protect PDF": "protect",
}

with st.sidebar:
    st.markdown("### 🧰 Select Tool")
    selected = st.radio("", list(TOOLS.keys()), label_visibility="collapsed")
    tool = TOOLS[selected]
    st.markdown("---")
    st.markdown("##### ℹ️ About")
    st.markdown(
        "Free, open-source PDF toolkit.\n\n"
        "No file uploads to external servers — "
        "**everything runs locally on your machine.**"
    )
    st.markdown("---")
    st.markdown(
        "Made with ❤️ by "
        "[RehmozAyub](https://github.com/RehmozAyub)"
    )


# ─── Helpers ───
def get_pdf_info(pdf_bytes):
    """Return basic PDF metadata."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    info = {
        "pages": len(doc),
        "metadata": doc.metadata,
        "size_kb": len(pdf_bytes) / 1024,
    }
    doc.close()
    return info


def show_pdf_info(filename, info):
    """Display a compact info bar."""
    st.info(f"📊 **{filename}** — {info['pages']} pages, {info['size_kb']:.1f} KB")


def make_transparent_image(img_bytes, opacity):
    """Apply opacity to an image and return PNG bytes with alpha channel."""
    img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
    alpha = img.split()[3]
    alpha = alpha.point(lambda p: int(p * opacity))
    img.putalpha(alpha)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# MERGE PDFs
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if tool == "merge":
    st.markdown("### 🔗 Merge PDFs")
    st.markdown("Combine multiple PDF files into a single document.")

    files = st.file_uploader(
        "Upload PDFs to merge (order matters)",
        type=["pdf"],
        accept_multiple_files=True,
        key="merge_upload",
    )

    if files and len(files) >= 2:
        st.markdown("**File order:**")
        for i, f in enumerate(files):
            st.text(f"  {i + 1}. {f.name}  ({f.size / 1024:.1f} KB)")

        if st.button("🔗 Merge Now", type="primary", use_container_width=True):
            with st.spinner("Merging…"):
                merged = fitz.open()
                for f in files:
                    pdf = fitz.open(stream=f.read(), filetype="pdf")
                    merged.insert_pdf(pdf)
                    pdf.close()
                output = merged.tobytes()
                merged.close()

            st.success(f"✅ Merged {len(files)} files → {len(output) / 1024:.1f} KB")
            st.download_button(
                "⬇️ Download Merged PDF",
                data=output,
                file_name=f"merged_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf",
                mime="application/pdf",
                use_container_width=True,
            )
    elif files:
        st.warning("Upload at least **2** PDF files to merge.")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SPLIT PDF
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif tool == "split":
    st.markdown("### ✂️ Split PDF")
    st.markdown("Extract specific pages or split into individual files.")

    file = st.file_uploader("Upload PDF", type=["pdf"], key="split_upload")

    if file:
        pdf_bytes = file.read()
        info = get_pdf_info(pdf_bytes)
        show_pdf_info(file.name, info)

        split_mode = st.radio(
            "Split mode",
            ["Extract page range", "Extract specific pages", "Split into individual pages"],
            horizontal=True,
        )

        pages = None
        if split_mode == "Extract page range":
            c1, c2 = st.columns(2)
            start = int(c1.number_input("Start page", 1, info["pages"], 1))
            end = int(c2.number_input("End page", 1, info["pages"], info["pages"]))
            pages = list(range(start - 1, end))

        elif split_mode == "Extract specific pages":
            page_input = st.text_input("Page numbers (comma-separated)", "1, 3, 5")
            try:
                pages = [int(p.strip()) - 1 for p in page_input.split(",") if p.strip()]
            except ValueError:
                st.error("Enter valid page numbers.")
                pages = []

        if st.button("✂️ Split Now", type="primary", use_container_width=True):
            with st.spinner("Splitting…"):
                doc = fitz.open(stream=pdf_bytes, filetype="pdf")

                if pages is not None:
                    new_doc = fitz.open()
                    for p in pages:
                        if 0 <= p < len(doc):
                            new_doc.insert_pdf(doc, from_page=p, to_page=p)
                    output = new_doc.tobytes()
                    new_doc.close()
                    doc.close()

                    st.success(f"✅ Extracted {len(pages)} page(s)")
                    st.download_button(
                        "⬇️ Download Split PDF",
                        data=output,
                        file_name=f"split_{file.name}",
                        mime="application/pdf",
                        use_container_width=True,
                    )
                else:
                    buf = io.BytesIO()
                    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                        for i in range(len(doc)):
                            p_doc = fitz.open()
                            p_doc.insert_pdf(doc, from_page=i, to_page=i)
                            zf.writestr(f"page_{i + 1}.pdf", p_doc.tobytes())
                            p_doc.close()
                    doc.close()

                    st.success(f"✅ Split into {info['pages']} individual pages")
                    st.download_button(
                        "⬇️ Download ZIP",
                        data=buf.getvalue(),
                        file_name=f"split_pages_{file.name}.zip",
                        mime="application/zip",
                        use_container_width=True,
                    )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# COMPRESS PDF
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif tool == "compress":
    st.markdown("### 🗜️ Compress PDF")
    st.markdown("Reduce file size while keeping quality.")

    file = st.file_uploader("Upload PDF", type=["pdf"], key="compress_upload")

    if file:
        pdf_bytes = file.read()
        original_size = len(pdf_bytes)
        st.info(f"📊 Original size: **{original_size / 1024:.1f} KB**")

        quality = st.select_slider(
            "Compression level",
            options=["Light", "Medium", "Heavy"],
            value="Medium",
        )
        img_quality = {"Light": 90, "Medium": 75, "Heavy": 50}

        if st.button("🗜️ Compress Now", type="primary", use_container_width=True):
            with st.spinner("Compressing…"):
                doc = fitz.open(stream=pdf_bytes, filetype="pdf")

                for page in doc:
                    for img in page.get_images(full=True):
                        xref = img[0]
                        try:
                            base = doc.extract_image(xref)
                            if not base:
                                continue
                            pil = Image.open(io.BytesIO(base["image"]))

                            if quality == "Heavy":
                                w, h = pil.size
                                pil = pil.resize((w // 2, h // 2), Image.LANCZOS)

                            if pil.mode in ("RGBA", "P"):
                                pil = pil.convert("RGB")

                            out_buf = io.BytesIO()
                            pil.save(out_buf, format="JPEG",
                                     quality=img_quality[quality], optimize=True)

                            if len(out_buf.getvalue()) < len(base["image"]):
                                page.replace_image(xref, stream=out_buf.getvalue())
                        except Exception:
                            continue

                output = doc.tobytes(garbage=4, deflate=True, clean=True)
                doc.close()

            new_size = len(output)
            reduction = (1 - new_size / original_size) * 100

            c1, c2, c3 = st.columns(3)
            c1.metric("Original", f"{original_size / 1024:.1f} KB")
            c2.metric("Compressed", f"{new_size / 1024:.1f} KB")
            c3.metric("Reduction", f"{reduction:.1f}%")

            if reduction > 0:
                st.success(f"✅ Reduced by {reduction:.1f}%")
            else:
                st.info("ℹ️ File is already well-optimized — minimal reduction possible.")

            st.download_button(
                "⬇️ Download Compressed PDF",
                data=output,
                file_name=f"compressed_{file.name}",
                mime="application/pdf",
                use_container_width=True,
            )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# EXTRACT TEXT
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif tool == "extract_text":
    st.markdown("### 📝 Extract Text")
    st.markdown("Pull all text content from a PDF.")

    file = st.file_uploader("Upload PDF", type=["pdf"], key="extract_upload")

    if file:
        pdf_bytes = file.read()
        fmt = st.radio("Output format", ["Plain Text", "Markdown (page sections)", "Page-by-page"], horizontal=True)

        if st.button("📝 Extract Now", type="primary", use_container_width=True):
            with st.spinner("Extracting…"):
                doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                text = ""
                for i, page in enumerate(doc):
                    body = page.get_text()
                    if fmt == "Plain Text":
                        text += body
                    elif fmt == "Markdown (page sections)":
                        text += f"## Page {i + 1}\n\n{body}\n\n---\n\n"
                    else:
                        text += f"{'=' * 50}\n PAGE {i + 1} \n{'=' * 50}\n\n{body}\n\n"
                doc.close()

            st.text_area("Extracted Text", text, height=400)

            c1, c2 = st.columns(2)
            stem = file.name.replace(".pdf", "")
            c1.download_button(
                "⬇️ Download .txt", data=text,
                file_name=f"{stem}_text.txt", mime="text/plain",
                use_container_width=True,
            )
            c2.download_button(
                "⬇️ Download .md", data=text,
                file_name=f"{stem}_text.md", mime="text/markdown",
                use_container_width=True,
            )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PDF → IMAGES
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif tool == "pdf_to_images":
    st.markdown("### 🖼️ PDF → Images")
    st.markdown("Convert PDF pages to high-quality images.")

    file = st.file_uploader("Upload PDF", type=["pdf"], key="p2i_upload")

    if file:
        pdf_bytes = file.read()
        info = get_pdf_info(pdf_bytes)
        show_pdf_info(file.name, info)

        c1, c2 = st.columns(2)
        img_fmt = c1.selectbox("Image format", ["PNG", "JPEG", "WebP"])
        dpi = c2.slider("DPI (quality)", 72, 300, 150)

        if st.button("🖼️ Convert Now", type="primary", use_container_width=True):
            with st.spinner("Converting…"):
                doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                zbuf = io.BytesIO()

                with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as zf:
                    for i, page in enumerate(doc):
                        mat = fitz.Matrix(dpi / 72, dpi / 72)
                        pix = page.get_pixmap(matrix=mat)
                        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

                        buf = io.BytesIO()
                        ext = img_fmt.lower()
                        save_fmt = "JPEG" if ext == "jpeg" else img_fmt
                        img.save(buf, format=save_fmt, quality=90 if ext == "jpeg" else None)
                        zf.writestr(f"page_{i + 1}.{ext}", buf.getvalue())

                        if i < 3:
                            st.image(img, caption=f"Page {i + 1}", width=400)

                doc.close()

            st.success(f"✅ Converted {info['pages']} pages to {img_fmt}")
            st.download_button(
                "⬇️ Download All Images (ZIP)",
                data=zbuf.getvalue(),
                file_name=f"{file.name.replace('.pdf', '')}_images.zip",
                mime="application/zip",
                use_container_width=True,
            )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# IMAGES → PDF
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif tool == "images_to_pdf":
    st.markdown("### 📄 Images → PDF")
    st.markdown("Combine images into a single PDF.")

    files = st.file_uploader(
        "Upload images",
        type=["png", "jpg", "jpeg", "webp", "bmp", "tiff"],
        accept_multiple_files=True,
        key="i2p_upload",
    )

    if files:
        cols = st.columns(min(len(files), 4))
        for i, f in enumerate(files):
            with cols[i % 4]:
                st.image(f, caption=f.name, width=150)

        page_size = st.selectbox("Page size", ["A4", "Letter", "Fit to image"])

        if st.button("📄 Create PDF", type="primary", use_container_width=True):
            with st.spinner("Creating PDF…"):
                doc = fitz.open()
                sizes = {"A4": fitz.paper_rect("a4"), "Letter": fitz.paper_rect("letter")}

                for f in files:
                    img = Image.open(io.BytesIO(f.read()))
                    rect = fitz.Rect(0, 0, img.width, img.height) if page_size == "Fit to image" else sizes[page_size]

                    page = doc.new_page(width=rect.width, height=rect.height)

                    scale = min(rect.width / img.width, rect.height / img.height)
                    nw, nh = img.width * scale, img.height * scale
                    xo = (rect.width - nw) / 2
                    yo = (rect.height - nh) / 2
                    target = fitz.Rect(xo, yo, xo + nw, yo + nh)

                    if img.mode in ("RGBA", "P"):
                        img = img.convert("RGB")
                    buf = io.BytesIO()
                    img.save(buf, format="JPEG", quality=95)
                    page.insert_image(target, stream=buf.getvalue())

                output = doc.tobytes()
                doc.close()

            st.success(f"✅ Created PDF with {len(files)} pages")
            st.download_button(
                "⬇️ Download PDF",
                data=output,
                file_name=f"images_to_pdf_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf",
                mime="application/pdf",
                use_container_width=True,
            )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ROTATE PAGES
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif tool == "rotate":
    st.markdown("### 🔄 Rotate Pages")
    st.markdown("Rotate all or specific pages in a PDF.")

    file = st.file_uploader("Upload PDF", type=["pdf"], key="rotate_upload")

    if file:
        pdf_bytes = file.read()
        info = get_pdf_info(pdf_bytes)
        show_pdf_info(file.name, info)

        rotation = st.select_slider("Rotation angle", options=[90, 180, 270], value=90)
        scope = st.radio("Apply to", ["All pages", "Specific pages"], horizontal=True)

        target = list(range(info["pages"]))
        if scope == "Specific pages":
            inp = st.text_input("Page numbers (comma-separated)", "1")
            try:
                target = [int(p.strip()) - 1 for p in inp.split(",") if p.strip()]
            except ValueError:
                st.error("Enter valid page numbers.")
                target = []

        if st.button("🔄 Rotate Now", type="primary", use_container_width=True):
            with st.spinner("Rotating…"):
                doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                for p in target:
                    if 0 <= p < len(doc):
                        doc[p].set_rotation(doc[p].rotation + rotation)
                output = doc.tobytes()
                doc.close()

            st.success(f"✅ Rotated {len(target)} page(s) by {rotation}°")
            st.download_button(
                "⬇️ Download Rotated PDF",
                data=output,
                file_name=f"rotated_{file.name}",
                mime="application/pdf",
                use_container_width=True,
            )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# WATERMARK
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif tool == "watermark":
    st.markdown("### 💧 Add Watermark")
    st.markdown("Overlay a text or image watermark on every page.")

    file = st.file_uploader("Upload PDF", type=["pdf"], key="wm_upload")

    if file:
        pdf_bytes = file.read()

        wm_type = st.radio("Watermark type", ["✍️ Text", "🖼️ Image"], horizontal=True)

        # ---- TEXT WATERMARK ----
        if wm_type == "✍️ Text":
            c1, c2 = st.columns(2)
            wm_text = c1.text_input("Watermark text", "CONFIDENTIAL")
            opacity = c2.slider("Opacity", 0.05, 0.5, 0.15)

            c3, c4 = st.columns(2)
            font_size = c3.slider("Font size", 20, 120, 60)
            color_hex = c4.color_picker("Color", "#FF0000")

            if st.button("💧 Add Text Watermark", type="primary", use_container_width=True):
                with st.spinner("Applying text watermark…"):
                    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

                    r = int(color_hex[1:3], 16) / 255
                    g = int(color_hex[3:5], 16) / 255
                    b = int(color_hex[5:7], 16) / 255

                    for page in doc:
                        rect = page.rect
                        # Use morph for arbitrary-angle rotation (rotate= only allows 0/90/180/270)
                        center = fitz.Point(rect.width / 2, rect.height / 2)
                        page.insert_text(
                            fitz.Point(rect.width / 4, rect.height / 2),
                            wm_text,
                            fontsize=font_size,
                            color=(r, g, b),
                            overlay=True,
                            fill_opacity=opacity,
                            morph=(center, fitz.Matrix(45)),
                        )

                    output = doc.tobytes()
                    doc.close()

                st.success("✅ Text watermark added to all pages")
                st.download_button(
                    "⬇️ Download Watermarked PDF",
                    data=output,
                    file_name=f"watermarked_{file.name}",
                    mime="application/pdf",
                    use_container_width=True,
                )

        # ---- IMAGE WATERMARK ----
        else:
            wm_image = st.file_uploader(
                "Upload watermark image (PNG recommended for transparency)",
                type=["png", "jpg", "jpeg", "webp"],
                key="wm_img_upload",
            )

            if wm_image:
                st.image(wm_image, caption="Watermark preview", width=200)

                c1, c2 = st.columns(2)
                opacity = c1.slider("Opacity", 0.05, 1.0, 0.25)
                scale_pct = c2.slider("Scale (%)", 10, 100, 40)

                position = st.selectbox(
                    "Position",
                    ["Center", "Top Left", "Top Right",
                     "Bottom Left", "Bottom Right", "Tile (repeat)"],
                )

                if st.button("💧 Add Image Watermark", type="primary", use_container_width=True):
                    with st.spinner("Applying image watermark…"):
                        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                        raw_bytes = wm_image.read()

                        # Pre-process image: apply opacity via alpha channel
                        wm_transparent = make_transparent_image(raw_bytes, opacity)

                        for page in doc:
                            rect = page.rect

                            # Determine watermark dimensions
                            tmp_img = Image.open(io.BytesIO(raw_bytes))
                            wm_w, wm_h = tmp_img.size
                            scale = scale_pct / 100
                            nw = rect.width * scale
                            nh = nw * (wm_h / wm_w)

                            if position == "Tile (repeat)":
                                y = 0.0
                                while y < rect.height:
                                    x = 0.0
                                    while x < rect.width:
                                        target = fitz.Rect(x, y, x + nw, y + nh)
                                        page.insert_image(target, stream=wm_transparent, overlay=True)
                                        x += nw + 20
                                    y += nh + 20
                            else:
                                pos_rects = {
                                    "Center": fitz.Rect(
                                        (rect.width - nw) / 2, (rect.height - nh) / 2,
                                        (rect.width + nw) / 2, (rect.height + nh) / 2,
                                    ),
                                    "Top Left": fitz.Rect(20, 20, 20 + nw, 20 + nh),
                                    "Top Right": fitz.Rect(
                                        rect.width - nw - 20, 20,
                                        rect.width - 20, 20 + nh,
                                    ),
                                    "Bottom Left": fitz.Rect(
                                        20, rect.height - nh - 20,
                                        20 + nw, rect.height - 20,
                                    ),
                                    "Bottom Right": fitz.Rect(
                                        rect.width - nw - 20, rect.height - nh - 20,
                                        rect.width - 20, rect.height - 20,
                                    ),
                                }
                                target = pos_rects[position]
                                page.insert_image(target, stream=wm_transparent, overlay=True)

                        output = doc.tobytes()
                        doc.close()

                    st.success("✅ Image watermark added to all pages")
                    st.download_button(
                        "⬇️ Download Watermarked PDF",
                        data=output,
                        file_name=f"watermarked_{file.name}",
                        mime="application/pdf",
                        use_container_width=True,
                    )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PAGE NUMBERS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif tool == "page_numbers":
    st.markdown("### 🔢 Add Page Numbers")
    st.markdown("Stamp page numbers onto every page.")

    file = st.file_uploader("Upload PDF", type=["pdf"], key="pgn_upload")

    if file:
        pdf_bytes = file.read()
        info = get_pdf_info(pdf_bytes)

        c1, c2 = st.columns(2)
        position = c1.selectbox(
            "Position",
            ["Bottom Center", "Bottom Right", "Bottom Left",
             "Top Center", "Top Right", "Top Left"],
        )
        fmt = c2.selectbox(
            "Format",
            ["1, 2, 3…", "Page 1, Page 2…", "1/N, 2/N…", "— 1 —, — 2 —…"],
        )

        c3, c4 = st.columns(2)
        font_size = c3.slider("Font size", 8, 20, 11)
        start_num = int(c4.number_input("Start from", 1, 1000, 1))

        if st.button("🔢 Add Page Numbers", type="primary", use_container_width=True):
            with st.spinner("Numbering…"):
                doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                total = len(doc)
                margin = 36

                for i, page in enumerate(doc):
                    num = i + start_num
                    rect = page.rect

                    if fmt.startswith("1, 2"):
                        label = str(num)
                    elif fmt.startswith("Page"):
                        label = f"Page {num}"
                    elif fmt.startswith("1/N"):
                        label = f"{num}/{total}"
                    else:
                        label = f"— {num} —"

                    positions = {
                        "Bottom Center": fitz.Point(rect.width / 2 - 10, rect.height - margin),
                        "Bottom Right":  fitz.Point(rect.width - margin - 20, rect.height - margin),
                        "Bottom Left":   fitz.Point(margin, rect.height - margin),
                        "Top Center":    fitz.Point(rect.width / 2 - 10, margin),
                        "Top Right":     fitz.Point(rect.width - margin - 20, margin),
                        "Top Left":      fitz.Point(margin, margin),
                    }

                    page.insert_text(
                        positions[position], label,
                        fontsize=font_size, color=(0.3, 0.3, 0.3),
                    )

                output = doc.tobytes()
                doc.close()

            st.success(f"✅ Numbered {total} pages")
            st.download_button(
                "⬇️ Download PDF",
                data=output,
                file_name=f"numbered_{file.name}",
                mime="application/pdf",
                use_container_width=True,
            )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PROTECT PDF
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif tool == "protect":
    st.markdown("### 🔒 Protect PDF")
    st.markdown("Add password protection with AES-256 encryption.")

    file = st.file_uploader("Upload PDF", type=["pdf"], key="protect_upload")

    if file:
        pdf_bytes = file.read()

        c1, c2 = st.columns(2)
        user_pw = c1.text_input("User password (to open)", type="password")
        owner_pw = c2.text_input(
            "Owner password (full access)", type="password",
            help="Leave empty to reuse user password",
        )

        st.markdown("**Permissions:**")
        c1, c2, c3 = st.columns(3)
        allow_print = c1.checkbox("Allow printing", True)
        allow_copy = c2.checkbox("Allow copying", False)
        allow_edit = c3.checkbox("Allow editing", False)

        if user_pw and st.button("🔒 Protect Now", type="primary", use_container_width=True):
            with st.spinner("Encrypting…"):
                doc = fitz.open(stream=pdf_bytes, filetype="pdf")

                perm = 0
                if allow_print:
                    perm |= fitz.PDF_PERM_PRINT
                if allow_copy:
                    perm |= fitz.PDF_PERM_COPY
                if allow_edit:
                    perm |= fitz.PDF_PERM_MODIFY

                output = doc.tobytes(
                    encryption=fitz.PDF_ENCRYPT_AES_256,
                    user_pw=user_pw,
                    owner_pw=owner_pw or user_pw,
                    permissions=perm,
                )
                doc.close()

            st.success("✅ PDF encrypted with AES-256")
            st.download_button(
                "⬇️ Download Protected PDF",
                data=output,
                file_name=f"protected_{file.name}",
                mime="application/pdf",
                use_container_width=True,
            )
        elif not user_pw:
            st.warning("Enter a user password to continue.")


# ─── Footer ───
st.markdown("---")
st.markdown(
    '<div style="text-align:center; color:#666; font-size:0.85rem;">'
    'PDF Suite v1.1 · Built with Streamlit + PyMuPDF · '
    '<a href="https://github.com/RehmozAyub/tools-for-everyone" style="color:#667eea;">GitHub</a>'
    "</div>",
    unsafe_allow_html=True,
)
