"""
EXIF Stripper + Inspector — View & remove image metadata
Features: Inspect EXIF, GPS map, privacy alerts, strip single/batch, preserve orientation
Built with Streamlit + Pillow + piexif
"""

import streamlit as st
from PIL import Image, ExifTags, ImageOps
from PIL.ExifTags import TAGS, GPSTAGS, IFD
import piexif
import io
import zipfile
import pandas as pd
from datetime import datetime

# ─── Page Config ───
st.set_page_config(
    page_title="EXIF Stripper + Inspector",
    page_icon="🔍",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── Custom CSS (consistent with PDF Suite / QR Code Studio / Bulk Renamer) ───
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
st.markdown('<div class="main-header">🔍 EXIF Stripper + Inspector</div>', unsafe_allow_html=True)
st.markdown(
    '<div class="sub-header">Inspect, analyze & strip metadata from your images — protect your privacy</div>',
    unsafe_allow_html=True,
)

# ─── Constants ───
SENSITIVE_TAGS = {
    "GPSLatitude", "GPSLongitude", "GPSLatitudeRef", "GPSLongitudeRef",
    "GPSAltitude", "GPSTimeStamp", "GPSDateStamp",
    "BodySerialNumber", "CameraSerialNumber", "SerialNumber",
    "LensSerialNumber", "ImageUniqueID",
    "CameraOwnerName", "OwnerName", "Artist", "Copyright",
    "XPAuthor", "XPComment",
}

SUPPORTED_FORMATS = ["jpg", "jpeg", "png", "webp", "tiff", "bmp", "heic"]


# ─── Helpers ───
def get_exif_tables(img_bytes):
    """
    Extract all EXIF metadata and return categorized dicts.
    Returns: (basic_info, camera_info, gps_info, advanced_info, all_tags)
    """
    img = Image.open(io.BytesIO(img_bytes))
    exif = img.getexif()

    basic = {}
    camera = {}
    gps = {}
    advanced = {}
    all_tags = {}

    # Basic image info (not from EXIF)
    basic["Format"] = img.format or "Unknown"
    basic["Mode"] = img.mode
    basic["Size"] = f"{img.width} × {img.height} px"
    basic["File Size"] = f"{len(img_bytes) / 1024:.1f} KB"

    # IFD0 tags
    for tag_id, value in exif.items():
        tag_name = TAGS.get(tag_id, f"Tag_{tag_id}")
        str_value = _safe_str(value)
        all_tags[tag_name] = str_value

        if tag_name in ("Make", "Model", "Software", "LensMake", "LensModel"):
            camera[tag_name] = str_value
        elif tag_name in ("DateTime", "DateTimeOriginal", "DateTimeDigitized"):
            basic[tag_name] = str_value
        elif tag_name in ("Orientation",):
            basic[tag_name] = _orientation_str(value)
        elif tag_name in ("ImageWidth", "ImageLength"):
            continue  # Already have size
        else:
            advanced[tag_name] = str_value

    # EXIF IFD (detailed camera/shot info)
    try:
        exif_ifd = exif.get_ifd(IFD.Exif)
        for tag_id, value in exif_ifd.items():
            tag_name = TAGS.get(tag_id, f"Tag_{tag_id}")
            str_value = _safe_str(value)
            all_tags[tag_name] = str_value

            if tag_name in (
                "ExposureTime", "FNumber", "ISOSpeedRatings",
                "FocalLength", "FocalLengthIn35mmFilm",
                "ExposureProgram", "MeteringMode", "Flash",
                "WhiteBalance", "ExposureBiasValue",
                "MaxApertureValue", "DigitalZoomRatio",
                "ShutterSpeedValue", "ApertureValue",
                "BrightnessValue", "LightSource",
            ):
                camera[tag_name] = str_value
            elif tag_name in (
                "DateTimeOriginal", "DateTimeDigitized",
                "OffsetTime", "OffsetTimeOriginal",
            ):
                basic[tag_name] = str_value
            else:
                advanced[tag_name] = str_value
    except Exception:
        pass

    # GPS IFD
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
    """Extract GPS coordinates as (lat, lon) or None."""
    try:
        img = Image.open(io.BytesIO(img_bytes))
        exif = img.getexif()
        gps_ifd = exif.get_ifd(IFD.GPSInfo)

        if not gps_ifd:
            return None

        lat = gps_ifd.get(2)   # GPSLatitude
        lat_ref = gps_ifd.get(1)  # GPSLatitudeRef
        lon = gps_ifd.get(4)   # GPSLongitude
        lon_ref = gps_ifd.get(3)  # GPSLongitudeRef

        if not all([lat, lat_ref, lon, lon_ref]):
            return None

        lat_deg = float(lat[0]) + float(lat[1]) / 60.0 + float(lat[2]) / 3600.0
        lon_deg = float(lon[0]) + float(lon[1]) / 60.0 + float(lon[2]) / 3600.0

        if lat_ref == "S":
            lat_deg = -lat_deg
        if lon_ref == "W":
            lon_deg = -lon_deg

        return lat_deg, lon_deg
    except Exception:
        return None


def strip_metadata(img_bytes, preserve_orientation=True):
    """
    Remove all EXIF/metadata from image bytes.
    Optionally applies orientation transform before stripping.
    Returns: (cleaned_bytes, output_format)
    """
    img = Image.open(io.BytesIO(img_bytes))
    original_format = img.format or "JPEG"

    # Apply EXIF orientation physically before stripping
    if preserve_orientation:
        img = ImageOps.exif_transpose(img) or img

    # Convert RGBA to RGB for JPEG output
    output_format = original_format.upper()
    if output_format in ("JPG", "JPEG"):
        output_format = "JPEG"
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
    elif output_format == "WEBP":
        pass  # WebP supports RGBA
    elif output_format == "PNG":
        pass
    else:
        # Fallback to JPEG for unsupported formats
        output_format = "JPEG"
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

    buf = io.BytesIO()

    if output_format == "JPEG":
        img.save(buf, format="JPEG", quality=95, optimize=True)
        # Double-ensure EXIF is gone with piexif
        try:
            cleaned = piexif.remove(buf.getvalue())
            return cleaned, "jpg"
        except Exception:
            return buf.getvalue(), "jpg"
    elif output_format == "PNG":
        # Save PNG without any metadata chunks
        img.save(buf, format="PNG", optimize=True)
        return buf.getvalue(), "png"
    elif output_format == "WEBP":
        img.save(buf, format="WEBP", quality=95)
        try:
            cleaned = piexif.remove(buf.getvalue())
            return cleaned, "webp"
        except Exception:
            return buf.getvalue(), "webp"
    else:
        img.save(buf, format="JPEG", quality=95)
        return buf.getvalue(), "jpg"


def check_privacy_risks(all_tags):
    """Check for privacy-sensitive tags and return list of warnings."""
    risks = []
    for tag_name in all_tags:
        if tag_name in SENSITIVE_TAGS:
            risks.append((tag_name, all_tags[tag_name]))
    return risks


def _safe_str(value):
    """Safely convert EXIF value to string."""
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8", errors="replace").strip("\x00")
        except Exception:
            return f"<{len(value)} bytes>"
    if isinstance(value, tuple) and len(value) == 2 and isinstance(value[1], int):
        # Rational number
        if value[1] != 0:
            result = value[0] / value[1]
            return f"{result:.4g}" if result != int(result) else str(int(result))
    return str(value)


def _orientation_str(val):
    """Convert orientation value to readable string."""
    orientations = {
        1: "Normal",
        2: "Mirrored horizontal",
        3: "Rotated 180°",
        4: "Mirrored vertical",
        5: "Mirrored horizontal + Rotated 270°",
        6: "Rotated 90° CW",
        7: "Mirrored horizontal + Rotated 90°",
        8: "Rotated 270° CW",
    }
    return orientations.get(val, str(val))


def count_metadata_tags(img_bytes):
    """Quick count of total metadata tags."""
    try:
        _, _, _, _, all_tags = get_exif_tables(img_bytes)
        return len(all_tags)
    except Exception:
        return 0


# ─── Sidebar ───
with st.sidebar:
    st.markdown("### 🧰 Select Tool")
    selected = st.radio(
        "",
        ["🔍 Inspect Metadata", "🧹 Strip Single Image", "📦 Batch Strip"],
        label_visibility="collapsed",
    )

    st.markdown("---")

    if selected == "🧹 Strip Single Image":
        st.markdown("### ⚙️ Strip Settings")
        preserve_orient = st.checkbox(
            "Preserve orientation",
            value=True,
            help="Apply EXIF rotation before stripping so the image doesn’t appear rotated",
        )
    elif selected == "📦 Batch Strip":
        st.markdown("### ⚙️ Batch Settings")
        preserve_orient = st.checkbox("Preserve orientation", value=True)
    else:
        preserve_orient = True

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


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# INSPECT METADATA
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if selected == "🔍 Inspect Metadata":
    st.markdown("### 🔍 Inspect Metadata")
    st.markdown("Upload an image to view all embedded metadata and check for privacy risks.")

    file = st.file_uploader(
        "Upload image",
        type=SUPPORTED_FORMATS,
        key="inspect_upload",
    )

    if file:
        img_bytes = file.read()

        # Show image preview
        col_img, col_info = st.columns([1, 2])

        with col_img:
            st.image(img_bytes, caption=file.name, width=350)

        with col_info:
            with st.spinner("Reading metadata…"):
                basic, camera, gps, advanced, all_tags = get_exif_tables(img_bytes)

            # Privacy risk check
            risks = check_privacy_risks(all_tags)
            if risks:
                st.markdown(
                    '<div class="privacy-warn">' +
                    f'⚠️ <strong>Privacy Alert:</strong> Found {len(risks)} sensitive tag(s) '
                    'that could identify you or your location.' +
                    '</div>',
                    unsafe_allow_html=True,
                )
                for tag_name, tag_val in risks:
                    st.markdown(f"- ⚠️ **{tag_name}:** `{tag_val}`")
            else:
                st.markdown(
                    '<div class="privacy-ok">'
                    '✅ <strong>No sensitive metadata found.</strong> Image looks clean.'
                    '</div>',
                    unsafe_allow_html=True,
                )

            # Tag count
            st.info(f"🏷️ **{len(all_tags)}** metadata tags found")

        st.markdown("---")

        # GPS Map
        coords = parse_gps_coords(img_bytes)
        if coords:
            st.markdown("### 🗺️ GPS Location")
            lat, lon = coords
            st.markdown(f"**Latitude:** `{lat:.6f}` &nbsp;&nbsp; **Longitude:** `{lon:.6f}`")

            map_df = pd.DataFrame({"lat": [lat], "lon": [lon]})
            st.map(map_df, zoom=12)
            st.markdown("---")

        # Categorized metadata tables
        tab_basic, tab_camera, tab_gps, tab_advanced, tab_all = st.tabs(
            ["📋 Basic", "📷 Camera", "📍 GPS", "🔧 Advanced", "📜 All Tags"]
        )

        with tab_basic:
            if basic:
                df = pd.DataFrame(list(basic.items()), columns=["Tag", "Value"])
                st.dataframe(df, use_container_width=True, hide_index=True)
            else:
                st.info("No basic metadata found.")

        with tab_camera:
            if camera:
                df = pd.DataFrame(list(camera.items()), columns=["Tag", "Value"])
                st.dataframe(df, use_container_width=True, hide_index=True)
            else:
                st.info("No camera metadata found.")

        with tab_gps:
            if gps:
                df = pd.DataFrame(list(gps.items()), columns=["Tag", "Value"])
                st.dataframe(df, use_container_width=True, hide_index=True)
            else:
                st.info("No GPS metadata found.")

        with tab_advanced:
            if advanced:
                df = pd.DataFrame(list(advanced.items()), columns=["Tag", "Value"])
                st.dataframe(df, use_container_width=True, hide_index=True)
            else:
                st.info("No advanced metadata found.")

        with tab_all:
            if all_tags:
                df = pd.DataFrame(list(all_tags.items()), columns=["Tag", "Value"])
                # Highlight sensitive tags
                st.dataframe(df, use_container_width=True, hide_index=True)
                st.markdown(f"**Total: {len(all_tags)} tags**")
            else:
                st.info("No metadata found in this image.")

        # Export metadata as JSON
        if all_tags:
            import json
            json_str = json.dumps(all_tags, indent=2, default=str)
            st.download_button(
                "⬇️ Export Metadata as JSON",
                data=json_str,
                file_name=f"{file.name}_metadata.json",
                mime="application/json",
                use_container_width=True,
            )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STRIP SINGLE IMAGE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif selected == "🧹 Strip Single Image":
    st.markdown("### 🧹 Strip Metadata")
    st.markdown("Remove all EXIF and metadata from a single image.")

    file = st.file_uploader(
        "Upload image",
        type=SUPPORTED_FORMATS,
        key="strip_upload",
    )

    if file:
        img_bytes = file.read()
        original_size = len(img_bytes)

        # Show preview and tag count
        col_img, col_info = st.columns([1, 2])

        with col_img:
            st.image(img_bytes, caption=file.name, width=300)

        with col_info:
            tag_count = count_metadata_tags(img_bytes)
            coords = parse_gps_coords(img_bytes)
            risks = check_privacy_risks(get_exif_tables(img_bytes)[4])

            st.info(f"🏷️ **{tag_count}** metadata tags found")
            st.info(f"📂 Original size: **{original_size / 1024:.1f} KB**")

            if coords:
                st.warning(f"📍 GPS location embedded: `{coords[0]:.4f}, {coords[1]:.4f}`")
            if risks:
                st.warning(f"⚠️ {len(risks)} privacy-sensitive tag(s) will be removed")

        if st.button("🧹 Strip All Metadata", type="primary", use_container_width=True):
            with st.spinner("Stripping metadata…"):
                cleaned, ext = strip_metadata(img_bytes, preserve_orient)

            new_size = len(cleaned)
            reduction = (1 - new_size / original_size) * 100

            # Verify stripping worked
            new_tags = count_metadata_tags(cleaned)

            c1, c2, c3 = st.columns(3)
            c1.metric("Original", f"{original_size / 1024:.1f} KB")
            c2.metric("Cleaned", f"{new_size / 1024:.1f} KB")
            c3.metric("Tags Remaining", str(new_tags))

            st.success(
                f"✅ Stripped **{tag_count - new_tags}** metadata tags | "
                f"Size change: {reduction:+.1f}%"
            )

            # Before / After preview
            col_before, col_after = st.columns(2)
            with col_before:
                st.markdown("**Before**")
                st.image(img_bytes, width=300)
            with col_after:
                st.markdown("**After (cleaned)**")
                st.image(cleaned, width=300)

            stem = file.name.rsplit(".", 1)[0]
            st.download_button(
                "⬇️ Download Cleaned Image",
                data=cleaned,
                file_name=f"{stem}_clean.{ext}",
                mime=f"image/{ext}",
                use_container_width=True,
            )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# BATCH STRIP
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif selected == "📦 Batch Strip":
    st.markdown("### 📦 Batch Strip Metadata")
    st.markdown("Upload multiple images to strip all metadata at once. Download as ZIP.")

    files = st.file_uploader(
        "Upload images",
        type=SUPPORTED_FORMATS,
        accept_multiple_files=True,
        key="batch_upload",
    )

    if files:
        # Summary table
        summary = []
        for f in files:
            f_bytes = f.read()
            f.seek(0)  # Reset for later use
            tag_count = count_metadata_tags(f_bytes)
            has_gps = parse_gps_coords(f_bytes) is not None
            summary.append({
                "File": f.name,
                "Size (KB)": f"{f.size / 1024:.1f}",
                "Tags": tag_count,
                "GPS": "📍 Yes" if has_gps else "—",
            })

        df_summary = pd.DataFrame(summary)
        st.dataframe(df_summary, use_container_width=True, hide_index=True)

        total_tags = sum(s["Tags"] for s in summary)
        gps_count = sum(1 for s in summary if s["GPS"] == "📍 Yes")
        st.info(
            f"📦 **{len(files)}** images | "
            f"🏷️ **{total_tags}** total tags | "
            f"📍 **{gps_count}** with GPS"
        )

        if st.button("🧹 Strip All Images", type="primary", use_container_width=True):
            with st.spinner(f"Stripping metadata from {len(files)} images…"):
                zbuf = io.BytesIO()
                total_stripped = 0
                total_original = 0
                total_cleaned = 0

                with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as zf:
                    for f in files:
                        raw = f.read()
                        total_original += len(raw)
                        old_tags = count_metadata_tags(raw)

                        cleaned, ext = strip_metadata(raw, preserve_orient)
                        total_cleaned += len(cleaned)
                        new_tags = count_metadata_tags(cleaned)
                        total_stripped += (old_tags - new_tags)

                        stem = f.name.rsplit(".", 1)[0]
                        zf.writestr(f"{stem}_clean.{ext}", cleaned)

            reduction = (1 - total_cleaned / total_original) * 100 if total_original else 0

            c1, c2, c3 = st.columns(3)
            c1.metric("Images Processed", str(len(files)))
            c2.metric("Tags Stripped", str(total_stripped))
            c3.metric("Size Change", f"{reduction:+.1f}%")

            st.success(
                f"✅ Cleaned {len(files)} images | "
                f"Removed {total_stripped} metadata tags"
            )

            st.download_button(
                "⬇️ Download All (ZIP)",
                data=zbuf.getvalue(),
                file_name=f"exif_stripped_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip",
                mime="application/zip",
                use_container_width=True,
            )


# ─── Footer ───
st.markdown("---")
st.markdown(
    '<div style="text-align:center; color:#666; font-size:0.85rem;">'
    'EXIF Stripper + Inspector v1.0 · Built with Streamlit + Pillow + piexif · '
    '<a href="https://github.com/RehmozAyub/tools-for-everyone" style="color:#667eea;">GitHub</a>'
    "</div>",
    unsafe_allow_html=True,
)
