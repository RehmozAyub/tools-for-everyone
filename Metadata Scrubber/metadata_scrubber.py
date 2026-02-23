"""
Metadata Scrubber — Inspect & strip metadata from images AND documents
Unified single-page UI: upload → inspect → strip → download
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

from docx import Document as DocxDocument
import openpyxl
from pptx import Presentation
import fitz  # PyMuPDF

# ─── Page Config ───
st.set_page_config(
    page_title="Metadata Scrubber",
    page_icon="🛡️",
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
    .privacy-warn {
        padding: 0.6rem 1rem;
        border-radius: 8px;
        background: #2a1a1a;
        border-left: 4px solid #e74c3c;
        margin-bottom: 0.5rem;
        color: #e8a0a0;
    }
    .privacy-ok {
        padding: 0.6rem 1rem;
        border-radius: 8px;
        background: #1a2a1a;
        border-left: 4px solid #2ecc71;
        margin-bottom: 0.5rem;
        color: #a0e8a0;
    }
</style>
""", unsafe_allow_html=True)

# ─── Header ───
st.markdown('<div class="main-header">🛡️ Metadata Scrubber</div>', unsafe_allow_html=True)
st.markdown(
    '<div class="sub-header">Inspect & strip metadata from images and documents — protect your privacy</div>',
    unsafe_allow_html=True,
)

# ─── Constants ───
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
    "docx": "📝", "pdf": "📄", "xlsx": "📊", "pptx": "📽️",
    "jpg": "🖼️", "jpeg": "🖼️", "png": "🖼️", "webp": "🖼️",
    "tiff": "🖼️", "bmp": "🖼️",
}


# ══════════════════════════════════════
# IMAGE HELPERS
# ══════════════════════════════════════
def _safe_str(value):
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8", errors="replace").strip("\x00")
        except Exception:
            return f"<{len(value)} bytes>"
    if isinstance(value, tuple) and len(value) == 2 and isinstance(value[1], int):
        if value[1] != 0:
            result = value[0] / value[1]
            return f"{result:.4g}" if result != int(result) else str(int(result))
    return str(value)


def _orientation_str(val):
    return {
        1: "Normal", 2: "Mirrored horizontal", 3: "Rotated 180°",
        4: "Mirrored vertical", 5: "Mirrored horizontal + Rotated 270°",
        6: "Rotated 90° CW", 7: "Mirrored horizontal + Rotated 90°",
        8: "Rotated 270° CW",
    }.get(val, str(val))


def get_exif_tables(img_bytes):
    """Extract all EXIF metadata from image bytes."""
    img = Image.open(io.BytesIO(img_bytes))
    exif = img.getexif()
    basic, camera, gps, advanced, all_tags = {}, {}, {}, {}, {}

    basic["Format"] = img.format or "Unknown"
    basic["Mode"] = img.mode
    basic["Size"] = f"{img.width} × {img.height} px"
    basic["File Size"] = f"{len(img_bytes) / 1024:.1f} KB"

    for tag_id, value in exif.items():
        tag_name = TAGS.get(tag_id, f"Tag_{tag_id}")
        str_value = _safe_str(value)
        all_tags[tag_name] = str_value
        if tag_name in ("Make", "Model", "Software", "LensMake", "LensModel"):
            camera[tag_name] = str_value
        elif tag_name in ("DateTime", "DateTimeOriginal", "DateTimeDigitized"):
            basic[tag_name] = str_value
        elif tag_name == "Orientation":
            basic[tag_name] = _orientation_str(value)
        elif tag_name not in ("ImageWidth", "ImageLength"):
            advanced[tag_name] = str_value

    try:
        exif_ifd = exif.get_ifd(IFD.Exif)
        for tag_id, value in exif_ifd.items():
            tag_name = TAGS.get(tag_id, f"Tag_{tag_id}")
            str_value = _safe_str(value)
            all_tags[tag_name] = str_value
            if tag_name in (
                "ExposureTime", "FNumber", "ISOSpeedRatings", "FocalLength",
                "FocalLengthIn35mmFilm", "ExposureProgram", "MeteringMode",
                "Flash", "WhiteBalance", "ExposureBiasValue",
                "MaxApertureValue", "DigitalZoomRatio",
                "ShutterSpeedValue", "ApertureValue", "BrightnessValue", "LightSource",
            ):
                camera[tag_name] = str_value
            elif tag_name in ("DateTimeOriginal", "DateTimeDigitized", "OffsetTime", "OffsetTimeOriginal"):
                basic[tag_name] = str_value
            else:
                advanced[tag_name] = str_value
    except Exception:
        pass

    try:
        gps_ifd = exif.get_ifd(IFD.GPSInfo)
        for tag_id, value in gps_ifd.items():
            tag_name = GPSTAGS.get(tag_id, f"GPSTag_{tag_id}")
            str_value = _safe_str(value)
            gps[tag_name] = str_value
            all_tags[tag_name] = str_value
    except Exception:
        pass

    return basic, camera, gps, advanced, all_tags


def parse_gps_coords(img_bytes):
    try:
        img = Image.open(io.BytesIO(img_bytes))
        exif = img.getexif()
        gps_ifd = exif.get_ifd(IFD.GPSInfo)
        if not gps_ifd:
            return None
        lat, lat_ref = gps_ifd.get(2), gps_ifd.get(1)
        lon, lon_ref = gps_ifd.get(4), gps_ifd.get(3)
        if not all([lat, lat_ref, lon, lon_ref]):
            return None
        lat_deg = float(lat[0]) + float(lat[1]) / 60.0 + float(lat[2]) / 3600.0
        lon_deg = float(lon[0]) + float(lon[1]) / 60.0 + float(lon[2]) / 3600.0
        if lat_ref == "S": lat_deg = -lat_deg
        if lon_ref == "W": lon_deg = -lon_deg
        return lat_deg, lon_deg
    except Exception:
        return None


def strip_image_metadata(img_bytes, preserve_orientation=True):
    img = Image.open(io.BytesIO(img_bytes))
    original_format = img.format or "JPEG"
    if preserve_orientation:
        img = ImageOps.exif_transpose(img) or img
    output_format = original_format.upper()
    if output_format in ("JPG", "JPEG"):
        output_format = "JPEG"
        if img.mode in ("RGBA", "P"): img = img.convert("RGB")
    elif output_format not in ("WEBP", "PNG"):
        output_format = "JPEG"
        if img.mode in ("RGBA", "P"): img = img.convert("RGB")
    buf = io.BytesIO()
    ext_map = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
    if output_format == "JPEG":
        img.save(buf, format="JPEG", quality=95, optimize=True)
        try: return piexif.remove(buf.getvalue()), "jpg"
        except: return buf.getvalue(), "jpg"
    elif output_format == "WEBP":
        img.save(buf, format="WEBP", quality=95)
        try: return piexif.remove(buf.getvalue()), "webp"
        except: return buf.getvalue(), "webp"
    else:
        img.save(buf, format="PNG", optimize=True)
        return buf.getvalue(), "png"


def count_image_tags(img_bytes):
    try:
        _, _, _, _, t = get_exif_tables(img_bytes)
        return len(t)
    except: return 0


def check_image_risks(all_tags):
    return [(t, all_tags[t]) for t in all_tags if t in SENSITIVE_IMAGE_TAGS]


# ══════════════════════════════════════
# DOCUMENT HELPERS
# ══════════════════════════════════════
def _str_or_none(val):
    if val is None: return None
    s = str(val).strip()
    return s if s else None


def inspect_docx(fb):
    doc = DocxDocument(io.BytesIO(fb))
    cp = doc.core_properties
    props = {}
    for n in ["author","last_modified_by","title","subject","keywords","category","comments","content_status","version","revision","created","modified","last_printed","identifier","language"]:
        v = _str_or_none(getattr(cp, n, None))
        if v: props[n] = v
    extras = {"Paragraphs": str(len(doc.paragraphs)), "Tables": str(len(doc.tables)), "Sections": str(len(doc.sections))}
    try:
        for rel in doc.part.rels.values():
            if "comments" in rel.reltype:
                from lxml import etree
                tree = etree.fromstring(rel.target_part.blob)
                c = len(tree)
                if c: extras["Comments"] = str(c)
                break
    except: pass
    risks = [(k, props[k]) for k in props if k in SENSITIVE_DOC_PROPERTIES]
    return props, extras, risks, "Word Document"


def inspect_pdf(fb):
    doc = fitz.open(stream=fb, filetype="pdf")
    meta = doc.metadata or {}
    props = {}
    for k in ["author","creator","producer","title","subject","keywords","creationDate","modDate"]:
        v = _str_or_none(meta.get(k))
        if v: props[k] = v
    extras = {"Pages": str(doc.page_count), "Encrypted": str(doc.is_encrypted), "Format": meta.get("format", "Unknown")}
    try:
        ec = doc.embfile_count()
        if ec: extras["Embedded files"] = str(ec)
    except: pass
    doc.close()
    risks = [(k, props[k]) for k in props if k in {"author", "creator", "producer"}]
    return props, extras, risks, "PDF Document"


def inspect_xlsx(fb):
    wb = openpyxl.load_workbook(io.BytesIO(fb), read_only=False, data_only=True)
    cp = wb.properties
    props = {}
    for n in ["creator","lastModifiedBy","title","subject","description","keywords","category","version","created","modified","last_printed","company","manager"]:
        v = _str_or_none(getattr(cp, n, None))
        if v: props[n] = v
    extras = {"Sheets": str(len(wb.sheetnames)), "Sheet names": ", ".join(wb.sheetnames)}
    hidden = [f"{s} ({wb[s].sheet_state})" for s in wb.sheetnames if wb[s].sheet_state != "visible"]
    if hidden: extras["⚠️ Hidden sheets"] = ", ".join(hidden)
    try:
        if wb.defined_names: extras["Named ranges"] = str(len(list(wb.defined_names.definedName)))
    except: pass
    wb.close()
    risk_map = {"creator":"author","lastModifiedBy":"last_modified_by","company":"company","manager":"manager"}
    risks = [(k, props[k]) for k in props if risk_map.get(k, "") in SENSITIVE_DOC_PROPERTIES]
    return props, extras, risks, "Excel Spreadsheet"


def inspect_pptx(fb):
    prs = Presentation(io.BytesIO(fb))
    cp = prs.core_properties
    props = {}
    for n in ["author","last_modified_by","title","subject","keywords","category","comments","content_status","version","revision","created","modified"]:
        v = _str_or_none(getattr(cp, n, None))
        if v: props[n] = v
    extras = {"Slides": str(len(prs.slides))}
    nc = sum(1 for s in prs.slides if s.has_notes_slide and s.notes_slide.notes_text_frame.text.strip())
    if nc: extras["Slides with speaker notes"] = str(nc)
    risks = [(k, props[k]) for k in props if k in SENSITIVE_DOC_PROPERTIES]
    return props, extras, risks, "PowerPoint Presentation"


def strip_docx(fb):
    doc = DocxDocument(io.BytesIO(fb))
    cp = doc.core_properties
    for attr in ["author","last_modified_by","title","subject","keywords","category","comments","content_status"]:
        try: setattr(cp, attr, "")
        except: pass
    cp.revision = 1
    try:
        from lxml import etree
        for rel in doc.part.package.rels.values():
            if "extended-properties" in rel.reltype:
                tree = etree.fromstring(rel.target_part.blob)
                ns = tree.nsmap.get(None, "")
                for tag in ["Company","Manager","Application","AppVersion","Template"]:
                    for e in tree.findall(f"{{{ns}}}{tag}"): e.text = ""
                rel.target_part._blob = etree.tostring(tree, xml_declaration=True, encoding="UTF-8", standalone=True)
                break
    except: pass
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def strip_pdf(fb):
    doc = fitz.open(stream=fb, filetype="pdf")
    doc.set_metadata({k: "" for k in ["author","creator","producer","title","subject","keywords","creationDate","modDate"]})
    try: doc.del_xml_metadata()
    except: pass
    buf = io.BytesIO()
    doc.save(buf, garbage=4, deflate=True, clean=True)
    doc.close()
    return buf.getvalue()


def strip_xlsx(fb):
    wb = openpyxl.load_workbook(io.BytesIO(fb))
    cp = wb.properties
    for attr in ["creator","lastModifiedBy","title","subject","description","keywords","category","company","manager"]:
        try: setattr(cp, attr, "")
        except: pass
    buf = io.BytesIO()
    wb.save(buf)
    wb.close()
    return buf.getvalue()


def strip_pptx(fb):
    prs = Presentation(io.BytesIO(fb))
    cp = prs.core_properties
    for attr in ["author","last_modified_by","title","subject","keywords","category","comments","content_status"]:
        try: setattr(cp, attr, "")
        except: pass
    cp.revision = 1
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


# ══════════════════════════════════════
# UNIFIED HELPERS
# ══════════════════════════════════════
def get_ext(name):
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""

def is_image(name):
    return get_ext(name) in IMAGE_FORMATS

def is_document(name):
    return get_ext(name) in DOC_FORMATS

def inspect_any(fb, name):
    """Returns (props_dict, extras_dict, risks_list, type_label, tag_count)."""
    ext = get_ext(name)
    if ext == "docx": p, e, r, t = inspect_docx(fb)
    elif ext == "pdf": p, e, r, t = inspect_pdf(fb)
    elif ext == "xlsx": p, e, r, t = inspect_xlsx(fb)
    elif ext == "pptx": p, e, r, t = inspect_pptx(fb)
    else: return {}, {}, [], "Unknown", 0
    return p, e, r, t, len(p)

def strip_any(fb, name, preserve_orient=True):
    """Returns (cleaned_bytes, extension)."""
    if is_image(name):
        return strip_image_metadata(fb, preserve_orient)
    ext = get_ext(name)
    if ext == "docx": return strip_docx(fb), "docx"
    elif ext == "pdf": return strip_pdf(fb), "pdf"
    elif ext == "xlsx": return strip_xlsx(fb), "xlsx"
    elif ext == "pptx": return strip_pptx(fb), "pptx"
    return fb, ext

def count_any(fb, name):
    if is_image(name): return count_image_tags(fb)
    try:
        p, _, _, _, c = inspect_any(fb, name)
        return c
    except: return 0

MIME_MAP = {
    "jpg": "image/jpeg", "png": "image/png", "webp": "image/webp",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


# ─── Sidebar ───
with st.sidebar:
    st.markdown("### ⚙️ Settings")
    preserve_orient = st.checkbox(
        "Preserve image orientation",
        value=True,
        help="Physically apply EXIF rotation before stripping so images don’t appear flipped",
    )

    st.markdown("---")
    st.markdown("##### 📂 Supported Formats")
    st.markdown(
        "🖼️ **Images:** JPG, PNG, WebP, TIFF, BMP\n\n"
        "📝 **Word:** DOCX\n\n"
        "📄 **PDF:** PDF\n\n"
        "📊 **Excel:** XLSX\n\n"
        "📽️ **PowerPoint:** PPTX"
    )

    st.markdown("---")
    st.markdown("##### ℹ️ About")
    st.markdown(
        "Free, open-source metadata tool.\n\n"
        "No file uploads to external servers — "
        "**everything runs locally on your machine.**"
    )
    st.markdown("---")
    st.markdown(
        "Made with ❤️ by "
        "[RehmozAyub](https://github.com/RehmozAyub)"
    )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# UNIFIED MAIN PAGE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

files = st.file_uploader(
    "Upload images and/or documents",
    type=ALL_FORMATS,
    accept_multiple_files=True,
    key="main_upload",
)

if not files:
    st.info(
        "👆 Upload one or more files to inspect and scrub their metadata.\n\n"
        "**Supported:** JPG, PNG, WebP, TIFF, BMP, DOCX, PDF, XLSX, PPTX"
    )
    st.stop()


# ─── Summary Table ───
file_data = []  # Store (file, bytes, ext, icon, tag_count, has_gps, risks)
for f in files:
    fb = f.read()
    f.seek(0)
    ext = get_ext(f.name)
    icon = FORMAT_ICONS.get(ext, "📁")

    if is_image(f.name):
        tc = count_image_tags(fb)
        gps = parse_gps_coords(fb) is not None
        _, _, _, _, all_t = get_exif_tables(fb)
        risks = check_image_risks(all_t)
    elif is_document(f.name):
        try:
            p, e, risks, tl, tc = inspect_any(fb, f.name)
        except:
            tc, risks = 0, []
        gps = False
    else:
        tc, gps, risks = 0, False, []

    file_data.append({
        "file": f, "bytes": fb, "ext": ext, "icon": icon,
        "tag_count": tc, "has_gps": gps, "risk_count": len(risks),
    })

df_summary = pd.DataFrame([{
    "Type": d["icon"],
    "File": d["file"].name,
    "Size (KB)": f"{len(d['bytes']) / 1024:.1f}",
    "Metadata": d["tag_count"],
    "GPS": "📍" if d["has_gps"] else "—",
    "Risks": f"⚠️ {d['risk_count']}" if d["risk_count"] else "✅",
} for d in file_data])

st.dataframe(df_summary, use_container_width=True, hide_index=True)

img_count = sum(1 for d in file_data if is_image(d["file"].name))
doc_count = sum(1 for d in file_data if is_document(d["file"].name))
total_meta = sum(d["tag_count"] for d in file_data)
total_risks = sum(d["risk_count"] for d in file_data)

col_s1, col_s2, col_s3, col_s4 = st.columns(4)
col_s1.metric("Files", len(files))
col_s2.metric("Images / Docs", f"{img_count} / {doc_count}")
col_s3.metric("Total Metadata", total_meta)
col_s4.metric("Privacy Risks", total_risks)


# ─── Strip All Button ───
st.markdown("---")

if st.button("🧹 Strip All Files & Download ZIP", type="primary", use_container_width=True):
    with st.spinner(f"Stripping metadata from {len(files)} files…"):
        zbuf = io.BytesIO()
        total_stripped = 0
        total_original = 0
        total_cleaned_size = 0

        with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as zf:
            for d in file_data:
                raw = d["bytes"]
                total_original += len(raw)
                old_count = d["tag_count"]

                try:
                    cleaned, out_ext = strip_any(raw, d["file"].name, preserve_orient)
                    new_count = count_any(cleaned, f"x.{out_ext}")
                    total_stripped += max(old_count - new_count, 0)
                    total_cleaned_size += len(cleaned)
                    stem = d["file"].name.rsplit(".", 1)[0]
                    zf.writestr(f"{stem}_clean.{out_ext}", cleaned)
                except Exception as e:
                    st.warning(f"⚠️ Skipped {d['file'].name}: {e}")
                    zf.writestr(d["file"].name, raw)
                    total_cleaned_size += len(raw)

    reduction = (1 - total_cleaned_size / total_original) * 100 if total_original else 0

    c1, c2, c3 = st.columns(3)
    c1.metric("Files Processed", str(len(files)))
    c2.metric("Metadata Stripped", str(total_stripped))
    c3.metric("Size Change", f"{reduction:+.1f}%")

    st.success(f"✅ Cleaned {len(files)} files | Removed {total_stripped} metadata entries")

    st.download_button(
        "⬇️ Download All Cleaned (ZIP)",
        data=zbuf.getvalue(),
        file_name=f"metadata_stripped_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip",
        mime="application/zip",
        use_container_width=True,
    )


# ─── Per-File Expanders ───
st.markdown("---")
st.markdown("### 📝 Per-File Details")

for idx, d in enumerate(file_data):
    f = d["file"]
    fb = d["bytes"]
    ext = d["ext"]
    icon = d["icon"]

    risk_badge = f" — ⚠️ {d['risk_count']} risk(s)" if d["risk_count"] else ""
    label = f"{icon} {f.name} — {d['tag_count']} tags{risk_badge}"

    with st.expander(label, expanded=False):

        # ---- IMAGE ----
        if is_image(f.name):
            col_img, col_meta = st.columns([1, 2])

            with col_img:
                st.image(fb, caption=f.name, width=300)

            with col_meta:
                basic, camera, gps, advanced, all_tags = get_exif_tables(fb)
                risks = check_image_risks(all_tags)

                if risks:
                    st.markdown(
                        '<div class="privacy-warn">' +
                        f'⚠️ <strong>Privacy Alert:</strong> {len(risks)} sensitive tag(s)' +
                        '</div>', unsafe_allow_html=True,
                    )
                    for tn, tv in risks:
                        st.markdown(f"- ⚠️ **{tn}:** `{tv}`")
                else:
                    st.markdown(
                        '<div class="privacy-ok">✅ No sensitive metadata.</div>',
                        unsafe_allow_html=True,
                    )

            # GPS Map
            coords = parse_gps_coords(fb)
            if coords:
                lat, lon = coords
                st.markdown(f"🗺️ **GPS:** `{lat:.6f}, {lon:.6f}`")
                st.map(pd.DataFrame({"lat": [lat], "lon": [lon]}), zoom=12)

            # Metadata tabs
            t_basic, t_cam, t_gps, t_adv, t_all = st.tabs(
                ["📋 Basic", "📷 Camera", "📍 GPS", "🔧 Advanced", "📜 All"]
            )
            for tab, data in [(t_basic, basic), (t_cam, camera), (t_gps, gps), (t_adv, advanced)]:
                with tab:
                    if data:
                        st.dataframe(pd.DataFrame(list(data.items()), columns=["Tag", "Value"]), use_container_width=True, hide_index=True)
                    else:
                        st.info("No data.")
            with t_all:
                if all_tags:
                    st.dataframe(pd.DataFrame(list(all_tags.items()), columns=["Tag", "Value"]), use_container_width=True, hide_index=True)
                else:
                    st.info("No metadata found.")

        # ---- DOCUMENT ----
        elif is_document(f.name):
            try:
                props, extras, risks, doc_type, tc = inspect_any(fb, f.name)
            except Exception as e:
                st.error(f"Failed to read: {e}")
                continue

            st.markdown(f"**{doc_type}** — {len(fb)/1024:.1f} KB")

            if risks:
                st.markdown(
                    '<div class="privacy-warn">' +
                    f'⚠️ <strong>Privacy Alert:</strong> {len(risks)} identifying properties' +
                    '</div>', unsafe_allow_html=True,
                )
                for pn, pv in risks:
                    st.markdown(f"- ⚠️ **{pn}:** `{pv}`")
            else:
                st.markdown(
                    '<div class="privacy-ok">✅ No sensitive metadata.</div>',
                    unsafe_allow_html=True,
                )

            t_props, t_extras = st.tabs(["📋 Properties", "🔧 Document Info"])
            with t_props:
                if props:
                    st.dataframe(pd.DataFrame(list(props.items()), columns=["Property", "Value"]), use_container_width=True, hide_index=True)
                else:
                    st.info("No properties found.")
            with t_extras:
                if extras:
                    st.dataframe(pd.DataFrame(list(extras.items()), columns=["Info", "Value"]), use_container_width=True, hide_index=True)
                else:
                    st.info("No extra info.")

        # ---- Strip + Download (per file) ----
        st.markdown("---")
        c_strip, c_json = st.columns(2)

        with c_strip:
            if st.button(f"🧹 Strip & Download", key=f"strip_{idx}", use_container_width=True):
                try:
                    cleaned, out_ext = strip_any(fb, f.name, preserve_orient)
                    new_count = count_any(cleaned, f"x.{out_ext}")
                    stripped = max(d["tag_count"] - new_count, 0)
                    st.success(f"✅ Stripped {stripped} entries")
                    stem = f.name.rsplit(".", 1)[0]
                    st.download_button(
                        f"⬇️ Download {stem}_clean.{out_ext}",
                        data=cleaned,
                        file_name=f"{stem}_clean.{out_ext}",
                        mime=MIME_MAP.get(out_ext, "application/octet-stream"),
                        use_container_width=True,
                        key=f"dl_{idx}",
                    )
                except Exception as e:
                    st.error(f"❌ Failed: {e}")

        with c_json:
            if is_image(f.name):
                _, _, _, _, all_tags = get_exif_tables(fb)
                export = all_tags
            elif is_document(f.name):
                try:
                    p, e, _, _, _ = inspect_any(fb, f.name)
                    export = {**p, **e}
                except:
                    export = {}
            else:
                export = {}

            if export:
                st.download_button(
                    "💾 Export Metadata JSON",
                    data=json.dumps(export, indent=2, default=str),
                    file_name=f"{f.name}_metadata.json",
                    mime="application/json",
                    use_container_width=True,
                    key=f"json_{idx}",
                )


# ─── Footer ───
st.markdown("---")
st.markdown(
    '<div style="text-align:center; color:#666; font-size:0.85rem;">'
    'Metadata Scrubber v2.0 · Built with Streamlit + Pillow + piexif + python-docx + openpyxl + python-pptx + PyMuPDF · '
    '<a href="https://github.com/RehmozAyub/tools-for-everyone" style="color:#667eea;">GitHub</a>'
    "</div>",
    unsafe_allow_html=True,
)
