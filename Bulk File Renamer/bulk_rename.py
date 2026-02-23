"""
Bulk File Renamer — Rename multiple files at once with powerful rules
Features: Find & Replace, Regex, Prefix/Suffix, Numbering, Date Stamp, Case, Extension, Trim
Built with Streamlit
"""

import streamlit as st
import re
import io
import zipfile
from datetime import datetime
from pathlib import Path

# ─── Page Config ───
st.set_page_config(
    page_title="Bulk File Renamer",
    page_icon="📁",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── Custom CSS (matches PDF Suite) ───
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
st.markdown('<div class="main-header">📁 Bulk File Renamer</div>', unsafe_allow_html=True)
st.markdown('<div class="sub-header">Rename multiple files at once — regex, numbering, dates & more</div>', unsafe_allow_html=True)

# ─── Sidebar Navigation ───
TOOLS = {
    "🔤 Find & Replace": "find_replace",
    "🔣 Regex Pattern": "regex",
    "📎 Prefix / Suffix": "prefix_suffix",
    "🔢 Sequential Numbering": "numbering",
    "📅 Date Stamp": "date_stamp",
    "🔠 Case Conversion": "case",
    "🔧 Extension": "extension",
    "✂️ Trim / Clean": "trim",
}

with st.sidebar:
    st.markdown("### 🧰 Renaming Rule")
    selected = st.radio("", list(TOOLS.keys()), label_visibility="collapsed")
    tool = TOOLS[selected]
    st.markdown("---")
    st.markdown("##### ℹ️ About")
    st.markdown(
        "Free, open-source bulk file renamer.\n\n"
        "No file uploads to external servers — "
        "**everything runs locally on your machine.**"
    )
    st.markdown("---")
    st.markdown(
        "Made with ❤️ by "
        "[RehmozAyub](https://github.com/RehmozAyub)"
    )

# ─── Session state ───
if "history" not in st.session_state:
    st.session_state.history = []

# ─── File upload ───
uploaded_files = st.file_uploader(
    "Drag & drop files here (or click to browse)",
    accept_multiple_files=True,
    help="Upload all the files you want to rename.",
)

if not uploaded_files:
    st.info("👆 Upload some files to get started.")
    st.stop()

original_names = [f.name for f in uploaded_files]
st.success(f"✅ {len(uploaded_files)} file(s) uploaded")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# FIND & REPLACE
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if tool == "find_replace":
    st.markdown("### 🔤 Find & Replace")
    st.markdown("Simple text substitution in filenames.")
    col1, col2 = st.columns(2)
    find_text = col1.text_input("Find", key="find")
    replace_text = col2.text_input("Replace with", key="replace")
    find_case = st.checkbox("Case-sensitive", value=True, key="find_case")

    def apply_rule(names):
        result = []
        for name in names:
            p = Path(name)
            stem, ext = p.stem, p.suffix
            if find_text:
                if find_case:
                    stem = stem.replace(find_text, replace_text)
                else:
                    stem = re.sub(re.escape(find_text), replace_text, stem, flags=re.IGNORECASE)
            result.append(stem + ext)
        return result


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# REGEX PATTERN
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif tool == "regex":
    st.markdown("### 🔣 Regex Pattern")
    st.markdown("Apply a regex pattern to the filename stem (without extension).")
    col1, col2 = st.columns(2)
    regex_pattern = col1.text_input("Regex pattern", placeholder=r"(\d+)", key="regex_pat")
    regex_replace = col2.text_input("Replacement", placeholder=r"NUM_\1", key="regex_rep")
    regex_flags = st.multiselect("Flags", ["IGNORECASE", "MULTILINE"], key="regex_flags")

    def apply_rule(names):
        result = []
        for name in names:
            p = Path(name)
            stem, ext = p.stem, p.suffix
            if regex_pattern:
                try:
                    flags = 0
                    for f in regex_flags:
                        flags |= getattr(re, f)
                    stem = re.sub(regex_pattern, regex_replace, stem, flags=flags)
                except re.error:
                    pass
            result.append(stem + ext)
        return result


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PREFIX / SUFFIX
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif tool == "prefix_suffix":
    st.markdown("### 📎 Prefix / Suffix")
    st.markdown("Add text before or after the filename stem.")
    col1, col2 = st.columns(2)
    prefix = col1.text_input("Prefix", key="prefix")
    suffix = col2.text_input("Suffix (before extension)", key="suffix")

    def apply_rule(names):
        result = []
        for name in names:
            p = Path(name)
            stem, ext = p.stem, p.suffix
            stem = prefix + stem + suffix
            result.append(stem + ext)
        return result


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SEQUENTIAL NUMBERING
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif tool == "numbering":
    st.markdown("### 🔢 Sequential Numbering")
    st.markdown("Automatically number files with configurable format.")
    col1, col2, col3 = st.columns(3)
    seq_start = col1.number_input("Start at", value=1, step=1, key="seq_start")
    seq_step = col2.number_input("Step", value=1, step=1, min_value=1, key="seq_step")
    seq_padding = col3.number_input("Zero-pad width", value=3, min_value=1, max_value=10, key="seq_pad")
    seq_position = st.radio("Position", ["Prefix", "Suffix"], horizontal=True, key="seq_pos")
    seq_separator = st.text_input("Separator", value="_", key="seq_sep")
    seq_replace_name = st.checkbox("Replace entire filename with number only", key="seq_replace")

    def apply_rule(names):
        result = []
        for idx, name in enumerate(names):
            p = Path(name)
            stem, ext = p.stem, p.suffix
            num = str(int(seq_start + idx * seq_step)).zfill(int(seq_padding))
            if seq_replace_name:
                stem = num
            elif seq_position == "Prefix":
                stem = num + seq_separator + stem
            else:
                stem = stem + seq_separator + num
            result.append(stem + ext)
        return result


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# DATE STAMP
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif tool == "date_stamp":
    st.markdown("### 📅 Date Stamp")
    st.markdown("Add a date or timestamp to filenames.")
    col1, col2 = st.columns(2)
    date_format = col1.selectbox(
        "Date format",
        ["%Y-%m-%d", "%Y%m%d", "%d-%m-%Y", "%m-%d-%Y", "%Y-%m-%d_%H-%M-%S", "%d%b%Y"],
        key="date_fmt",
    )
    date_position = col2.radio("Position", ["Prefix", "Suffix"], horizontal=True, key="date_pos")
    date_separator = st.text_input("Separator", value="_", key="date_sep")
    custom_date = st.date_input("Date", value=datetime.today(), key="custom_date")

    def apply_rule(names):
        result = []
        stamp = custom_date.strftime(date_format)
        for name in names:
            p = Path(name)
            stem, ext = p.stem, p.suffix
            if date_position == "Prefix":
                stem = stamp + date_separator + stem
            else:
                stem = stem + date_separator + stamp
            result.append(stem + ext)
        return result


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CASE CONVERSION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif tool == "case":
    st.markdown("### 🔠 Case Conversion")
    st.markdown("Change the letter casing of filenames.")
    case_mode = st.selectbox(
        "Convert to",
        ["lowercase", "UPPERCASE", "Title Case", "snake_case", "camelCase", "kebab-case"],
        key="case_mode",
    )

    def apply_rule(names):
        result = []
        for name in names:
            p = Path(name)
            stem, ext = p.stem, p.suffix
            if case_mode == "lowercase":
                stem = stem.lower()
            elif case_mode == "UPPERCASE":
                stem = stem.upper()
            elif case_mode == "Title Case":
                stem = stem.title()
            elif case_mode == "snake_case":
                stem = re.sub(r'[\s\-]+', '_', stem).lower()
                stem = re.sub(r'([a-z])([A-Z])', r'\1_\2', stem).lower()
            elif case_mode == "camelCase":
                parts = re.split(r'[\s_\-]+', stem)
                stem = parts[0].lower() + ''.join(w.capitalize() for w in parts[1:]) if parts else stem
            elif case_mode == "kebab-case":
                stem = re.sub(r'[\s_]+', '-', stem).lower()
                stem = re.sub(r'([a-z])([A-Z])', r'\1-\2', stem).lower()
            result.append(stem + ext)
        return result


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# EXTENSION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif tool == "extension":
    st.markdown("### 🔧 Extension")
    st.markdown("Change, remove, or add file extensions.")
    ext_mode = st.radio(
        "Action",
        ["Change extension", "Remove extension", "Add extra extension"],
        horizontal=True,
        key="ext_mode",
    )
    new_ext = st.text_input(
        "New / extra extension (e.g. .txt, .bak)",
        key="new_ext",
        disabled=ext_mode == "Remove extension",
    )

    def apply_rule(names):
        result = []
        for name in names:
            p = Path(name)
            stem, ext = p.stem, p.suffix
            if ext_mode == "Remove extension":
                ext = ""
            elif ext_mode == "Change extension":
                ext = new_ext if new_ext.startswith(".") else f".{new_ext}" if new_ext else ext
            elif ext_mode == "Add extra extension":
                extra = new_ext if new_ext.startswith(".") else f".{new_ext}" if new_ext else ""
                ext = ext + extra
            result.append(stem + ext)
        return result


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TRIM / CLEAN
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
elif tool == "trim":
    st.markdown("### ✂️ Trim / Clean")
    st.markdown("Remove characters, replace spaces, and clean up filenames.")
    col1, col2 = st.columns(2)
    trim_start = col1.number_input("Remove first N characters", min_value=0, value=0, key="trim_s")
    trim_end = col2.number_input("Remove last N characters (from stem)", min_value=0, value=0, key="trim_e")
    replace_spaces = st.selectbox(
        "Replace spaces with",
        ["(don't replace)", "_", "-", ".", "(remove spaces)"],
        key="space_replace",
    )
    strip_special = st.checkbox("Strip special characters (keep letters, numbers, _ , - , .)", key="strip_special")

    def apply_rule(names):
        result = []
        for name in names:
            p = Path(name)
            stem, ext = p.stem, p.suffix
            if trim_start > 0:
                stem = stem[trim_start:]
            if trim_end > 0 and trim_end < len(stem):
                stem = stem[:-trim_end]
            if replace_spaces == "(remove spaces)":
                stem = stem.replace(" ", "")
            elif replace_spaces != "(don't replace)":
                stem = stem.replace(" ", replace_spaces)
            if strip_special:
                stem = re.sub(r'[^\w\-.]', '', stem)
            result.append(stem + ext)
        return result


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# PREVIEW
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
st.markdown("---")
st.markdown("### 👀 Preview")

new_names = apply_rule(original_names)

# Duplicate detection
duplicates = {n for n in new_names if new_names.count(n) > 1}

for old, new in zip(original_names, new_names):
    dup_tag = " ⚠️ **DUPLICATE**" if new in duplicates else ""
    icon = "🔄" if old != new else "✅"
    st.markdown(f"{icon}&ensp; `{old}` &nbsp;→&nbsp; **`{new}`**{dup_tag}")

if duplicates:
    st.warning("⚠️ Some renamed files have identical names. Adjust your rules to avoid overwrites.")

changed_count = sum(1 for o, n in zip(original_names, new_names) if o != n)
st.caption(f"📊 {changed_count}/{len(original_names)} file(s) will be renamed.")


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# DOWNLOAD
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
st.markdown("### 📥 Download")

if st.button("🚀 Generate Renamed ZIP", type="primary", use_container_width=True):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for file, new_name in zip(uploaded_files, new_names):
            file.seek(0)
            zf.writestr(new_name, file.read())
    buf.seek(0)

    mapping = {o: n for o, n in zip(original_names, new_names) if o != n}
    st.session_state.history.append((datetime.now().strftime("%H:%M:%S"), mapping))

    st.download_button(
        "⬇️ Download ZIP",
        data=buf,
        file_name=f"renamed_files_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip",
        mime="application/zip",
        use_container_width=True,
    )
    st.success("✅ ZIP ready for download!")

# ─── History ───
if st.session_state.history:
    with st.expander("📜 Rename History (this session)"):
        for time_stamp, mapping in reversed(st.session_state.history):
            st.markdown(f"**{time_stamp}** — {len(mapping)} file(s) renamed")
            for old, new in mapping.items():
                st.markdown(f"- `{old}` → `{new}`")
            st.divider()

# ─── Footer ───
st.markdown("---")
st.markdown(
    '<div style="text-align:center; color:#666; font-size:0.85rem;">'
    'Bulk File Renamer v1.0 · Built with Streamlit · '
    '<a href="https://github.com/RehmozAyub/tools-for-everyone" style="color:#667eea;">GitHub</a>'
    "</div>",
    unsafe_allow_html=True,
)
