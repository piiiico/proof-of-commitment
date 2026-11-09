# Store packages: Commit extension 0.4.1

Prepared by Pico (AI agent) on 2026-11-09. For the Chrome Web Store, the only step left is the upload from Håkon's developer account.

0.4.1 is the sideloaded v0.4.0 with two changes: the popup's business-registry card now escapes the values it gets back from the backend, and the manifest description no longer says "your history stays local" (a GitHub repository page does send owner and repository name, see Privacy below).

| File | What |
|---|---|
| `commit-chrome-0.4.1.zip` | Chrome Web Store upload. Same build as `dist/extension`, but the manifest has no `"key"`, so CWS assigns the ID. Tested headless: the overlay flow passes from this unpacked zip. |
| `commit-firefox-0.4.1.zip` | Firefox (AMO) build: `background.scripts` instead of `service_worker`, gecko id `commit@getcommit.dev`, `data_collection_permissions`. `web-ext lint`: 0 errors, 7 innerHTML warnings (static markup or escaped values; the backend values in the popup were fixed in 0.4.1). Not run in a real Firefox. |
| `screenshots/1-results.png`, `2-shop.png` | 1280×800, from `screenshots.ts`. Synthetic results page plus a test Anbefal network, labelled «Demo data» in the image. The domain dates are real RDAP data. |
| `amo-gate-captcha-2026-11-09.png` | Why the Firefox listing isn't live (see the end of this file). |

Rebuild: `bun run build:ext && bun scripts/build-store-packages.ts && bun chrome-store/screenshots.ts`.

## Chrome Web Store: the upload

1. https://chrome.google.com/webstore/devconsole → New item → upload `commit-chrome-0.4.1.zip`.
2. Store listing: paste from below. Category: Shopping (fallback: Productivity). Language: Norwegian Bokmål, with English added as a second listing language.
3. Screenshots: the two PNGs. Icon: 128px is in the zip.
4. Privacy tab: paste the answers below. Privacy policy URL: `https://getcommit.dev/extension#personvern`.
5. Visibility: Public. Submit.

## Listing text

**Name:** Commit

**Summary, EN (123/132):** See what people you know recommend, right in Google results. Off until you turn it on, and only result domains are checked.

**Summary, NO (120/132):** Se hva folk du kjenner anbefaler, rett i Google-resultatene. Av til du slår den på, og bare domenene i treffene sjekkes.

**Description, EN:**

Search «lys Audi» and the shop your mechanic friend buys from carries his own words under the result: what he bought there, whether he would buy it again, how long he has worked in the trade. When nobody you know has said anything about a shop, Commit shows nothing.

What it shows:
• Fra nettverket ditt: confirmed recommendations from people in your own Anbefal network, matched to the shops in your Google results, and again on the shop page if you click through. Each one is dated and names the person.
• Domain age: the registration date from the domain registry (RDAP) under each result.
• GitHub: a trust card on repository pages (age, recent activity, contributors, releases).

Anbefal is a closed pilot in Norway for now, so the recommendations only appear if you have been invited. The overlay stays off until you open your own Anbefal link and press «Slå på».

Open source: github.com/piiiico/proof-of-commitment. Built and maintained by Pico, an AI agent working for Håkon Åmdal.

**Description, NO:**

Søk «lys Audi», og butikken mekanikervennen din handler hos får hans egne ord under treffet: hva han kjøpte der, om han ville kjøpt igjen, hvor lenge han har jobbet i faget. Har ingen du kjenner sagt noe om en butikk, viser Commit ingenting.

Dette vises:
• Fra nettverket ditt: bekreftede anbefalinger fra folk i ditt eget Anbefal-nettverk, koblet til butikkene i Google-treffene, og igjen på butikksiden hvis du klikker deg inn. Hver anbefaling er datert og har navn.
• Domenealder: registreringsdatoen fra domeneregisteret (RDAP) under hvert treff.
• GitHub: et tillitskort på repo-sider (alder, aktivitet, bidragsytere, releaser).

Anbefal er en lukket pilot i Norge foreløpig, så anbefalingene vises bare hvis du er invitert. Overlegget er av til du åpner din egen Anbefal-lenke og trykker «Slå på».

Åpen kildekode: github.com/piiiico/proof-of-commitment. Bygget og driftet av Pico, en KI-agent som jobber for Håkon Åmdal.

## Privacy tab answers

Matches https://getcommit.dev/extension#personvern (updated 2026-11-09 to name the GitHub and popup lookups).

**Single purpose:** Show, next to search results and on shop pages, what people in the user's own network recommend, plus domain-age and GitHub repository signals.

**Permission justifications:**
- `storage`: the user's Anbefal code, the on/off switch, cached results for the current results page.
- `tabs`, `activeTab`: the popup reads the current tab's domain to show its card; visit-time sharing (opt-in) needs the active tab's domain.
- `alarms`: sends the opt-in visit-time queue every five minutes.
- `identity`: optional World ID sign-in from earlier versions (popup button).
- Host `getcommit.dev`, `poc-backend.amdal-dev.workers.dev`: Commit's own servers, the only places data is sent.
- Content script on all URLs: needed to find Google results pages (any Google country domain), shop pages and GitHub repository pages; on other pages it only reads its local cache and sends nothing unless visit-time sharing is on.

**Remote code:** No. All code ships in the package.

**Data usage (tick):**
- Web history: YES. Domains of visible Google results (only after the user turns the overlay on); GitHub owner/repository on repository pages; the current tab's domain when the popup opens; visited domains and time spent if the user turns visit-time sharing on.
- Authentication information: YES. The user's Anbefal code is sent with the result domains.
- Everything else (personally identifiable info, health, financial, personal communications, location, user activity, website content): NO.

**Certifications:** tick all three. Not sold to third parties; not used for anything unrelated to the single purpose; not used for creditworthiness or lending.

## Firefox Add-ons: blocked at the login

On 2026-11-09, `addons.mozilla.org/api/v5/accounts/login/start/`, `/developers/addon/api/key/` and `/developers/addon/submit/distribution` all returned a Fastly CAPTCHA page ("Enter the characters seen in the image below") to our declared client (Chromium, user-agent ending `Pico-AI-agent (+mailto:pico@amdal.dev)`). The public read API (`/api/v5/addons/search/`) did not. AMO API keys, which `web-ext sign` needs, are only issued behind that login. A CAPTCHA is the platform refusing automated clients, so we did not solve it or hide the agent user-agent. The written terms do not block an agent: the Firefox Add-on Distribution Agreement asks only for a Mozilla account, with "You" defined as "the person or entity entering this Agreement", and charges no fee and asks for no ID.

What a human with a Mozilla account would do: log in at addons.mozilla.org/developers, Submit a New Add-on → On this site → upload `commit-firefox-0.4.1.zip`. AMO will ask for source because the bundle is transpiled from TypeScript: upload a zip of this repo at the commit that built it, with the rebuild line above. Paste the listing text above and set the privacy policy URL. The data-collection declaration is already in the manifest.
