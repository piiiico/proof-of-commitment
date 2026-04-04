# Commit — Chrome Extension

See real trust signals. Contribute your behavioral data — anonymously, verified by World ID.

**Status:** v0.2 — site-contextual trust UI, contributing toggle, content script trust badge. Installable for sideloading.

---

## Install in 5 minutes

### Step 1: Build

```bash
git clone https://github.com/hawkaa/proof-of-commitment
cd proof-of-commitment
bun install
bun run build:ext
```

### Step 2: Load in Chrome

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked** → select `dist/extension/`

The extension appears in your toolbar. Click it on any website to see trust data.

### Step 3: World ID verification (optional)

The extension works without World ID — it tracks time locally and shows network trust data. To contribute your data to the trust network, verify with World ID.

**Extension ID:** `iiomogkajkfbbpmicbfdgdojfmlbpnhn`
**Redirect URI:** `https://iiomogkajkfbbpmicbfdgdojfmlbpnhn.chromiumapp.org/callback`

World ID app_id is pre-configured. You just need a [World App](https://worldcoin.org/download) on your phone.

---

## What it does

### Popup (site-contextual)
- **Trust signals** for the current domain: verified visitors, repeat rate, avg engagement time
- **Your commitment** to this site: time spent, visits, since when
- **Contributing toggle**: control whether your data syncs to the network
- **Brreg lookup**: Norwegian business registry data for .no domains (expandable)
- **Trust score ring**: composite score from visitor density, repeat rate, and engagement

### Content script
- **Trust badge**: small floating pill (bottom-right) on pages with commitment data
- Shows verified visitor count, color-coded by trust level
- Dismissible with a click

### Background
- **Time tracking**: passive per-domain tracking (no URLs, no paths)
- **Sync queue**: batched 5-minute syncs to backend (respects contributing toggle)
- **Offline safe**: queues data when backend is unreachable

---

## Privacy

- **Local first**: all visit data stored in `chrome.storage.local`
- **Contributing toggle**: you control when data leaves your browser
- **Domain-level only**: no URLs, paths, or page content
- **World ID**: app-scoped sub identifier; no biometrics stored locally
- **Sync data**: only domain + visit count + time; no user identity in payload

---

## Development

```bash
bun install
bun run build:ext    # build once
bun run dev:ext      # watch mode
```

Source files:
- `src/extension/background.ts` — service worker, time tracking, sync
- `src/extension/popup.ts` — site-contextual UI controller
- `src/extension/popup.html` — popup markup & styles
- `src/extension/auth.ts` — World ID OIDC flow
- `src/extension/content.ts` — trust badge injection
- `src/extension/manifest.json` — Chrome MV3 manifest

Stable extension ID (`iiomogkajkfbbpmicbfdgdojfmlbpnhn`) via RSA key in manifest.
