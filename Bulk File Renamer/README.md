# 📁 Bulk File Renamer

A powerful Streamlit-based bulk file renaming tool. Upload files via drag-and-drop, pick a renaming rule from the sidebar, preview changes instantly, and download renamed files as a ZIP.

## Features

| Feature | Description |
|---|---|
| **Find & Replace** | Simple text substitution with optional case sensitivity |
| **Regex Patterns** | Full regex support with capture groups for advanced renaming |
| **Prefix / Suffix** | Add text before or after the filename stem |
| **Sequential Numbering** | Auto-number files with configurable start, step, padding, position, and full-replace mode |
| **Date Stamp** | Add date/time stamps in multiple formats (prefix or suffix) with custom date picker |
| **Case Conversion** | lowercase, UPPERCASE, Title Case, snake_case, camelCase, kebab-case |
| **Extension Control** | Change, remove, or add extra file extensions |
| **Trim / Clean** | Remove characters from start/end, replace spaces, strip special characters |
| **Live Preview** | See old → new names in real-time before committing |
| **Duplicate Detection** | Warns when rules produce identical filenames |
| **ZIP Download** | Download all renamed files in a single ZIP archive |
| **Session History** | Track all renaming operations during the session |

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run the app
streamlit run bulk_rename.py
```

The app will open in your browser at `http://localhost:8501`.

## How It Works

1. **Upload** — Drag-and-drop or browse to select files.
2. **Select Rule** — Pick a renaming rule from the sidebar.
3. **Configure** — Set up rule parameters in the main panel.
4. **Preview** — Instantly see how every filename will change.
5. **Download** — Generate a ZIP with all files renamed.

## Examples

**Add a project prefix:**
- Rule: Prefix / Suffix → Prefix: `project_`
- `report.pdf` → `project_report.pdf`

**Sequential numbering (replace names):**
- Rule: Sequential Numbering → Replace entire filename ✓, Start: 1, Pad: 3
- `messy file.jpg` → `001.jpg`

**Regex — reorder date in filename:**
- Pattern: `^(\d{4})(\d{2})(\d{2})_(.+)`
- Replace: `\4_\1-\2-\3`
- `20250115_meeting.txt` → `meeting_2025-01-15.txt`

**Clean up filenames:**
- Rule: Trim / Clean → Replace spaces with `_`, Strip special characters ✓
- `My Cool File (Final).docx` → `My_Cool_File_Final.docx`

## License

MIT — see the root [LICENSE](../LICENSE) file.
