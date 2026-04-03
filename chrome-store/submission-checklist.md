# Chrome Web Store Submission Checklist

## Status: Ready to Submit — Needs Håkon's Google Account

---

## ✅ Done (autonomous)

- [x] Extension packaged as `.zip` → `proof-of-commitment-v0.1.0-store.zip`
- [x] Privacy policy drafted → `chrome-store/privacy-policy.md`
- [x] Store listing text drafted → `chrome-store/store-listing.md`
- [x] Icons present: 16px, 48px, 128px

---

## ❗ Blockers — Needs Håkon

### 1. Chrome Web Store Developer Account
- Go to: https://chrome.google.com/webstore/devconsole
- One-time registration fee: **$5** (Google account required)
- This cannot be done autonomously

### 2. World ID App Registration (critical — extension non-functional without this)
- Go to: https://developer.worldcoin.org
- Create app → get `app_id`
- Set redirect URI to: `chrome.identity.getRedirectURL('/callback')`
- Replace `app_PLACEHOLDER` in `src/extension/auth.ts` line 15
- Rebuild extension: `bun run build` (or equivalent)
- **WITHOUT THIS: the "Sign in with World ID" button silently fails**
- Store reviewers may test this and reject the extension

### 3. Privacy Policy Hosting
- Host the privacy policy at a public URL (e.g., `https://getcommit.dev/privacy` or a GitHub raw URL)
- Required field in store submission

### 4. Screenshots
- Chrome Web Store requires at least 1 screenshot (1280x800 or 640x400)
- Needs: browser screenshot of extension popup open
  - State 1: Sign-in prompt
  - State 2: Verified with visit stats
- Take screenshots after World ID is configured so the extension is functional

### 5. Promo Image (optional but recommended)
- Small tile: 440x280px
- Marquee: 1400x560px

---

## Submission Steps (once blockers are cleared)

1. Log into https://chrome.google.com/webstore/devconsole
2. Click "New Item" → upload `proof-of-commitment-v0.1.0-store.zip`
3. Fill in store listing using `chrome-store/store-listing.md`
4. Upload screenshots
5. Set privacy policy URL
6. Select category: Productivity or Privacy
7. Submit for review (typically 1-3 business days)

---

## Notes

- Extension version 0.1.0 is already on GitHub Releases for sideload
- The zip is at: `/workspace/repos/proof-of-commitment/proof-of-commitment-v0.1.0-store.zip`
- World ID blocker is the most critical — don't submit without it or the extension will be non-functional
