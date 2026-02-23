import streamlit as st
import re
import io
import zipfile
from datetime import datetime
from pathlib import Path

st.set_page_config(page_title="Bulk File Renamer", page_icon="📁", layout="wide")

# ── Custom CSS ──────────────────────────────────────────────────────────────
st.markdown("""
<style>
    .stApp { max-width: 1200px; margin: 0 auto; }
    .rename-preview { background: #f0f2f6; border-radius: 8px; padding: 12px; margin: 4px 0; }
    .arrow { color: #ff4b4b; font-weight: bold; }
    .old-name { color: #666; }
    .new-name { color: #0e8a16; font-weight: 600; }
    div[data-testid="stFileUploader"] > div { min-height: 150px; }
</style>
""", unsafe_allow_html=True)

st.title("📁 Bulk File Renamer")
st.caption("Upload files, configure renaming rules, preview changes, and download renamed files as a ZIP.")

# ── Session state ───────────────────────────────────────────────────────────
if "history" not in st.session_state:
    st.session_state.history = []  # list of (description, mapping) tuples

# ── File upload ─────────────────────────────────────────────────────────────
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

# ── Renaming configuration ─────────────────────────────────────────────────
st.header("⚙️ Renaming Rules")
st.markdown("Rules are applied **top to bottom** in sequence.")

tabs = st.tabs([
    "🔤 Find & Replace",
    "🔣 Regex",
    "📎 Prefix / Suffix",
    "🔢 Sequential Numbering",
    "📅 Date Stamp",
    "🔠 Case Conversion",
    "🔧 Extension",
    "✂️ Trim / Pad",
])

# ── Tab 0: Find & Replace ──────────────────────────────────────────────────
with tabs[0]:
    col1, col2 = st.columns(2)
    find_text = col1.text_input("Find", key="find")
    replace_text = col2.text_input("Replace with", key="replace")
    find_case = st.checkbox("Case-sensitive", value=True, key="find_case")

# ── Tab 1: Regex ────────────────────────────────────────────────────────────
with tabs[1]:
    st.markdown("Apply a regex pattern to the **stem** (filename without extension).")
    col1, col2 = st.columns(2)
    regex_pattern = col1.text_input("Regex pattern", placeholder=r"(\d+)", key="regex_pat")
    regex_replace = col2.text_input("Replacement", placeholder=r"NUM_\1", key="regex_rep")
    regex_flags = st.multiselect("Flags", ["IGNORECASE", "MULTILINE"], key="regex_flags")

# ── Tab 2: Prefix / Suffix ─────────────────────────────────────────────────
with tabs[2]:
    col1, col2 = st.columns(2)
    prefix = col1.text_input("Prefix", key="prefix")
    suffix = col2.text_input("Suffix (before extension)", key="suffix")

# ── Tab 3: Sequential Numbering ────────────────────────────────────────────
with tabs[3]:
    enable_seq = st.checkbox("Enable sequential numbering", key="seq_enable")
    col1, col2, col3 = st.columns(3)
    seq_start = col1.number_input("Start at", value=1, step=1, key="seq_start")
    seq_step = col2.number_input("Step", value=1, step=1, min_value=1, key="seq_step")
    seq_padding = col3.number_input("Zero-pad width", value=3, min_value=1, max_value=10, key="seq_pad")
    seq_position = st.radio("Position", ["Prefix", "Suffix"], horizontal=True, key="seq_pos")
    seq_separator = st.text_input("Separator", value="_", key="seq_sep")

# ── Tab 4: Date Stamp ──────────────────────────────────────────────────────
with tabs[4]:
    enable_date = st.checkbox("Add date stamp", key="date_enable")
    col1, col2 = st.columns(2)
    date_format = col1.selectbox(
        "Date format",
        ["%Y-%m-%d", "%Y%m%d", "%d-%m-%Y", "%m-%d-%Y", "%Y-%m-%d_%H-%M-%S", "%d%b%Y"],
        key="date_fmt",
    )
    date_position = col2.radio("Position", ["Prefix", "Suffix"], horizontal=True, key="date_pos")
    date_separator = st.text_input("Separator", value="_", key="date_sep")
    custom_date = st.date_input("Custom date (leave as today for current date)", value=datetime.today(), key="custom_date")

# ── Tab 5: Case Conversion ─────────────────────────────────────────────────
with tabs[5]:
    case_mode = st.selectbox(
        "Convert case",
        ["(none)", "lowercase", "UPPERCASE", "Title Case", "snake_case", "camelCase", "kebab-case"],
        key="case_mode",
    )

# ── Tab 6: Extension ───────────────────────────────────────────────────────
with tabs[6]:
    ext_mode = st.radio(
        "Extension action",
        ["Keep original", "Change extension", "Remove extension", "Add extra extension"],
        key="ext_mode",
    )
    new_ext = st.text_input(
        "New / extra extension (e.g. .txt, .bak)",
        key="new_ext",
        disabled=ext_mode in ["Keep original", "Remove extension"],
    )

# ── Tab 7: Trim / Pad ──────────────────────────────────────────────────────
with tabs[7]:
    col1, col2 = st.columns(2)
    trim_start = col1.number_input("Remove first N characters", min_value=0, value=0, key="trim_s")
    trim_end = col2.number_input("Remove last N characters (from stem)", min_value=0, value=0, key="trim_e")
    replace_spaces = st.selectbox(
        "Replace spaces with",
        ["(don't replace)", "_", "-", ".", ""],
        key="space_replace",
    )


# ── Renaming engine ─────────────────────────────────────────────────────────
def apply_rules(names: list[str]) -> list[str]:
    new_names = []
    for idx, name in enumerate(names):
        p = Path(name)
        stem = p.stem
        ext = p.suffix  # includes dot

        # 1. Find & Replace
        if find_text:
            if find_case:
                stem = stem.replace(find_text, replace_text)
            else:
                pattern = re.compile(re.escape(find_text), re.IGNORECASE)
                stem = pattern.sub(replace_text, stem)

        # 2. Regex
        if regex_pattern:
            try:
                flags = 0
                for f in regex_flags:
                    flags |= getattr(re, f)
                stem = re.sub(regex_pattern, regex_replace, stem, flags=flags)
            except re.error:
                pass  # invalid regex – skip

        # 3. Trim
        if trim_start > 0:
            stem = stem[trim_start:]
        if trim_end > 0:
            stem = stem[:-trim_end] if trim_end < len(stem) else stem

        # 4. Replace spaces
        if replace_spaces != "(don't replace)":
            stem = stem.replace(" ", replace_spaces)

        # 5. Case conversion
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

        # 6. Prefix / Suffix
        if prefix:
            stem = prefix + stem
        if suffix:
            stem = stem + suffix

        # 7. Sequential numbering
        if enable_seq:
            num = str(int(seq_start + idx * seq_step)).zfill(int(seq_padding))
            if seq_position == "Prefix":
                stem = num + seq_separator + stem
            else:
                stem = stem + seq_separator + num

        # 8. Date stamp
        if enable_date:
            d = custom_date if custom_date else datetime.today()
            stamp = d.strftime(date_format)
            if date_position == "Prefix":
                stem = stamp + date_separator + stem
            else:
                stem = stem + date_separator + stamp

        # 9. Extension handling
        if ext_mode == "Remove extension":
            ext = ""
        elif ext_mode == "Change extension":
            ext = new_ext if new_ext.startswith(".") else f".{new_ext}" if new_ext else ext
        elif ext_mode == "Add extra extension":
            extra = new_ext if new_ext.startswith(".") else f".{new_ext}" if new_ext else ""
            ext = ext + extra

        new_names.append(stem + ext)
    return new_names


# ── Preview ─────────────────────────────────────────────────────────────────
st.header("👀 Preview")

new_names = apply_rules(original_names)

# Duplicate detection
duplicates = {n for n in new_names if new_names.count(n) > 1}

for old, new in zip(original_names, new_names):
    dup_tag = " ⚠️ **DUPLICATE**" if new in duplicates else ""
    changed = "🔄" if old != new else "✅"
    st.markdown(
        f"{changed}&ensp; `{old}` &nbsp;→&nbsp; **`{new}`**{dup_tag}"
    )

if duplicates:
    st.warning("⚠️ Some renamed files have identical names. Adjust your rules to avoid overwrites.")

# ── Stats ───────────────────────────────────────────────────────────────────
changed_count = sum(1 for o, n in zip(original_names, new_names) if o != n)
st.caption(f"📊 {changed_count}/{len(original_names)} file(s) will be renamed.")

# ── Download ────────────────────────────────────────────────────────────────
st.header("📥 Download")

if st.button("🚀 Generate renamed ZIP", type="primary", use_container_width=True):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for file, new_name in zip(uploaded_files, new_names):
            file.seek(0)
            zf.writestr(new_name, file.read())
    buf.seek(0)

    # Save to history
    mapping = {o: n for o, n in zip(original_names, new_names) if o != n}
    st.session_state.history.append((datetime.now().strftime("%H:%M:%S"), mapping))

    st.download_button(
        label="⬇️ Download ZIP",
        data=buf,
        file_name=f"renamed_files_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip",
        mime="application/zip",
        use_container_width=True,
    )
    st.success("✅ ZIP ready for download!")

# ── History ─────────────────────────────────────────────────────────────────
if st.session_state.history:
    with st.expander("📜 Rename History (this session)"):
        for time_stamp, mapping in reversed(st.session_state.history):
            st.markdown(f"**{time_stamp}** — {len(mapping)} file(s) renamed")
            for old, new in mapping.items():
                st.markdown(f"- `{old}` → `{new}`")
            st.divider()
