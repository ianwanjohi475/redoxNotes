# Redox Notes

A fast Windows notepad for logging your work day. It turns what you type into
properly formatted daily, weekly and monthly reports you can export to Word.

**Download:** go to [Releases](../../releases/latest) and get
`RedoxNotes-x.y.z-setup.exe` (installer) or `RedoxNotes-x.y.z-portable.exe` (single file, no install).

## What it does

### Dashboard
The home screen shows how your week is going at a glance:
- **Entries logged this week**, compared with last week
- Cards for **this month**, **today** and your **streak**
- Widgets for **metrics this week**, **entries per day**, **team deployment** (completion rates), **last 30 days**, **blockers** and **recent notes**

### Daily reports
- **Ctrl+D** opens today's report. It is created automatically and dated for you.
- **Quick log:** type what you just did and press **Enter**. It is filed under the current time.
- **Time blocks** (e.g. *8AM TO 8:20AM*). Write one activity per line:
  - `INCIDENT LOG - went through pending incidents` gives you a **bold label** followed by the text
  - indent with **Tab** or start a line with `-` to make a sub-point, or start it with `1.` for a numbered sub-point
- **Field stats** (installations, LOS, pending incidents…) and **team deployment** with completion rates worked out for you.
- **Blockers**, **next day's plan**, plus **Submitted by** and **Submitted to** lines (set your supervisor once in Settings).
- Live summary cards at the top of each report: entries, top metric and team completion.
- Yesterday's plan is carried over to today, along with your metrics and team names.
- **Export:** Word (.docx), PDF/print, or **Copy text** to paste into WhatsApp or email.

### Weekly / monthly reports (Ctrl+R)
Pick a period (this week, last week, this month…) and get one document with
totals for every metric, team performance, the blockers you hit and the full
daily log. You can export it to Word or PDF, or copy it as text.

### Notes
Rich text with headings, bold, italic, underline, strikethrough, highlight, bullet and numbered lists,
checklists, quotes and dividers. Press **F5** to insert the time and date, like Notepad.
Notes export to Word, PDF or .txt.

### Whiteboard
Pen, highlighter, lines, arrows, rectangles, ellipses, text, sticky notes and an eraser.
You can also select and move items, zoom, pan, undo and redo. Boards export to PNG.

### Everything else
- **Autosave** as you type. Your data is plain JSON files in `Documents\RedoxNotes`, so you can back up or sync the folder with OneDrive.
- **Light / dark / follow-Windows** themes.
- **Tabs** like Notepad, and the app remembers what you had open.
- A **calendar** with a dot on each day that has a report, plus **search** across everything.
- **Pin** and **duplicate** items. **Trash** keeps deleted items for 30 days.
- **Backup / restore** everything to a single file (Settings).

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Ctrl+D | Today's report |
| Ctrl+N / Ctrl+Shift+N | New note / new whiteboard |
| Ctrl+R | Weekly / monthly report |
| Ctrl+E | Export to Word |
| Ctrl+P | Print / save as PDF |
| Ctrl+Shift+C | Copy as text |
| F5 | Insert time (and date) |
| Ctrl+F | Search |
| Ctrl+W, Ctrl+Tab | Close tab, next tab |
| Ctrl+Shift+L | Toggle dark / light |
| Ctrl+= / Ctrl+- | Bigger / smaller text |
| Ctrl+/ | All shortcuts |

## Building it yourself

The app is built with [Tauri 2](https://tauri.app): a small Rust shell around plain HTML, CSS and JavaScript in `src/`, with no web framework.
The `.exe` is a few MB and starts almost instantly because it uses the WebView2 runtime that ships with Windows 10 and 11.

```bash
npm install
npx tauri dev     # run with live reload
npx tauri build   # produce the .exe + installer
```

Pushing to GitHub builds the Windows `.exe` automatically (`.github/workflows/release.yml`)
and publishes it to Releases as `v<version>`. The version comes from `src-tauri/tauri.conf.json`.
To ship a new release, bump that version (and the one in `src-tauri/Cargo.toml`) and push.
