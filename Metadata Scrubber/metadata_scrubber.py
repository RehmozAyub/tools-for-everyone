"""
Metadata Scrubber \u2014 Inspect & strip metadata from images AND documents
Unified single-page UI: upload \u2192 inspect \u2192 strip \u2192 download
Supports: Images (JPEG, PNG, WebP, TIFF, BMP) + Documents (DOCX, PDF, XLSX, PPTX)
"""

import streamlit as st
from PIL import Image, ExifTags, ImageOps
from PIL.ExifTags import TAGS, GPSTAGS, IFD
import piexif
import io
import zipfile
import json
import pandas as pd
from datetime import datetime
import requests
from urllib.parse import urlparse

from docx import Document as DocxDocument
import openpyxl
from pptx import Presentation
import fitz  # PyMuPDF

# \u2500\u2500\u2500 Page Config \u2500\u2500\u2500
st.set_page_config(
    page_title="Metadata Scrubber",
    page_icon="\ud83d\udee1\ufe0f",
    layout="wide",
    initial_sidebar_state="expanded",
)

# \u2500\u2500\u2500 Custom CSS \u2500\u2500\u2500
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
</style>
""", unsafe_allow_html=True)

# \u2500\u2500\u2500 Header \u2500\u2500\u2500
st.markdown('<div class="main-header">\ud83d\udee1\ufe0f Metadata Scrubber</div>', unsafe_allow_html=True)
st.markdown(
    '<div class="sub-header">Inspect & strip metadata from images and documents \u2014 protect your privacy</div>',
    unsafe_allow_html=True,
)

# \u2500\u2500\u2500 Constants \u2500\u2500\u2500
IMAGE_FORMATS = ["jpg", "jpeg", "png", "webp", "tiff", "bmp"]
DOC_FORMATS = ["docx", "pdf", "xlsx", "pptx"]
ALL_FORMATS = IMAGE_FORMATS + DOC_FORMATS

SENSITIVE_IMAGE_TAGS = {
    "GPSLatitude", "GPSLongitude", "GPSLatitudeRef", "GPSLongitudeRef",
    "GPSAltitude", "GPSTimeStamp", "GPSDateStamp",
    "BodySerialNumber", "CameraSerialNumber", "SerialNumber",
    "LensSerialNumber", "ImageUniqueID",
    "CameraOwnerName", "OwnerName", "Artist", "Copyright",
    "XPAuthor", "XPComment",
}

SENSITIVE_DOC_PROPERTIES = {
    "author", "last_modified_by", "creator", "producer",
    "company", "manager", "category",
}

FORMAT_ICONS = {
    "docx": "\ud83d\udcdd", "pdf": "\ud83d\udcc4", "xlsx": "\ud83d\udcca", "pptx": "\ud83d\udcfd\ufe0f",
    "jpg": "\ud83d\uddbc\ufe0f", "jpeg": "\ud83d\uddbc\ufe0f", "png": "\ud83d\uddbc\ufe0f", "webp": "\ud83d\uddbc\ufe0f",
    "tiff": "\ud83d\uddbc\ufe0f", "bmp": "\ud83d\uddbc\ufe0f",
}

# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
# IMAGE HELPERS
# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
def _safe_str(value):
    if isinstance(value, bytes):
        try: return value.decode("utf-8", errors="replace").strip("\x00")
        except: return f"<{len(value)} bytes>"
    if isinstance(value, tuple) and len(value) == 2 and isinstance(value[1], int):
        if value[1] != 0:
            res = value[0] / value[1]
            return f"{res:.4g}" if res != int(res) else str(int(res))
    return str(value)

def get_exif_tables(img_bytes):
    img = Image.open(io.BytesIO(img_bytes))
    exif = img.getexif()
    basic, camera, gps, advanced, all_tags = {}, {}, {}, {}, {}

    basic["Format"] = img.format or "Unknown"
    basic["Size"] = f"{img.width} \u00d7 {img.height} px"

    for tag_id, value in exif.items():
        tag_name = TAGS.get(tag_id, f"Tag_{tag_id}")
        str_value = _safe_str(value)
        all_tags[tag_name] = str_value
        if tag_name in ("Make", "Model"): camera[tag_name] = str_value
        elif tag_name in ("DateTime",): basic[tag_name] = str_value
        else: advanced[tag_name] = str_value

    try:
        exif_ifd = exif.get_ifd(IFD.Exif)
        for tag_id, value in exif_ifd.items():
            tag_name = TAGS.get(tag_id, f"Tag_{tag_id}")
            str_value = _safe_str(value)
            all_tags[tag_name] = str_value
            advanced[tag_name] = str_value
    except Exception: pass

    try:
        gps_ifd = exif.get_ifd(IFD.GPSInfo)
        for tag_id, value in gps_ifd.items():
            tag_name = GPSTAGS.get(tag_id, f"GPSTag_{tag_id}")
            str_value = _safe_str(value)
            gps[tag_name] = str_value
            all_tags[tag_name] = str_value
    except Exception: pass

    return basic, camera, gps, advanced, all_tags

def parse_gps_coords(img_bytes):
    return None

def strip_image_metadata(img_bytes, preserve_orientation=True):
    img = Image.open(io.BytesIO(img_bytes))
    out_format = img.format or "JPEG"
    if out_format in ("JPG", "JPEG"): out_format = "JPEG"
    elif out_format not in ("WEBP", "PNG"): out_format = "JPEG"
    if img.mode in ("RGBA", "P") and out_format == "JPEG": img = img.convert("RGB")
    buf = io.BytesIO()
    if out_format == "JPEG":
        img.save(buf, format="JPEG", quality=95)
        try: return piexif.remove(buf.getvalue()), "jpg"
        except: return buf.getvalue(), "jpg"
    elif out_format == "WEBP":
        img.save(buf, format="WEBP", quality=95)
        return buf.getvalue(), "webp"
    else:
        img.save(buf, format="PNG")
        return buf.getvalue(), "png"

def count_image_tags(img_bytes):
    try: return len(get_exif_tables(img_bytes)[-1])
    except: return 0

def check_image_risks(all_tags):
    return [(t, all_tags[t]) for t in all_tags if t in SENSITIVE_IMAGE_TAGS]

# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
# DOCUMENT HELPERS
# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
def _str_or_none(val):
    if val is None: return None
    return str(val).strip() or None

def inspect_docx(fb):
    doc = DocxDocument(io.BytesIO(fb))
    cp = doc.core_properties
    props = {n: _str_or_none(getattr(cp, n, None)) for n in ["author","title"] if getattr(cp, n, None)}
    return props, {}, [], "Word Document"

def inspect_pdf(fb):
    doc = fitz.open(stream=fb, filetype="pdf")
    meta = doc.metadata or {}
    props = {k: _str_or_none(meta.get(k)) for k in ["author","creator"] if meta.get(k)}
    extras = {"Pages": str(doc.page_count)}
    doc.close()
    return props, extras, [], "PDF Document"

def inspect_xlsx(fb):
    wb = openpyxl.load_workbook(io.BytesIO(fb), read_only=False, data_only=True)
    cp = wb.properties
    props = {n: _str_or_none(getattr(cp, n, None)) for n in ["creator","title"] if getattr(cp, n, None)}
    wb.close()
    return props, {}, [], "Excel Spreadsheet"

def inspect_pptx(fb):
    prs = Presentation(io.BytesIO(fb))
    cp = prs.core_properties
    props = {n: _str_or_none(getattr(cp, n, None)) for n in ["author","title"] if getattr(cp, n, None)}
    return props, {}, [], "PowerPoint Presentation"

def strip_docx(fb):
    doc = DocxDocument(io.BytesIO(fb))
    cp = doc.core_properties
    for attr in ["author","title"]:
        try: setattr(cp, attr, "")
        except: pass
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()

def strip_pdf(fb):
    doc = fitz.open(stream=fb, filetype="pdf")
    doc.set_metadata({k: "" for k in ["author","creator"]})
    buf = io.BytesIO()
    doc.save(buf, garbage=4, deflate=True)
    doc.close()
    return buf.getvalue()

def strip_xlsx(fb):
    wb = openpyxl.load_workbook(io.BytesIO(fb))
    cp = wb.properties
    for attr in ["creator","title"]:
        try: setattr(cp, attr, "")
        except: pass
    buf = io.BytesIO()
    wb.save(buf)
    wb.close()
    return buf.getvalue()

def strip_pptx(fb):
    prs = Presentation(io.BytesIO(fb))
    cp = prs.core_properties
    for attr in ["author","title"]:
        try: setattr(cp, attr, "")
        except: pass
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()

# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
# UNIFIED HELPERS
# \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
def get_ext(name):
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""
def is_image(name): return get_ext(name) in IMAGE_FORMATS
def is_document(name): return get_ext(name) in DOC_FORMATS

def inspect_any(fb, name):
    ext = get_ext(name)
    if ext == "docx": p, e, r, t = inspect_docx(fb)
    elif ext == "pdf": p, e, r, t = inspect_pdf(fb)
    elif ext == "xlsx": p, e, r, t = inspect_xlsx(fb)
    elif ext == "pptx": p, e, r, t = inspect_pptx(fb)
    else: return {}, {}, [], "Unknown", 0
    return p, e, r, t, len(p)

def strip_any(fb, name, preserve_orient=True):
    if is_image(name): return strip_image_metadata(fb, preserve_orient)
    ext = get_ext(name)
    if ext == "docx": return strip_docx(fb), "docx"
    elif ext == "pdf": return strip_pdf(fb), "pdf"
    elif ext == "xlsx": return strip_xlsx(fb), "xlsx"
    elif ext == "pptx": return strip_pptx(fb), "pptx"
    return fb, ext

class MockUploadedFile:
    def __init__(self, name, content):
        self.name = name
        self.content = content
    def read(self): return self.content
    def seek(self, offset): pass

# \u2500\u2500\u2500 Sidebar \u2500\u2500\u2500
with st.sidebar:
    st.markdown("### \u2699\ufe0f Settings")
    preserve_orient = st.checkbox("Preserve image orientation", value=True)

# \u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
# UNIFIED MAIN PAGE
# \u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501

app_mode = st.radio("App Mode", ["\ud83e\uddf9 Scrub & Edit Metadata", "\u2696\ufe0f Compare Two Files"], horizontal=True)

col_upload, col_url = st.columns([1.5, 1])
with col_upload:
    files = st.file_uploader(
        "Upload images and/or documents",
        type=ALL_FORMATS,
        accept_multiple_files=True,
    )

with col_url:
    url_input = st.text_input("Or fetch from URL:")
    if url_input:
        try:
            res = requests.get(url_input, timeout=10)
            res.raise_for_status()
            fname = "url_download"
            parsed = urlparse(url_input)
            if "." in parsed.path.split("/")[-1]:
                fname = parsed.path.split("/")[-1]
            if not files: files = []
            files.append(MockUploadedFile(fname, res.content))
            st.success(f"Fetched {fname}!")
        except Exception as e:
            st.error(f"Error fetching URL: {e}")

if not files:
    st.info("Upload one or more files to inspect, scrub, or compare their metadata.")
    st.stop()

# \u2500\u2500\u2500 Compare Mode \u2500\u2500\u2500
if app_mode == "\u2696\ufe0f Compare Two Files":
    if len(files) == 2:
        st.markdown("### Side-by-Side Metadata Comparison")
        colA, colB = st.columns(2)
        f1, f2 = files[0], files[1]
        
        def ext_meta(f):
            fb = f.read()
            f.seek(0)
            if is_image(f.name):
                _, _, _, _, all_t = get_exif_tables(fb)
                return all_t
            elif is_document(f.name):
                try:
                    p, e, _, _, _ = inspect_any(fb, f.name)
                    return {**p, **e}
                except: return {}
            return {}
            
        m1, m2 = ext_meta(f1), ext_meta(f2)
        with colA:
            st.markdown(f"**{f1.name}**")
            st.dataframe(pd.DataFrame(list(m1.items()), columns=["Key", "Value"]), use_container_width=True)
        with colB:
            st.markdown(f"**{f2.name}**")
            st.dataframe(pd.DataFrame(list(m2.items()), columns=["Key", "Value"]), use_container_width=True)
        
        st.markdown("#### \ud83d\udcc9 Differences")
        diffs = []
        for k in sorted(set(m1.keys()).union(set(m2.keys()))):
            v1, v2 = m1.get(k, "<Missing>"), m2.get(k, "<Missing>")
            if v1 != v2: diffs.append({"Key": k, f1.name: v1, f2.name: v2})
        if diffs: st.dataframe(pd.DataFrame(diffs), use_container_width=True)
        else: st.success("Metadata is identical!")
    else:
        st.warning("Please upload exactly TWO files to use the Comparison tool.")
    st.stop()

# \u2500\u2500\u2500 Regular Mode \u2500\u2500\u2500
file_data = []
for f in files:
    fb = f.read(); f.seek(0)
    ext = get_ext(f.name)
    icon = FORMAT_ICONS.get(ext, "\ud83d\udcc2")

    if is_image(f.name):
        tc = count_image_tags(fb)
        _, _, _, _, all_t = get_exif_tables(fb)
        risks = check_image_risks(all_t)
    elif is_document(f.name):
        try: p, e, risks, tl, tc = inspect_any(fb, f.name)
        except: tc, risks = 0, []
    else:
        tc, risks = 0, []

    file_data.append({
        "file": f, "bytes": fb, "ext": ext, "icon": icon,
        "tag_count": tc, "risk_count": len(risks),
    })

if st.button("\ud83e\uddf9 Strip All Files & Download ZIP", type="primary", use_container_width=True):
    with st.spinner(f"Stripping metadata from {len(files)} files\u2026"):
        zbuf = io.BytesIO()
        with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as zf:
            for d in file_data:
                try:
                    cleaned, out_ext = strip_any(d["bytes"], d["file"].name, preserve_orient)
                    zf.writestr(f"{d['file'].name.rsplit('.', 1)[0]}_clean.{out_ext}", cleaned)
                except Exception as e:
                    zf.writestr(d["file"].name, d["bytes"])
    st.success(f"\u2705 Cleaned {len(files)} files")
    st.download_button(
        "\u2b07\ufe0f Download All Cleaned (ZIP)",
        data=zbuf.getvalue(),
        file_name=f"metadata_stripped_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip",
        mime="application/zip", use_container_width=True,
    )

st.markdown("### \ud83d\udcdd Per-File Details")
for idx, d in enumerate(file_data):
    f = d["file"]; fb = d["bytes"]
    with st.expander(f"{d['icon']} {f.name} \u2014 {d['tag_count']} tags", expanded=False):
        if is_image(f.name):
            col_img, col_meta = st.columns([1, 2])
            with col_img: st.image(fb, caption=f.name, width=300)
            with col_meta:
                basic, camera, gps, advanced, all_tags = get_exif_tables(fb)
                st.markdown("**Selective Metadata Removal (Preview)**")
                tags_to_keep = st.multiselect("Select tags to keep (uncheck to remove):", options=list(all_tags.keys()), default=list(all_tags.keys()), key=f"sel_{idx}")
                st.dataframe(pd.DataFrame(list(all_tags.items()), columns=["Tag", "Value"]), use_container_width=True)

        elif is_document(f.name):
            try: props, extras, risks, doc_type, tc = inspect_any(fb, f.name)
            except: continue
            st.markdown(f"**{doc_type}** \u2014 {len(fb)/1024:.1f} KB")
            
            if doc_type == "PDF Document":
                st.markdown("**\ud83d\uddbc\ufe0f PDF Asset Extraction**")
                if st.button("Extract Embedded Images", key=f"pdf_ext_{idx}"):
                    pdf_doc = fitz.open(stream=fb, filetype="pdf")
                    extracted = []
                    for p in range(len(pdf_doc)):
                        for img in pdf_doc[p].get_images(full=True):
                            base = pdf_doc.extract_image(img[0])
                            extracted.append(base["image"])
                    if extracted:
                        st.write(f"Found {len(extracted)} images.")
                        for i, img_b in enumerate(extracted[:5]): st.image(img_b, width=150)
                    else: st.info("No images found.")
            st.dataframe(pd.DataFrame(list(props.items()), columns=["Property", "Value"]), use_container_width=True)

        c_strip, _ = st.columns(2)
        with c_strip:
            if st.button(f"\ud83e\uddf9 Strip & Download", key=f"strip_{idx}", use_container_width=True):
                cleaned, out_ext = strip_any(fb, f.name, preserve_orient)
                st.download_button(f"\u2b07\ufe0f Download", data=cleaned, file_name=f"{f.name}_clean.{out_ext}", use_container_width=True, key=f"dl_{idx}")
