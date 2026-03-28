# Proof of Commitment — Chrome Extension

Track your time on websites. Verify you're a unique human. Prove commitment, not just clicks.

**Status:** v0.1 — installable for sideloading. World ID integration requires credentials (see step 3).

---

## Install in 5 minutes

### Step 1: Get the extension files

Clone the repo (or download and unzip):

```bash
git clone https://github.com/hawkaa/proof-of-commitment
cd proof-of-commitment
bun install
bun run build:ext
```

Or just grab the pre-built `dist/extension/` folder if available.

### Step 2: Load in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `dist/extension/` folder

The extension will appear in your toolbar (indigo icon). Click it — you'll see your browsing stats already being tracked.

### Step 3: Set up World ID (for human verification)

The "Sign in with World ID" button requires credentials. You'll need a [World App](https://worldcoin.org/download) installed on your phone (for device or orb verification).

**Extension ID:** `iiomogkajkfbbpmicbfdgdojfmlbpnhn`
**Redirect URI:** `https://iiomogkajkfbbpmicbfdgdojfmlbpnhn.chromiumapp.org/callback`

If using the shared credentials (ask the maintainer for `app_id`):
1. Receive `app_id` and update `src/extension/auth.ts` line 12
2. Run `bun run build:ext` again
3. Click **Reload** on `chrome://extensions`
4. Sign in works!

**To set up your own World ID app:**
1. Go to [developer.worldcoin.org](https://developer.worldcoin.org)
2. Create an account and a new app (select "Sign In with World ID")
3. In the app settings, add redirect URI: `https://iiomogkajkfbbpmicbfdgdojfmlbpnhn.chromiumapp.org/callback`
4. Copy the `app_id` (format: `app_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)
5. Replace `app_PLACEHOLDER` in `src/extension/auth.ts` line 12
6. `bun run build:ext` → reload extension → done

---

## What it does

- **Tracks time** on each domain (stored locally in `chrome.storage.local`)
- **Verifies humanity** via World ID OIDC (device or orb level)
- **Popup** shows your top domains by time + verification status

### What it does NOT do yet (v0.2+)
- No data leaves your browser (no backend sync yet)
- No zkTLS proofs on purchases yet
- No Semaphore anonymous submission yet

---

## Privacy

All data stays in your browser. `chrome.storage.local` is only accessible to this extension. Nothing is transmitted anywhere in v0.1.

World ID authentication: your sub identifier is app-specific (World ID scopes each app separately). The extension stores only your verification level and a session token — no biometrics, no personal data.

---

## Development

```bash
bun install
bun run build:ext    # build once
bun run dev:ext      # watch mode (rebuilds on change)
```

Source files:
- `src/extension/background.ts` — service worker, time tracking
- `src/extension/popup.ts` — popup UI logic
- `src/extension/auth.ts` — World ID OIDC flow
- `src/extension/content.ts` — content script (placeholder for v0.2)
- `src/extension/manifest.json` — Chrome extension manifest

The extension has a stable ID (`iiomogkajkfbbpmicbfdgdojfmlbpnhn`) due to the RSA key in the manifest. This means redirect URIs registered with World ID will always match.
