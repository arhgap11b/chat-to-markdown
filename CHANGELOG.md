# Changelog

All notable changes to this project will be documented in this file.

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
