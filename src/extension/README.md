# Commit: browser extension

**v0.5.1.** Nobody types anything. Built and maintained by Pico, an AI agent working for Håkon Åmdal.

## What it shows

**On a shop page, with no friends and no account.** If the page prints its own organisation number («Org.nr: 882 692 302»), one line in the bottom-left corner:

> Biltema Norge AS · i drift siden 2000 · 1 845 ansatte · omsetning 2025: 5,6 mrd kr

The figures come from Brønnøysundregistrene (data.brreg.no, open data). The line turns red only on hard facts: konkurs, avvikling, registered less than 12 months ago with no accounts, or an org.nr that belongs to a company whose name doesn't resemble the domain (a rough check, and it says so). A page without an org.nr gets nothing. We never guess an org.nr from a name.

**Under search results (Google and Bing; DuckDuckGo is wired in but untested).** The same line, for shops whose org.nr you've already seen on an earlier visit.

**«Mitt kort».** From install on, the extension counts locally the shops (pages with an org.nr) you return to across months and the order-confirmation pages you reach. In the popup you see the list, delete any row, and copy a link. Send it to a friend through any channel. They open it and click «Importer», and from then on their extension shows «Håkon: handlet her 3× (2025–26)» on that shop and under its results. Health, pharmacy, gambling, dating, adult, religion, politics, banks and loans are never counted (domain denylist plus NACE codes), and the importer filters them again.

**«Lag kortet fra de siste 90 dagene» (v0.5.1).** So the card isn't empty at install: one button asks Chrome for the optional `history` permission, reads the last 90 days in month windows inside the browser (in the background worker, so it survives the popup closing behind Chrome's dialog), and merges into the same local log. Rules: an order counts only where the URL or title is an order confirmation by the same `isOrderPage()` rule; a months-only row needs an org.nr already seen on that domain; the sensitive filter runs first. The popup shows the date span it read and a link that removes the permission.

**On GitHub repository pages (with «Commit-server» on).** A trust card showing age, recent activity, contributors and releases.

## What leaves the browser

- The org.nr a shop prints goes to data.brreg.no. Nothing else is sent with it.
- Browser history (only if you press the button): read in your browser, never sent anywhere.
- The card goes only where you send the link. The data sits after `#`, so it doesn't even reach getcommit.dev's server when the friend opens it.
- By default nothing goes to Commit's servers. The «Commit-server» switch in the popup (off by default) turns on three things: the GitHub trust card (owner/repo), the popup's lookup of the current tab's domain, and visit sync (domain, visit count, time, every five minutes).
- What the backend does with those (read from `src/backend/worker.ts`, 2026-11-10): `GET /api/github/:owner/:repo` and `GET /api/domain/:domain` only read; no D1 or KV write, and the worker has no Workers Logs or Logpush configured (Cloudflare's edge still sees the request, like any website). `POST /api/commit` would store domain, visit count and time against a World ID subject, but it requires a World ID bearer token that the extension's sync doesn't send, so today it is rejected with 401 and nothing is stored.

## Install (sideload)

Download `commit-extension-v0.5.1.zip` from the [releases](https://github.com/piiiico/proof-of-commitment/releases), unzip it, open `chrome://extensions`, turn on Developer mode, then «Load unpacked» and pick the folder. Or build it yourself: `bun install && bun run build:ext`, which builds into `dist/extension/`.

## Tests

- `bun test src/extension/shop.test.ts`: org.nr detection (label + mod11), the line and its red cases, name matching, order pages, card rows and the sensitive filter.
- `bun scripts/extension-v051-history.ts` (needs an X display, e.g. `Xvfb :99 & DISPLAY=:99 …`): the history button against LABELLED SYNTHETIC history seeded into the profile's History database, through the real toolbar popup and Chrome's native dialog (answered with XTEST keys). Positive, empty-profile, declined and revoke arms, then export → import → friend line on biltema.no and on Bing.
- `bun scripts/extension-v05-real.ts`: a real Chromium with the extension loaded, run against real shops and real result pages, plus card export → import into a second profile. Screenshots go to `chrome-store/screenshots/`.

Source: `shop.ts` (pure logic), `shop-content.ts` (page side), `background.ts` (Brreg lookup and cache), `popup.ts` («Mitt kort»), `content.ts` (GitHub card and dispatch).
