<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/arhgap11b/chat-to-markdown">
    <img src="./src/assets/icon.png" alt="Logo" width="80" height="80">
  </a>

  <h3 align="center">chat-to-markdown</h3>

  <p align="center">
   Browser extension that adds download buttons to ChatGPT and Google Gemini. Save individual messages or entire conversations as Markdown files with smart naming, research workflow support, and native UI integration.
    <br />
    <br />
    <strong>Chrome • Edge • Chromium-based browsers</strong>
  </p>
</div>

## Supported platforms

| Platform | Status | Notes |
|----------|--------|-------|
| ChatGPT (`chatgpt.com`) | ✅ | Inline buttons, complete chat + file picker |
| Google Gemini (`gemini.google.com`) | ✅ | Native Material Design buttons |

## Features

- **Inline download buttons** next to every message — matches native Copy button style on each platform
- **Complete long-chat export** — reads the full active conversation branch even when ChatGPT virtualizes older messages
- **Deep Research capture** — extracts complete reports from ChatGPT's sandboxed research frame and restores them to the correct conversation turn
- **Selectable file downloads** — choose any input attachments and generated output documents to download with the Markdown context
- **Three compact export views** — export the entire chat, select individual messages, or select messages and files together in one dialog
- **Inline file groups** — attachments are grouped directly under the logical message they belong to, with group and per-file selection
- **Chat-style message picker** — select logical User/ChatGPT replies from familiar conversation bubbles; multi-part ChatGPT replies stay grouped as one answer
- **Native-feeling controls** — compact custom checkboxes and the same hover hints used by the message download buttons
- **Role-aware file discovery** — recognizes uploaded and generated files from attachments, nested references, citations, artifacts, `file-service://`, `sediment://`, sandbox paths, signed URLs, and current ChatGPT file buttons
- **Correctable direction** — every picker row can be switched between input and output before download
- **Portable Markdown + optional JSON export** — Markdown stays at the export root, JSON can be added on demand, and both use relative links to selected files
- **Clean attachment folders** — selected files are stored directly under `input/` and `output/` without an extra wrapper folder
- **Automatic ZIP packaging** — when the export contains more than two files in total, one archive preserves the complete relative folder layout
- **Live export progress** — animated loading state for full-chat retrieval and a determinate progress bar for file downloads and ZIP creation
- **"Download All" button** in the input area for full conversation export
- **Research mode** — `Ctrl/Cmd + Click` for incremental naming (`analysis_1_Title.md`, `analysis_2_Title.md`)
- **Smart file naming** — files named after conversation title, author-aware prefixes
- **Unicode support** — Cyrillic, Chinese, Arabic and other non-Latin characters preserved
- **Language-aware UI** — dialogs, progress messages, and tooltips adapt to English, Russian, and Ukrainian interfaces
- **Dark/OLED theme contrast** — the export dialog stays visually separated from ChatGPT's dimmed background
- **Cross-tab sync** — research counter shared via localStorage across all tabs
- **Markdown conversion** — Turndown + GFM for clean, readable output

### Keyboard modifiers

| Modifier | Mode | Naming |
|----------|------|--------|
| Click | Normal | `Title.md` (resets counter) |
| Ctrl/Cmd + Click | Research | `analysis_N_Title.md` (increments) |
| Shift + Click | Skip | `Title.md` (keeps counter) |

## Installation

```sh
git clone https://github.com/arhgap11b/chat-to-markdown.git
```

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer Mode**
3. Drag the `src` folder onto the extensions page

Keep the `src` folder in place — moving it breaks the extension.

## Architecture

```
src/
├── manifest.json              # Extension config (ChatGPT + Gemini entries)
├── chatgpt-export.js          # Full-conversation and attachment parsing
├── content.js                 # ChatGPT content script
├── content.css                # ChatGPT styles
├── content-gemini.js          # Gemini content script
├── content-gemini.css         # Gemini styles
├── background.js              # Service worker for file downloads
├── assets/icon.png            # Extension icon
└── vendor/
    ├── turndown.js            # HTML → Markdown
    ├── turndown-plugin-gfm.js # GFM tables, strikethrough
    ├── fflate.js              # Streaming ZIP creation
    └── fflate.LICENSE.txt     # fflate MIT license
```

Each platform has its own content script — DOM structures are completely different, so mixing them would be fragile. Turndown + GFM are shared; fflate is loaded only for ChatGPT exports.

## Credits

Based on [ChatGPT-History-Downloader](https://github.com/Luo-Yihang/ChatGPT-History-Downloader) by Luo-Yihang.

ZIP creation uses [fflate](https://github.com/101arrowz/fflate), distributed under the MIT license.

## License

MIT — see `LICENSE.txt`.
