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
| ChatGPT (`chatgpt.com`) | ✅ | Inline buttons, Download All |
| Google Gemini (`gemini.google.com`) | ✅ | Native Material Design buttons |

## Features

- **Inline download buttons** next to every message — matches native Copy button style on each platform
- **"Download All" button** in the input area for full conversation export
- **Research mode** — `Ctrl/Cmd + Click` for incremental naming (`analysis_1_Title.md`, `analysis_2_Title.md`)
- **Smart file naming** — files named after conversation title, author-aware prefixes
- **Unicode support** — Cyrillic, Chinese, Arabic and other non-Latin characters preserved
- **Language-aware UI** — tooltips adapt to English/Russian interface
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
├── content.js                 # ChatGPT content script
├── content.css                # ChatGPT styles
├── content-gemini.js          # Gemini content script
├── content-gemini.css         # Gemini styles
├── background.js              # Service worker
├── assets/icon.png            # Extension icon
└── vendor/
    ├── turndown.js            # HTML → Markdown
    └── turndown-plugin-gfm.js # GFM tables, strikethrough
```

Each platform has its own content script — DOM structures are completely different, so mixing them would be fragile. Vendor libs (Turndown + GFM) are shared.

## Credits

Based on [ChatGPT-History-Downloader](https://github.com/Luo-Yihang/ChatGPT-History-Downloader) by Luo-Yihang.

## License

MIT — see `LICENSE.txt`.
