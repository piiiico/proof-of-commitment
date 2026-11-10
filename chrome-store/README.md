# Store packages: Commit extension 0.5.0

Prepared by Pico (AI agent) on 2026-11-10. For the Chrome Web Store, the only step left is the upload from Håkon's developer account.

In 0.5.0 nobody types anything. The extension reads the org.nr a shop prints and shows a line from Brønnøysundregistrene, and «Mitt kort» is a list built locally from the user's own browsing that friends import with one click. The typed Anbefal overlay from 0.4 is gone.

| File | What |
|---|---|
| `commit-chrome-0.5.0.zip` | Chrome Web Store upload. Same build as `dist/extension`, but the manifest has no `"key"`, so CWS assigns the ID. |
| `commit-firefox-0.5.0.zip` | Firefox (AMO) build: `background.scripts`, gecko id `commit@getcommit.dev`, no `identity.email` (Firefox lacks getProfileUserInfo; card sender falls back to «En venn»). Not run in a real Firefox. |
| `screenshots/v05-*.png` | 1280×800 from `scripts/extension-v05-real.ts`, a real Chromium on real shops and Bing. `-FIXTURE` = Google results page served from a fixture (real Google gave this browser /sorry). In the card shots, one earlier month and one order were SEEDED into the test profile so a card exists. |
| `amo-gate-captcha-2026-11-09.png` | Why the Firefox listing isn't live (see the end of this file). |

Rebuild: `bun run build:ext && bun scripts/build-store-packages.ts && bun scripts/extension-v05-real.ts`.

## Chrome Web Store: the upload

1. https://chrome.google.com/webstore/devconsole → New item → upload `commit-chrome-0.5.0.zip`.
2. Store listing: paste from below. Category: Shopping. Language: Norwegian Bokmål, plus English.
3. Screenshots: `v05-shop-biltema.no.png`, `v05-friend-on-shop.png`, `v05-friend-serp-bing.png`. Icon: 128px is in the zip.
4. Privacy tab: paste the answers below. Privacy policy URL: `https://getcommit.dev/extension#personvern`.
5. Visibility: Public. Submit.

## Listing text

**Name:** Commit

**Summary, EN (132/132):** Who runs the shop you're on, from its own org.nr and Brønnøysund. Friends' shared shop cards. Nothing to type, nothing stored by us.

**Summary, NO (127/132):** Hvem som driver butikken, fra org.nr og Brønnøysund. Delte handlekort fra venner. Ingenting å skrive, ingenting lagres hos oss.

**Description, NO:**

Norske nettbutikker skriver organisasjonsnummeret sitt nederst på siden. Commit leser det og viser én linje i hjørnet: hvor lenge firmaet har eksistert, hvor mange som jobber der og hva det omsatte i fjor, hentet fra Brønnøysundregistrene. Linjen blir rød bare når fakta tilsier det: konkurs, avvikling, et firma registrert for under ett år siden uten regnskap, eller et org.nr som tilhører et firma med et helt annet navn enn nettstedet. Uten org.nr på siden vises ingenting.

Mitt kort: nettleseren din holder selv oversikt over butikker du kommer tilbake til over flere måneder og ordrebekreftelser du kommer til. Du ser listen, fjerner det du vil, og sender den som en lenke. En venn som importerer den ser «Håkon: handlet her 3×» på butikken og under søketreffene. Helse, apotek, spill, dating, voksen, religion, politikk, bank og lån telles aldri.

Åpen kildekode: github.com/piiiico/proof-of-commitment. Laget og vedlikeholdt av Pico, en AI-agent som jobber for Håkon Åmdal.

**Description, EN:**

Norwegian web shops print their organisation number in the footer. Commit reads it and shows one line in the corner: how long the company has existed, how many people work there and what it sold last year, from Brønnøysundregistrene. The line turns red only on hard facts: bankruptcy, liquidation, a company registered less than a year ago with no accounts, or an org.nr belonging to a company with a different name than the site. No org.nr on the page, nothing shown.

Mitt kort: your browser keeps its own list of shops you return to over several months and order confirmations you reach. You see the list, remove what you want, and send it as a link. A friend who imports it sees «Håkon: handlet her 3×» on the shop and under its search results. Health, pharmacy, gambling, dating, adult, religion, politics, banks and loans are never counted.

Open source: github.com/piiiico/proof-of-commitment. Built and maintained by Pico, an AI agent working for Håkon Åmdal.

## Privacy tab answers

Matches https://getcommit.dev/extension#personvern (updated 2026-11-10 for 0.5.0).

**Single purpose:** Show who runs the shop the user is on (from the org.nr the page prints, via the public Norwegian business registry) and where friends who shared their card have shopped.

**Permission justifications:**
- `storage`: cached registry lookups, the local shop list («Mitt kort»), imported cards, settings.
- `tabs`, `activeTab`: the popup reads the current tab's domain; visit-time sharing (opt-in) needs the active tab's domain.
- `alarms`: sends the opt-in visit-time queue every five minutes.
- `identity`, `identity.email`: the card's sender name is the first part of the Chrome profile's email, shown to the user before sharing; optional World ID sign-in.
- Host `data.brreg.no`: the public business registry, queried with the org.nr the page prints. Host `poc-backend.amdal-dev.workers.dev`: GitHub trust card and opt-in visit sync.
- Content script on all URLs: needed to read the org.nr on any shop, find results pages (any Google country domain, Bing), the card import link on getcommit.dev, and GitHub repository pages.

**Remote code:** No. All code ships in the package.

**Data usage (tick):**
- Website content: YES. The org.nr a shop page prints is sent to data.brreg.no.
- Web history: YES, only on opt-in or in two cases. GitHub owner/repository on repository pages and the current tab's domain when the popup opens go to Commit's servers. Visited domains and time spent are sent only if the user turns visit-time sharing on. The local shop list never leaves unless the user sends the link himself.
- Personally identifiable info: NO. The card's first name travels only inside the link the user sends.
- Everything else: NO.

**Certifications:** tick all three. Not sold to third parties; not used for anything unrelated to the single purpose; not used for creditworthiness or lending.

## Firefox Add-ons: blocked at the login

On 2026-11-09, `addons.mozilla.org/api/v5/accounts/login/start/`, `/developers/addon/api/key/` and `/developers/addon/submit/distribution` all returned a Fastly CAPTCHA page ("Enter the characters seen in the image below") to our declared client (Chromium, user-agent ending `Pico-AI-agent (+mailto:pico@amdal.dev)`). The public read API (`/api/v5/addons/search/`) did not. AMO API keys, which `web-ext sign` needs, are only issued behind that login. A CAPTCHA is the platform refusing automated clients, so we did not solve it or hide the agent user-agent. The written terms do not block an agent: the Firefox Add-on Distribution Agreement asks only for a Mozilla account, with "You" defined as "the person or entity entering this Agreement", and charges no fee and asks for no ID.

What a human with a Mozilla account would do: log in at addons.mozilla.org/developers, Submit a New Add-on → On this site → upload `commit-firefox-0.5.0.zip`. AMO will ask for source because the bundle is transpiled from TypeScript: upload a zip of this repo at the commit that built it, with the rebuild line above. Paste the listing text above and set the privacy policy URL. The data-collection declaration is already in the manifest.
