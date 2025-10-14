<!-- PROJECT LOGO -->
<br />
<div align="center">
  <a href="https://github.com/yourusername/chatgpt-downloader">
    <img src="./src/assets/icon.png" alt="Logo" width="80" height="80">
  </a>

  <h3 align="center">ChatGPT History Downloader (Enhanced Research Fork)</h3>

  <p align="center">
   A powerful browser extension for downloading ChatGPT conversations with advanced research workflow support. Save individual messages or entire conversations as Markdown files with smart naming, Unicode support, and cross-tab synchronization. Perfect for researchers, developers, and power users who need organized AI conversation archives.
    <br />
    <br />
    <strong>Chrome • Edge • Chromium-based browsers</strong>
  </p>
</div>

## What's new in this fork?

- **Inline download buttons** appear next to every ChatGPT message, mirroring the built-in copy action
- **"Download All" button** positioned next to the voice mode button for easy access
- **Research mode** - Hold Ctrl/Cmd while clicking to download with incremental naming (`analysis_1_Title.md`, `analysis_2_Title.md`, etc.)
- **Smart file naming** - Files use conversation title instead of generic timestamps
- **Unicode support** - Russian, Chinese, and other non-Latin characters preserved in filenames
- **Language-aware tooltips** - Interface adapts to your ChatGPT language (English/Russian)
- **Cross-tab sync** - Research counter syncs via localStorage across all ChatGPT tabs
- Single-message downloads now include Deep Research results and any other multi-part answers rendered within the same turn
- Popup UI was removed to streamline the extension; everything happens directly inside the chat interface

### Keyboard Shortcuts

- **Ctrl/Cmd + Click** - Research mode (incremental naming: `analysis_1_Title.md`, `analysis_2_Title.md`)
- **Shift + Click** - Skip mode (normal naming but doesn't reset research counter)
- **Regular Click** - Normal mode (resets research counter)

## Installation

### Chrome / Edge / Chromium-based browsers
1. Clone or download this repository:
   ```sh
   git clone https://github.com/yourusername/chatgpt-downloader
   ```
2. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Or click the Extensions icon → Manage Extensions
3. Enable **Developer Mode** (toggle in top-right corner)
4. Drag the `src` folder from this repo onto the extensions page
5. The extension is now installed and active on ChatGPT pages

**Important**: Keep the `src` folder in place after installation. Moving or deleting it will break the extension.

## Usage

The extension works seamlessly inside the ChatGPT interface with **no popup UI** required:

### Download Individual Messages
- **Download buttons** appear next to every ChatGPT message (next to the Copy button)
- **Regular click**: Download with conversation title as filename
- **Ctrl/Cmd + Click**: Research mode - incremental naming (`analysis_1_Title.md`, `analysis_2_Title.md`)
- **Shift + Click**: Skip mode - normal naming but doesn't reset counter

### Download Entire Conversation
- **"Download All" button** appears in the toolbar (next to voice mode button)
- Saves complete conversation with all messages and formatting

## Features

### Smart File Naming
- **Conversation-based naming**: Files named after conversation title, not generic timestamps
- **Author-aware prefixes**: User messages → `request_Title.md`, ChatGPT → `Title.md` or `analysis_N_Title.md`
- **Unicode support**: Preserves Cyrillic, Chinese, Arabic, and other non-Latin characters in filenames
- **Filesystem-safe**: Only removes illegal characters (`< > : " / \ | ? *`)

### Research Workflow
- **Incremental naming**: Hold Ctrl/Cmd while downloading for `analysis_1`, `analysis_2`, etc.
- **Cross-tab synchronization**: Research counter syncs via localStorage across all ChatGPT tabs
- **Skip mode**: Shift + Click to download without resetting counter
- **Multi-sampling friendly**: Perfect for parallel research and A/B testing AI responses

### User Experience
- **Inline integration**: Download buttons mirror ChatGPT's native Copy button design
- **Language-aware tooltips**: Automatically adapts to English/Russian interface
- **Instant tooltips**: No delay, matching ChatGPT's native tooltip behavior
- **Smart button placement**: "Download All" button dynamically positions next to voice mode button

### Technical
- **Markdown conversion**: Built on Turndown with GFM (GitHub Flavored Markdown) support
- **Deep Research support**: Multi-part messages captured as single file
- **Minimal permissions**: Only requires `activeTab`, `downloads`, `scripting`
- **No popup UI**: Everything happens directly in chat interface

## Sample Markdown Output
```
**User**: Hi! How are you?

--------
**ChatGPT**: Hello! As an AI language model, I don't have feelings like humans do, but I'm here to help you with any questions or tasks you have. How can I assist you today?

--------
**User**: Can you analyze this image? ![Image](image_2_0.png)

--------
**ChatGPT**: I can see the image you've shared. It appears to be...
```

## Credits

This fork is based on [ChatGPT-History-Downloader](https://github.com/Luo-Yihang/ChatGPT-History-Downloader) by Luo-Yihang, with significant enhancements for research workflows, Unicode support, and user experience improvements.

## License

Distributed under the MIT License. See `LICENSE.txt` for more information.
