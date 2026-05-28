# Architecture

## Overview

YouTube Sub Manager is a Chrome Manifest V3 extension with four runtime contexts:

1. **Popup** — small toolbar popup for triggering scans, enrichment, exports
2. **Dashboard** — full-page React app for filtering, sorting, selecting, and unsubscribing
3. **Service Worker** — background orchestrator for message routing, tab management, and persistence
4. **Content Script** — injected into youtube.com for all DOM interaction and network requests

All DOM interaction and long-running work lives in the content script because MV3 service workers terminate after 30 seconds of inactivity. A long-lived `chrome.runtime.connect` port from the content script keeps the service worker alive during extraction, enrichment, and unsubscribe runs.

## Architecture Diagram

```
Popup                                Dashboard (React)
  |                                       |
  | chrome.runtime messages               | chrome.runtime messages
  v                                       v
Service Worker (orchestrator, message hub, tab management)
  |                                |
  | IndexedDB (Dexie)              | chrome.tabs.sendMessage
  |  +- channels                   v
  |  +- extractions          Content Script (youtube.com)
  |  +- settings               +- Extract: auto-scroll + parse channel cards
  |  +- backups                +- Enrich: fetch channel pages + RSS feeds
  |  +- unsubLog               +- Unsubscribe: DOM automation + captcha detection
  |
  +- chrome.downloads (CSV / JSON export)
```

The dashboard opens as a separate extension page (`dashboard.html`) and communicates with the service worker via the same message protocol as the popup.

## Component Responsibilities

### Service Worker (`src/background/service-worker.ts`)

Central orchestrator and message hub.

- **Message routing**: receives messages from popup and dashboard, forwards commands to the content script, relays progress back to the UI
- **Tab management**: finds or opens the YouTube subscriptions feed (`/feed/channels`), waits for tab to fully load
- **Content script injection**: pings the content script to check if it's alive; re-injects via `chrome.scripting.executeScript` if missing (handles extension reload while YouTube is already open)
- **Keepalive listener**: listens for `chrome.runtime.connect` on the keepalive port; port disconnect during an operation triggers error handling and cleanup
- **Database writes**: persists extraction runs, enrichment results, unsubscribe logs, and backups to IndexedDB via Dexie
- **Export**: reads all channels from the database and triggers CSV/JSON downloads via `chrome.downloads`
- **Unsubscribe orchestration**: caps batches at 200 channels, queues overflow for the next run, creates a full backup before dispatching any batch

Key state variables: `currentRunId`, `currentProgress`, `currentExtractTabId` (extraction); `currentEnrichProgress` (enrichment); `unsubRunning`, `unsubProgress`, `unsubBatchId`, `unsubTabId`, `unsubOverflow` (unsubscribe).

### Content Script Entry (`src/content/content.ts`)

Message listener injected at `document_idle` on all youtube.com pages.

- Dispatches incoming messages to `runExtraction()`, `runEnrichment()`, or `runUnsubBatch()`
- Opens a keepalive port (`chrome.runtime.connect`) at the start of each long-running operation
- Maintains running-state flags (`extractRunning`, `enrichRunning`, `unsubRunning`) to prevent concurrent operations
- Throttles extraction progress emissions to 400ms minimum intervals to avoid overwhelming the popup UI
- Catches all errors and forwards them to the service worker via messages

### Extraction (`src/content/extractor.ts`)

Parses YouTube subscription feed channel cards.

- Calls `autoScrollSubscriptionsFeed()` to load all channel cards into the DOM
- Parses each `ytd-channel-renderer` card: channel name, URL, channelId, avatar, subscriber count, description
- **Subscriber count parsing**: handles K/M/B suffixes and comma-separated numbers; tries multiple selectors (`#subscribers`, `#video-count`, `#metadata`, `#metadata-line`); falls back to `aria-label` parsing
- Emits progress in 50-channel batches via message to the service worker
- Deduplicates channels by `channelId` using a Set
- Supports `AbortSignal` for cancellation from the popup

### Scrolling (`src/content/scroll.ts`)

Adaptive infinite-scroll algorithm for loading all subscription cards.

- Scrolls to page bottom every 1.5 seconds
- **Target detection**: extracts expected subscription count from document title format `(NNN)`
- **Stall detection**: if channel card count plateaus for 10 consecutive iterations with no loading spinner visible, assumes all cards are loaded
- **Extended threshold**: when significantly under the target count (< 98%), requires 24 stable iterations before stopping
- **Nudge recovery**: after 3+ stalls, scrolls up 600-1600px to unstick YouTube's lazy loading
- **Spinner detection**: checks for `ytd-continuation-item-renderer` and `paper-spinner` elements
- Safety limits: max 1200 scroll iterations, max 40 iterations with no new cards
- Supports `AbortSignal` for cancellation

### Enrichment (`src/content/enrich.ts`)

Resolves channel handles and fetches upload history via RSS feeds.

- **4 parallel async workers** consuming from a shared cursor
- Per-channel jittered delay: 150-350ms between requests to avoid rate limiting
- **Handle resolution**: fetches channel page HTML, extracts canonical UCID from `/channel/UC...` path via regex
- **RSS feed**: fetches `/feeds/videos.xml?channel_id=UCID`, parses Atom XML for latest `<published>` date and `<entry>` count
- 10-second fetch timeout per request
- Results batched in groups of 25 before sending to the service worker
- **7-day TTL** (`ENRICHMENT_TTL_MS`): channels enriched within 7 days are skipped on subsequent runs
- Per-channel status: `ok` (has uploads), `no-uploads` (feed exists but empty), `unreachable` (fetch failed)
- Shows a floating progress overlay on the YouTube page during enrichment

### Unsubscribe (`src/content/unsubscribe.ts`)

DOM automation for bulk unsubscribing with multiple safety mechanisms.

**Per-channel sequence (9 steps):**
1. Find channel card by matching `channelId` in the card's link `href`
2. Scroll card into view
3. Click the "Subscribed" button (tries 5 selector strategies for YouTube UI version compatibility)
4. Wait for the dropdown menu to appear (3-second timeout)
5. Find and click the "Unsubscribe" menu item
6. Wait for the confirmation dialog (3-second timeout)
7. Check for CAPTCHA before clicking confirm
8. Click the confirm button
9. Wait for the button state to flip from "Subscribed" to "Subscribe" (5-second timeout)

**Safety mechanisms:**
- **Captcha detection**: scans `document.body.textContent` for 5 CAPTCHA hint phrases ("verify that you're not a robot", "unusual activity", "recaptcha", etc.); halts immediately if found
- **Consecutive-error halt**: 2 non-ok outcomes in a row stops the entire batch
- **Timing jitter**: 1.5-second base delay +/- 0.5 seconds random jitter between channels; 5-10 second break every 50 successful unsubscribes
- **Batch cap**: 200 channels per run; overflow is queued in the service worker for the next run
- **Backup**: full channel snapshot saved to IndexedDB `backups` table before any clicks begin
- **Cancel support**: `shouldCancel` callback checked between each channel

**Outcome types**: `ok` (button flipped), `already-unsubbed` (card already shows "Subscribe"), `unreachable` (no button found), `error` (menu/dialog didn't appear), `halted` (CAPTCHA or consecutive errors)

### Selectors (`src/content/selectors.ts`)

Single source of truth for all YouTube DOM selectors.

```
SELECTORS = {
  channelCard:            'ytd-channel-renderer'
  channelName:            '#text-container yt-formatted-string#text, #info-section ...'
  channelLink:            'a#main-link'
  channelAvatar:          'img#img'
  subscriberCount:        '#subscribers'
  description:            '#description'
  notificationButton:     'ytd-subscription-notification-toggle-button-renderer-next button'
  subscribeButton:        'ytd-subscribe-button-renderer button, tp-yt-paper-button#...'
  unsubscribeConfirmButton: 'tp-yt-paper-button#confirm-button, yt-button-renderer#...'
}

URLS = {
  subscriptionsFeed:      'https://www.youtube.com/feed/channels'
}
```

When YouTube ships a redesign, this is the only file that needs updating. The unsubscribe module has additional fallback selectors inline (5 strategies for the subscribe button, 7 for menu items, multiple for the confirm dialog) to handle YouTube A/B testing different UI versions.

### Progress Overlay (`src/content/progress-overlay.ts`)

Floating UI element injected into the YouTube page during extract/enrich/unsub operations. Shows a progress counter and status text; auto-removes after 6 seconds on completion or error.

## Database Schema

Database name: `yt-subscription-cleanup` (IndexedDB via Dexie)  
Current schema version: 3

### `channels` table

Primary key: `channelId`

| Field | Type | Indexed | Notes |
|---|---|---|---|
| channelId | string | PK | `@handle` or UCID extracted from URL |
| name | string | yes | Display name |
| url | string | | Full YouTube channel URL |
| avatarUrl | string? | | Thumbnail URL |
| subscriberCountText | string? | | Raw text, e.g. "1.2M subscribers" |
| subscriberCountRaw | number? | yes | Parsed numeric value |
| description | string? | | Channel description |
| extractedAt | number | yes | Timestamp of extraction |
| resolvedUcid | string? | | `UC...` ID resolved from handle |
| lastUploadAt | number? | yes | From RSS feed, epoch ms |
| videoCount | number? | | From RSS feed entry count |
| enrichedAt | number? | | When last enriched |
| enrichmentStatus | string? | yes | `pending` / `ok` / `no-uploads` / `unreachable` |
| pendingUnsub | boolean? | yes | Marked for unsubscribe |
| unsubscribedAt | number? | yes | When successfully unsubscribed |

### `extractions` table

Primary key: `++id` (auto-increment)

| Field | Type | Indexed |
|---|---|---|
| id | number | PK |
| startedAt | number | yes |
| completedAt | number? | yes |
| channelCount | number | |
| status | string | yes |
| errorMessage | string? | |

### `settings` table

Primary key: `key`

| Field | Type |
|---|---|
| key | string (PK) |
| value | unknown |

### `backups` table

Primary key: `++id` (auto-increment)

| Field | Type | Indexed |
|---|---|---|
| id | number | PK |
| createdAt | number | yes |
| channelCount | number | |
| plannedUnsubIds | string[] | |
| payload | Channel[] | |

### `unsubLog` table

Primary key: `++id` (auto-increment)

| Field | Type | Indexed |
|---|---|---|
| id | number | PK |
| batchId | string | yes |
| channelId | string | yes |
| channelName | string? | |
| outcome | string | yes |
| detail | string? | |
| attemptedAt | number | yes |

## Message Protocol

All messages are a typed discriminated union defined in `src/shared/messages.ts`. Communication flows through `chrome.runtime.sendMessage` (content/popup/dashboard to service worker) and `chrome.tabs.sendMessage` (service worker to content script).

### Extraction messages
| Message | Direction | Payload |
|---|---|---|
| `extract:start` | popup -> SW -> content | none |
| `extract:progress` | content -> SW -> popup | `{ channels: Channel[], progress: ExtractionProgress }` |
| `extract:complete` | content -> SW -> popup | `{ total, runId?, durationMs }` |
| `extract:error` | content -> SW -> popup | `{ message }` |
| `extract:cancel` | popup -> SW -> content | none |
| `extract:status` | popup -> SW | none |
| `extract:status:reply` | SW -> popup | `{ running, progress? }` |

### Enrichment messages
| Message | Direction | Payload |
|---|---|---|
| `enrich:start` | popup -> SW | none |
| `enrich:run` | SW -> content | `{ targets: EnrichmentTarget[] }` |
| `enrich:progress` | content -> SW -> popup | `{ results: EnrichmentResult[], progress: EnrichmentProgress }` |
| `enrich:complete` | content -> SW -> popup | `{ progress, durationMs }` |
| `enrich:error` | content -> SW -> popup | `{ message }` |
| `enrich:status` | popup -> SW | none |
| `enrich:status:reply` | SW -> popup | `{ running, progress?, pendingCount }` |

### Unsubscribe messages
| Message | Direction | Payload |
|---|---|---|
| `unsub:start` | dashboard -> SW | `{ channelIds: string[] }` |
| `unsub:batch` | SW -> content | `{ batchId, targets: UnsubTarget[] }` |
| `unsub:progress` | content -> SW -> dashboard | `{ result?: UnsubResult, progress: UnsubProgress }` |
| `unsub:complete` | content -> SW -> dashboard | `{ progress, durationMs, remaining: string[] }` |
| `unsub:error` | content -> SW -> dashboard | `{ message }` |
| `unsub:cancel` | dashboard -> SW -> content | none |
| `unsub:status` | dashboard -> SW | none |
| `unsub:status:reply` | SW -> dashboard | `{ running, progress? }` |

### Utility messages
| Message | Direction | Payload |
|---|---|---|
| `dashboard:open` | popup -> SW | none |
| `export:csv` | popup -> SW | none |
| `export:json` | popup -> SW | none |
| `ping` | SW -> content | none (expects `{ ok: true }`) |

### Keepalive Port

Port name constant: `KEEPALIVE_PORT = 'yt-cleanup-keepalive'` (defined in `src/shared/messages.ts`)

The content script opens a `chrome.runtime.connect({ name: KEEPALIVE_PORT })` port at the start of each long-running operation. The service worker's `onDisconnect` listener detects when the YouTube tab closes mid-operation and triggers cleanup.

## MV3 Keep-Alive Strategy

MV3 service workers terminate after 30 seconds of inactivity. This extension keeps the service worker alive during long operations using a persistent `chrome.runtime.connect` port:

1. Content script opens port before starting extraction/enrichment/unsubscribe
2. Service worker's `onConnect` listener receives the port
3. Port stays open for the duration of the operation
4. If the YouTube tab closes, `onDisconnect` fires and the service worker handles the interrupted operation (marks extraction as failed, logs partial unsubscribe results, etc.)

The service worker also uses `sendToTabWithRetry()` with exponential backoff (4 attempts, 600ms * attempt delay) to handle cases where the content script isn't immediately responsive after tab load.

## Dashboard UI

Full-page React app at `src/dashboard/dashboard.html`, opened from the popup via `dashboard:open` message.

- **Virtualized table**: uses `@tanstack/react-virtual` with 56px row height and 10-item overscan for smooth scrolling at any list size
- **Filters**: real-time text search (name + description), staleness presets (Any / 3mo / 6mo / 1y / 2y / 3y / 5y), custom day input, "only show channels with upload dates" toggle
- **Sort**: last upload / name / subscriber count, ascending or descending; undefined values sorted to the end
- **Selection**: per-row checkbox, "select all filtered" with bulk confirmation when selecting > 100 channels, clear selection
- **Unsubscribe flow**: "Type UNSUB" confirmation dialog showing channel list preview and estimated time (5.5 sec/channel), real-time progress bar during execution, cancel button, completion summary with overflow count
- **Auto-refresh**: refreshes channel data when the dashboard tab regains focus

Components: `App.tsx` (orchestrator), `ChannelTable.tsx` (virtualized rows), `SelectionBar.tsx` (bulk actions), `ConfirmDialog.tsx` (type-UNSUB modal), `filter.ts` (filter/sort logic with relative date formatting).

## Popup UI

Small toolbar popup at `src/popup/popup.html`.

- **Actions**: Scan my subscriptions, Check for activity (enrichment), Export CSV/JSON, Open Dashboard, Clear saved list
- **Tab context detection**: shows different footer hints depending on whether the current tab is the subscriptions page, another YouTube page, or a non-YouTube tab
- **Progress bars**: real-time progress display for extraction and enrichment with cancel buttons
- **Toast notifications**: success/error feedback that auto-dismiss
- **State machines**: extract state (`idle` / `extracting` / `complete` / `error`), enrich state (`idle` / `enriching` / `complete` / `error`)

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Extract & export (CSV, JSON) | Done |
| 2 | Channel enrichment via RSS feeds | Done |
| 3 | Dashboard with search, sort, staleness filters, multi-select | Done |
| 4 | Bulk unsubscribe with backups, captcha detection, audit log | Done |
| 5 | Edge cases, onboarding, Chrome Web Store listing | Next |
