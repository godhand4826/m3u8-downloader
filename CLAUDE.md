# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Chrome Manifest V3 browser extension that detects HLS (m3u8) video streams from network requests and downloads them as `.ts` files using the File System Access API. No build pipeline — load directly as an unpacked extension.

**Installation for development:**

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this directory

After editing any file, click the reload icon on the extension card in `chrome://extensions/`.

## Architecture

Three components communicate via `chrome.runtime.sendMessage` and port connections:

### background.js (Service Worker)

- Detects m3u8 URLs via two hooks: `onBeforeRequest` (URL pattern `/\.m3u8(\?|#|$)/i`) and `onHeadersReceived` (Content-Type containing `mpegurl` or `m3u8`)
- Stores detected streams in `tabStreams: Map<tabId, Set<url>>`
- Sets a single `declarativeNetRequest` session rule (ID: 9001) to spoof `Referer`/`Origin` headers for extension-origin fetch requests
- Tracks open taskManager tabs via `chrome.runtime.onConnect()` (port name: `'taskManager-page'`) to prevent duplicate instances

### popup.html / popup.js

- Queries background for streams on the active tab
- Each detected stream has an "Add Download" button that calls `openTaskManagerPage(url, pageUrl)`, which opens/focuses `taskManager.html` and sends a `NEW_TASK` message if the tab already exists, or opens a new tab with `?src=` query params

### taskManager.html / taskManager.js

- Receives stream URLs from popup (via `NEW_TASK` message or `?src=` URL param), manages a `tasks: Map<id, TaskObject>` in memory
- Task lifecycle: `queued → parsing → downloading → done/failed/cancelled`
- Max 1 concurrent download (`maxConcurrent = 1`), but fetches up to 6 segments in parallel per task
- Segments are fetched concurrently but written to file in strict order using a `pending: Map<index, data>` buffer

## Key Implementation Details

**M3U8 Parsing (`parseM3U8Text` in taskManager.js):** Handles both master playlists (`#EXT-X-STREAM-INF` → returns variant list for user selection) and media playlists (returns segment array with optional `keyUri`/`iv` per segment).

**AES-128-CBC Decryption:** Keys are fetched once and cached in a `keyCache: Map<uri, CryptoKey>`. IV defaults to the segment's media sequence number (padded to 16 bytes) when not explicitly provided.

**File Writing:** Uses `FileSystemFileHandle.createWritable()` with `keepExistingData: false`. Segments are appended sequentially; the writable stream is closed only after all segments complete.

**Referer spoofing:** A single `declarativeNetRequest` session rule is rewritten on each download start. It applies to `xmlhttprequest`, `media`, and `other` resource types from extension origin.

**Tab deduplication:** When a second taskManager tab opens, `background.js` sends `{ type: 'INIT', hasOtherTabs: true }` and the new tab redirects to the existing one to prevent task state conflicts.

## UI / Styling

Both HTML files use embedded CSS with a dark theme (bg: `#0B0F14`, accent: `#2DD4BF`) and CSS custom properties. No external frameworks or preprocessors.
