# 📁 Bulk File Renamer

A powerful Streamlit-based bulk file renaming tool. Upload files via drag-and-drop, apply flexible renaming rules, preview changes instantly, and download renamed files as a ZIP.

## Features

| Feature | Description |
|---|---|
| **Find & Replace** | Simple text substitution with optional case sensitivity |
| **Regex Patterns** | Full regex support with capture groups for advanced renaming |
| **Prefix / Suffix** | Add text before or after the filename stem |
| **Sequential Numbering** | Auto-number files with configurable start, step, padding, and position |
| **Date Stamp** | Add date/time stamps in multiple formats (prefix or suffix) |
| **Case Conversion** | lowercase, UPPERCASE, Title Case, snake_case, camelCase, kebab-case |
| **Extension Control** | Keep, change, remove, or add extra file extensions |
| **Trim / Pad** | Remove characters from start/end, replace spaces with underscores/dashes |
| **Live Preview** | See old → new names in real-time before committing |
| **Duplicate Detection** | Warns when rules produce identical filenames |
| **ZIP Download** | Download all renamed files in a single ZIP archive |
| **Session History** | Track all renaming operations during the session |

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run the app
streamlit run app.py
```

The app will open in your browser at `http://localhost:8501`.

## How It Works

1. **Upload** — Drag-and-drop or browse to select files.
2. **Configure** — Set up renaming rules across the tabbed interface. Rules apply top-to-bottom.
3. **Preview** — Instantly see how every filename will change.
4. **Download** — Generate a ZIP with all files renamed.

## Rule Application Order

Rules are applied in this sequence:

1. Find & Replace
2. Regex substitution
3. Trim characters
4. Replace spaces
5. Case conversion
6. Prefix / Suffix
7. Sequential numbering
8. Date stamp
9. Extension handling

## Examples

**Add a project prefix + sequential numbers:**
- Prefix: `project_`
- Sequential: start=1, step=1, pad=3, position=suffix
- `report.pdf` → `project_report_001.pdf`

**Regex — extract dates from filenames:**
- Pattern: `^(\d{4})(\d{2})(\d{2})_(.+)`
- Replace: `\4_\1-\2-\3`
- `20250115_meeting.txt` → `meeting_2025-01-15.txt`

**Clean messy filenames:**
- Replace spaces with `_`
- Case: snake_case
- `My Cool File (Final).docx` → `my_cool_file_(final).docx`

## License

MIT — see the root [LICENSE](../LICENSE) file.
