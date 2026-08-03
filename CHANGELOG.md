# Changelog

All notable changes to this project will be documented in this file.

## [0.40] - 2026-08-03

### Added
- One export dialog with three small view icons: entire chat, selected messages, and selected messages with files
- Chat-style message and file selection in the same scrollable view
- Optional JSON sidecar, disabled by default
- Context-aware message previews, using ChatGPT navigator labels when available and generated first/last-sentence summaries otherwise
- Files from the same logical message are grouped directly beneath that chat bubble

### Changed
- Markdown always keeps the chronological User/ChatGPT conversation layout
- Consecutive internal ChatGPT messages are grouped as one logical reply in the picker and Markdown
- The default entire-chat view shows no message or file selection lists
- Message previews discard attachment labels and download links instead of repeating filenames
- Export controls now use compact custom checkboxes and the same hover hints as the existing download buttons

## [0.39] - 2026-08-03

### Fixed
- Sandbox links with balanced parentheses in filenames are no longer truncated at the first `)`
- Incomplete sandbox-path duplicates are removed when a complete path is detected for the same message
- A failed ChatGPT file download no longer aborts the complete archive

### Added
- Partial ZIP exports include `download-errors.json` describing files that ChatGPT could not provide

## [0.38] - 2026-08-03

### Changed
- Reworked the progress toast and export-dialog accents to match ChatGPT's neutral monochrome surfaces, typography, borders, and controls
- Removed the green glow, decorative gradient, shimmer, and oversized progress treatment

## [0.37] - 2026-08-03

### Added
- Structured JSON sidecar with ordered messages, author roles, message relationships, timestamps, and selected-file links

### Changed
- Markdown and JSON are stored at the export root while attachments are placed directly in `input/` and `output/`
- ZIP threshold now counts both context documents together with selected attachments

## [0.36] - 2026-08-03

### Added
- Animated export preloader while the complete conversation is being retrieved
- Determinate progress bar with percentage and file count during separate downloads and ZIP creation
- Localized Russian, Ukrainian, and English progress messages
- Reduced-motion-aware progress animations

## [0.35] - 2026-08-03

### Fixed
- Input/output classification now follows file origin and message role instead of file extension
- Detects nested file metadata, citations, generated artifacts, raw sandbox paths, signed file URLs, and `sediment://` asset pointers
- Detects current ChatGPT `behavior-btn` output-file controls that do not expose an `href`
- De-duplicates assistant citations that point back to user uploads instead of misclassifying them as generated output

### Added
- Per-file input/output selector in the download dialog for manual correction
- Page-button download fallback with routing into the selected export folder when ChatGPT omits the underlying file reference from its API response

## [0.34] - 2026-08-03

### Added
- Ukrainian export dialog, progress messages, tooltips, and localized single-message filenames
- Automatic ZIP packaging when the main Markdown plus selected files total more than two files
- Streaming ZIP generation with `fflate` 0.8.3 while preserving the existing relative `input`/`output` folder layout

### Changed
- Exports with zero or one selected attachment keep the existing separate Markdown and file-folder downloads

## [0.33] - 2026-08-03

### Added
- File picker for downloading any combination of input attachments and generated output files
- Support for both ChatGPT file-service downloads and Code Interpreter sandbox artifacts
- Paginated conversation API fallback for newer ChatGPT deployments
- Relative links from the exported Markdown to selected files stored in per-export `input` and `output` folders
- DOM fallback discovery for direct ChatGPT and `oaiusercontent.com` download links

### Fixed
- Full-chat export now requests the complete active conversation branch instead of exporting only the messages currently mounted in ChatGPT's virtualized DOM
- Long conversations no longer produce a truncated Markdown file
- Authenticated ChatGPT API calls now include the current Bearer token and workspace account header
- ChatGPT export styles are now re-injected programmatically after extension/page reloads to avoid unstyled status and picker UI
- Russian, Ukrainian, and Belarusian ChatGPT interfaces use the localized export dialog

### Technical
- Added pure conversation parsing and file discovery helpers with Node-based regression tests
- Moved multi-file downloads through the extension service worker and Chrome downloads API

## [2025.10.14-04] - 2025-10-14

### Added
- **Research Mode** - Hold Ctrl/Cmd while clicking download to enable incremental naming
  - ChatGPT messages: `analysis_1_Title.md`, `analysis_2_Title.md`, etc.
  - User messages: `request_Title.md` (no increment)
  - Counter syncs across all tabs via localStorage
- **Keyboard Shortcuts**:
  - Ctrl/Cmd + Click: Research mode (incremental naming)
  - Shift + Click: Skip mode (normal naming, counter not reset)
  - Regular Click: Normal mode (resets counter)
- **Unicode Filename Support** - Cyrillic, Chinese, and other non-Latin characters now preserved in filenames
- **Language-Aware Tooltips** - Interface adapts to ChatGPT language (English/Russian supported)
- **Smart Button Placement** - "Download All" button automatically repositions when voice mode button appears
- Custom tooltips matching ChatGPT's native tooltip style

### Changed
- **File Naming System Overhaul**:
  - Now uses conversation title instead of generic timestamps
  - ChatGPT messages: `{Title}.md` (normal), `analysis_N_{Title}.md` (research mode)
  - User messages: `request_{Title}.md` / `запрос_{Title}.md`
  - Full conversation: `{Title}.md`
  - Removed `ChatGPT_`, `message_`, `conversation_` prefixes
  - Removed timestamps from filenames
- Filename sanitization now allows Unicode characters (only removes filesystem-illegal characters: `< > : " / \ | ? *`)
- "Download All" button now uses `composer-btn` class for consistent styling with other toolbar buttons

### Fixed
- Russian and other Cyrillic text in conversation titles now properly saved in filenames
- "Download All" button no longer disappears when switching between tabs
- Button positioning now works correctly across different ChatGPT interface states
- Tooltips appear immediately on hover without delay
- Voice mode button detection now language-independent (uses `data-testid` instead of `aria-label`)

### Technical
- Added localStorage-based research counter with cross-tab synchronization
- Improved button insertion logic with primary/secondary/fallback paths
- Enhanced language detection (HTML lang attribute + button text analysis)
- Implemented dynamic button relocation when better container becomes available

---

## Previous Versions

See git history for changes prior to this fork's enhanced inline button implementation.
