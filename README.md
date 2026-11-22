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

### Notes (a full word processor)
- **Fonts and sizes:** a font picker, a size box (8–72 or type any size), and **Ctrl+]** / **Ctrl+[** to make text bigger or smaller
- **Styles:** Normal, Heading 1–3, Quote, Code
- **Text formatting:** bold, italic, underline, strikethrough, superscript, subscript, **font colour** and **highlight colour** (palettes plus custom colours)
- **Alignment:** left, center, right, justify (**Ctrl+L / E / R / J**), plus **line spacing** (1.0–3.0) and indent / outdent
- **Lists:** bullets, numbering and checklists
- **Insert:** tables (Tab moves to the next cell and adds rows; add or delete rows and columns), links (**Ctrl+K**), divider lines, and the time and date (**F5**)
- **Find & replace** (**Ctrl+F** / **Ctrl+H**) with match case and whole word options
- **Undo / redo** (**Ctrl+Z** / **Ctrl+Y**)
- **Paste:** keeps the formatting from Word, or **Ctrl+Shift+V** pastes plain text
- **Layout:** **Page view** (a white sheet, like Word) or **Full width** (like Notepad). Hold Ctrl and scroll to zoom, like Notepad.
- **Status bar:** line and column (**Ln / Col**) plus the word count
- **Export:** everything above carries over to Word (.docx) and PDF

### Whiteboard
- **Tools:** select, hand, pen, highlighter, eraser, rectangle, ellipse, diamond, triangle, line, arrow, text, sticky notes and images
- **Styling:** stroke and fill colours (palettes plus custom), thickness, solid / dashed / dotted lines, arrowheads (none, one end or both ends), text size and opacity
- **Shape labels:** double-click a shape to type inside it, which makes flowcharts quick to build
- **Images:** paste with **Ctrl+V**, drag them in, or use the image tool
- **Selecting:** box-select or Shift+click several items, drag the handles to resize, and use the arrow keys to nudge
- **Editing:** **Ctrl+C / X / V / D** to copy, cut, paste and duplicate (Alt+drag duplicates too), bring to front or send to back, and a right-click menu
- **Moving around:** pan with Space or the hand tool, zoom with **Ctrl+scroll**, and **Shift+1** zooms to fit. Backgrounds: dots, grid, lines or plain.
- **Undo / redo**
- **Export:** save a PNG, or **copy the board as an image** to paste into WhatsApp, Word or email

### Notepad-style layout
- Slim **tabs** along the top, like Notepad, that shrink to fit when you open lots of documents
- A **File / Edit / View** menu bar, with Word / PDF / Copy on the same row
- A **one-row** formatting toolbar. Less-used tools are under **⋯ More**.
- Notes fill the window (**Full width**), or switch to **Page view** from the toolbar or the View menu
- A **status bar** with line and column, word and character count, date created, save status, zoom, UTF-8 and the light/dark switch
- **Ctrl+\\** hides the sidebar when you want even more room

### Everything else
- **Autosave** as you type. Your data is plain JSON files in `Documents\RedoxNotes`, so you can back up or sync the folder with OneDrive.
- **Light / dark / follow-Windows** themes.
- **Tabs** like Notepad, and the app remembers what you had open.
- A **calendar** with a dot on each day that has a report, plus **search** across everything.
- **Pin** and **duplicate** items. **Trash** keeps deleted items for 30 days.
- **Backup / restore** everything to a single file (Settings).

## Updating without losing anything

Your notes are **not stored inside the app**. They live in `Documents\RedoxNotes`, so installing a new version never touches them.

- **Installer:** download the new `RedoxNotes-x.y.z-setup.exe` and run it. It installs over the old version; you don't need to uninstall first.
- **Portable:** close the app and replace the old `.exe` with the new one.
- If you ever uninstall, `Documents\RedoxNotes` is left alone, even if you tick "delete application data".
- **Extra safety:** go to Settings → **Back up everything** to save a single backup file. You can bring it back with **Restore from backup** on any PC.

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
