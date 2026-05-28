# Privacy Policy

**YouTube Sub Manager** is committed to protecting your privacy. This policy explains what data the extension accesses and how it is handled.

## Data Collection

**YouTube Sub Manager does not collect, transmit, or share any user data.** There are no analytics, no telemetry, no tracking pixels, and no external servers involved.

## Data Storage

All data is stored **locally in your browser** using IndexedDB. This includes:

- Your subscription list (channel names, URLs, subscriber counts)
- Enrichment data (last upload dates, video counts)
- Backup snapshots created before unsubscribe operations
- Unsubscribe logs
- Extension settings

This data never leaves your browser. It is not sent to any server, API, or third-party service.

## Network Requests

The extension makes requests **only to youtube.com**:

- `https://www.youtube.com/feed/channels` — to read your subscription list from the page
- `https://www.youtube.com/feeds/videos.xml` — to check channel activity via public RSS feeds
- `https://www.youtube.com/channel/...` — to resolve channel identifiers

These are the same pages you would visit manually in your browser. No authentication tokens, API keys, or credentials are used — the extension operates within your existing YouTube session.

## Third-Party Services

The extension does **not** communicate with any third-party services. There are:

- No API keys or OAuth tokens
- No external analytics (Google Analytics, Mixpanel, etc.)
- No crash reporting services
- No ad networks
- No data brokers

## Permissions

| Permission | Why it's needed |
|---|---|
| `activeTab` | Detect when you're on the YouTube subscriptions page |
| `storage` | Store extension settings locally |
| `unlimitedStorage` | Store large subscription lists without hitting browser quotas |
| `downloads` | Export your data as CSV or JSON files to your computer |
| `tabs` | Open and navigate to the YouTube subscriptions page |
| `scripting` | Read subscription data from the YouTube page |
| `youtube.com` | Access YouTube pages to read subscriptions and check channel activity |

## Data Deletion

You can delete all stored data at any time by:

- Clicking **Clear saved list** in the extension popup, or
- Uninstalling the extension (all IndexedDB data is removed automatically)

## Changes to This Policy

If this policy changes, the update will be published in this repository. The extension does not auto-update policies — you can always review the current version here.

## Contact

Questions or concerns? Open an issue on [GitHub](https://github.com/germainelry/youtube-sub-manager/issues).
