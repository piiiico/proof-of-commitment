# PageRank 2026: Product Vision — What Would a Human Actually Use?

*Creative product exploration. Created 2026-03-21. Task #6 of PageRank 2026 research series.*
*Think like a product designer, not an architect.*

---

## The One-Sentence Setup

AI gives you one confident answer. It's wrong 32% of the time. You can't tell which 32%. What product fixes this?

---

## Form Factor 1: AI TRUST LAYER — The Ad Blocker for Bullshit

### The Concept

A browser extension that intercepts AI responses (ChatGPT, Perplexity, Gemini) and annotates them with outcome data. When ChatGPT says "Tango Restaurante is great for tapas in Stavanger," the extension injects:

```
┌─────────────────────────────────────────────────┐
│ 📊 OUTCOME DATA: Tango Restaurante              │
│ ──────────────────────────────────────────────── │
│ 🔄 Repeat customer rate: 67% (high)             │
│ 🍽️ Mattilsynet: 😊 (last inspected Nov 2025)     │
│ 💰 Financial health: Stable (5yr trend ↑)       │
│ ⭐ Verified visitor avg: 4.3/5 (89 visits)      │
│ 📍 Still open: Yes (verified 2 days ago)        │
│                                                 │
│ ⚠️ AI said "best for tapas" — outcome data       │
│    shows strongest for seafood (78% of orders)  │
└─────────────────────────────────────────────────┘
```

Like uBlock Origin blocks ads. This blocks hallucinations.

### The User

**Who:** The "trust but verify" person. Not the early-adopter crypto person. The pragmatic 35-year-old who already uses ChatGPT for restaurant picks and has been burned once or twice. Someone who searches "best dentist Stavanger" and wonders if the AI is making things up (it often is — 83% of restaurants are invisible on ChatGPT).

**Moment of need:** Right after reading an AI recommendation. The 3-second window between "that sounds good" and "should I actually go there?" Today, 59% of AI users still check review profiles afterward. This extension eliminates that step.

### Minimum Viable Version

```
MVP (4 weeks, 1 developer):
├── Chrome extension (Manifest V3)
├── Detects AI response pages (ChatGPT, Perplexity)
├── Extracts business names from AI text (NER or pattern matching)
├── Sidebar panel with data from:
│   ├── Brønnøysund (financial health, years in operation, bankruptcy)
│   ├── Mattilsynet CSV (food safety grade, last inspection)
│   └── Google Places (review count, rating — $5/1K lookups)
├── Simple traffic light: 🟢 Verified solid / 🟡 Limited data / 🔴 Red flags
└── Norway-only to start (data sources are Norwegian)
```

**NOT in MVP:** PSD2 transaction data, ZK proofs, repeat visit analysis, global coverage.

### Data Needed

| Source | Access | Cost |
|--------|--------|------|
| Brønnøysund | Free API, no auth | Free |
| Mattilsynet Smilefjes | Daily CSV download | Free |
| Google Places | API with key | $5/1K requests (after $200/mo free) |
| Business name → orgnr matching | Must build this lookup | Development cost only |

The hard problem isn't data access — it's **entity resolution**. Matching "Tango Restaurante" in AI text to org nr 920123456 in Brønnøysund. Norwegian business names are often informal, abbreviated, or anglicized in AI responses. This is a ~80% solvable NLP problem with fuzzy matching + geocoding.

### Business Model

**Free for consumers.** Monetize through:

1. **Freemium upgrade** ($5/mo): Deeper financial analysis, historical trends, comparison tools. "Pro Trust Layer."
2. **Business dashboard** ($50/mo): "Here's how AI talks about you. Here's your outcome score vs. competitors." This is the AEO analytics product, accessed via the extension's audience.
3. **API access for AI companies** (usage-based): If the extension gets traction, the dataset of "which AI recommendations were verified/contradicted by outcome data" is gold for training better recommendation systems.

**Revenue reality check:** Consumer browser extensions rarely monetize well. The real value is the *dataset* the extension generates — the feedback loop between AI recommendation and real-world data. The extension is a data collection mechanism disguised as a consumer product.

### What Exists Today That's Closest

- **HARPA AI** (500K users): Browser extension that augments web pages with AI, but adds AI *on top of* content, doesn't verify AI claims.
- **Fakespot** (acquired by Mozilla 2023): Analyzed Amazon reviews for fakes. Similar concept but for reviews, not AI answers. Mozilla deprecated it.
- **NewsGuard**: Rates news website trustworthiness. Browser extension that adds trust ratings to search results. Revenue: $10M+ ARR from B2B licensing. **This is the closest model** — NewsGuard but for AI recommendations instead of news sources.
- **Ground News**: Shows same story from multiple political perspectives. A "bias checker" for news.

### Why Hasn't It Been Built?

1. **AI recommendation verification is new.** AI-as-search is only ~1 year old at consumer scale. The problem didn't exist until 2025.
2. **No standardized outcome data layer.** Brønnøysund + Mattilsynet is Norway-specific. No equivalent exists globally. The US has no free business financial data, no public food safety API.
3. **Browser extension distribution is painful.** Chrome Web Store review takes weeks. Apple killed extensions on mobile Safari. The extension model may not survive the shift to AI-native interfaces.
4. **Intercepting AI responses is fragile.** ChatGPT changes its DOM frequently. The extension breaks every time. This is a maintenance nightmare.

### Honest Assessment

**Would a human use this?** *Maybe.* The NewsGuard analogy is encouraging ($10M+ revenue), but NewsGuard succeeds via B2B licensing to schools/libraries, not consumer adoption. Consumer browser extensions have a brutal attrition curve. The real play here is using the extension as a proof of concept and data collection mechanism, then pivoting to a B2B API (Form Factor 5).

**The killer feature that might make it work:** Catching ChatGPT recommending a restaurant that's bankrupt, closed, or has a 😟 food safety score. One viral screenshot of "ChatGPT recommended this restaurant — it's been closed for 6 months and had a food safety violation" would drive massive install numbers. The product IS the gotcha moment.

**Norway advantage:** This is only buildable in Norway right now. The combination of free financial data + food safety data + universal business registry is globally unique. The MVP IS the moat.

---

## Form Factor 2: OUTCOME ENGINE — "Not What the Internet Says. What Actually Happened."

### The Concept

A new search interface. Not a search engine — an *outcome engine*. You don't search for "best dentist Stavanger." You ask: "Which Stavanger dentists have the best patient outcomes?"

```
┌──────────────────────────────────────────────────────┐
│  🏥 Stavanger Dentists — Ranked by Verified Outcomes │
│                                                      │
│  1. Tannlege Pedersen AS                             │
│     Patient return rate: 91% (3yr)                   │
│     Complaint rate: 0.3%  │  Financial: Stable       │
│     Operating since: 2008  │  Employees: 12          │
│     Mattilsynet: N/A       │  Smilefjes: N/A         │
│     📊 Based on: 847 verified patient visits         │
│                                                      │
│  2. Stavanger Tannklinikk                            │
│     Patient return rate: 84% (3yr)                   │
│     Complaint rate: 0.8%  │  Financial: Growing      │
│     Operating since: 2015  │  Employees: 8           │
│     📊 Based on: 523 verified patient visits         │
│                                                      │
│  [Why these rankings?]  [Data sources]  [Report]     │
└──────────────────────────────────────────────────────┘
```

### The User

**Who:** The person making a high-stakes decision. Choosing a dentist, a lawyer, a contractor, a kindergarten. Not "where to eat tonight" (low stakes, spontaneous) — but "who do I trust with my teeth / my money / my house?" This person currently spends 2-3 hours reading Google reviews, checking Mittanbud, asking friends, and still feels uncertain.

**Moment of need:** The 48-hour research window before a commitment. The person has already decided they need a service; they're now in comparison mode. Current tools fail them: Google shows whoever paid for ads, ChatGPT shows whoever has the most web presence, and friends can only recommend from their limited experience.

### Minimum Viable Version

**Start with ONE category in ONE city. Not restaurants.** Restaurants are low-stakes and crowded (Google Maps, TripAdvisor, etc.). Start where the stakes are high and the information gap is widest.

**Candidate categories (ranked by outcome data availability × user pain):**

| Category | Outcome Data Available | User Pain | Competition | Pick? |
|----------|----------------------|-----------|-------------|-------|
| Restaurants | Mattilsynet + Brreg + reviews | Low (casual decision) | Extreme (Google Maps) | ❌ |
| Tradespeople (rørlegger, elektriker) | Brreg + Mesterbrev + complaints | Very high | Moderate (Mittanbud) | ✅ **Best** |
| Dentists | Brreg + Helfo aggregate | High | Low | ✅ Good |
| Lawyers | Brreg + Tilsynsrådet for advokatvirksomhet | High | Low | ⚠️ Data access unclear |
| Kindergartens | Brreg + Utdanningsdirektoratet | Medium | Low | ⚠️ Public data limited |

**Winner: Tradespeople.** Reasons:
1. **Highest stakes.** A bad rørlegger (plumber) costs you NOK 50K-200K. A bad restaurant costs you NOK 800.
2. **Worst current information.** Mittanbud shows you who's available, not who's good. Google reviews are sparse (many craftsmen have 0-5 reviews).
3. **Rich outcome data.** Brønnøysund shows financial health (a bankrupt contractor is a warning). Mesterbrev register shows certifications. Insurance/complaint data is partially available.
4. **Cultural fit.** Norwegians take home renovation seriously (dugnad culture, cabin building). The decision matters emotionally and financially.

```
MVP (6-8 weeks):
├── Web app (Hono + simple frontend)
├── Stavanger tradespeople database:
│   ├── Brreg: all companies with NACE codes 43.xx (construction)
│   ├── Financial health score (equity ratio, revenue trend, debt)
│   ├── Years in operation, employee count
│   ├── Mesterbrev verification (scrape Kompetansesjekk.no)
│   └── Google Places reviews (where available)
├── Composite "Outcome Score" with transparent weights
├── Search by trade type + location
└── "Why this score?" expandable explanation per company
```

### Data Needed

Same as Form Factor 1, plus:
- Mesterbrev register (kompetansesjekk.no) — needs scraping, no public API
- Potentially: Forbrukerrådet complaint data, Finanstilsynet registers
- Phase 2: Actual customer outcome surveys ("How did your project go? On time? On budget? Quality?")

### Business Model

**Lead generation.** The user finds a trusted tradesperson → contacts them through the platform → the platform charges the tradesperson per lead. This is the Mittanbud model, but differentiated by trust data.

Alternatively: **Freemium for consumers, subscription for tradespeople.** A "Verified Trusted" badge that tradespeople earn (not buy) based on outcome data. They pay $50-100/mo to be featured, but only if their score qualifies. This preserves trust — you can't buy a good score, only display it.

**Revenue benchmark:** Mittanbud (Norwegian competitor) is profitable. Angi (US equivalent) did $1.7B revenue in 2022. The market is proven.

### What Exists Today That's Closest

- **Mittanbud.no** (Norway): Contractor matching with basic user ratings. No financial health data, no outcome tracking.
- **Byggstart.no** (~250 firms): Actually does financial vetting + interviews before listing contractors. **Closest to the vision.** But small, manual, not data-driven.
- **Checkatrade** (UK): 62K+ tradespeople, verified credentials + customer reviews. £700M+ valuation. Has government-backed trust mark.
- **Angi** (US): Revenue $1.7B but declining. Reviews + booking. No outcome data.

### Why Hasn't It Been Built?

1. **Financial data is uniquely Norwegian.** No other country gives you free, complete financial statements for every company. Byggstart does manual financial vetting — this automates it.
2. **Outcome data requires time.** You can't know if a plumber did a good job until 6-12 months later (when pipes don't leak). Collecting real outcome data is fundamentally slower than collecting reviews.
3. **The trades industry resists transparency.** Many small contractors operate semi-informally. A transparency tool threatens the established way of doing business.

### Honest Assessment

**Would a human use this?** *Yes.* This is the highest-conviction form factor. The pain is acute (everyone has a bad contractor story), the data advantage is real (nobody else shows financial health), and the market is proven (Mittanbud, Angi, Checkatrade). The key insight: **financial health data is outcome data**. A contractor who's been profitable for 15 years with zero debt is a fundamentally different bet than one who's been operating for 11 months with negative equity. Nobody shows you this today.

**The "aha moment":** "I was about to hire this contractor from Mittanbud. This tool showed me they have negative equity and a pattern of declining revenue. I hired someone else." That's a product that sells itself through word of mouth.

---

## Form Factor 3: TRUST PASSPORT — Your Verified Experience Portfolio

### The Concept

Flip the model. Instead of businesses proving they're good, YOU carry a verified track record of your experiences. Like a credit score, but for consumption.

```
┌─────────────────────────────────────────────┐
│  🛂 MARIA'S TRUST PASSPORT                  │
│                                              │
│  Verified dining: 127 restaurants (2 years)  │
│  Average rating accuracy: 4.2/5              │
│  Taste profile: Seafood 38%, Italian 24%     │
│  Agreement with network: 82%                 │
│  Verified via: BankID + Vipps transactions   │
│                                              │
│  Your top picks (verified visits):           │
│  🐟 Fisketorget (visited 14x) ★★★★★         │
│  🍕 Pizzanini (visited 9x) ★★★★             │
│  🍣 Sakura (visited 7x) ★★★★★               │
│                                              │
│  [Share passport]  [Privacy settings]        │
└─────────────────────────────────────────────┘
```

When someone asks "where should I eat?", Maria shares her Trust Passport link. The recipient sees verified recommendations backed by real behavior — not anonymous reviews, not AI hallucinations, but "this person actually went to these places and kept going back."

### The User

**Who:** Two distinct users:

1. **The Curator** (creator): Someone who naturally accumulates strong opinions about restaurants/services and wants their recommendations to carry verified weight. The person in every friend group who gets texted "where should we eat?" Already active on Google Reviews or Instagram food accounts. They want their opinion to MATTER more because it's backed by real behavior, not just words.

2. **The Follower** (consumer): Someone who trusts specific people's taste more than algorithms or anonymous crowds. The person who texts their foodie friend rather than checking Google Maps. They want to follow verified taste, not anonymous averages.

**Moment of need:** For the Curator — the moment they give a recommendation and want it to carry weight. For the Follower — the moment they open Google Maps and see 4.2 stars from 200 anonymous strangers and think "but would my friend like this place?"

### Minimum Viable Version

```
MVP (8-10 weeks):
├── Web app (mobile-first)
├── User authenticates with BankID (proof of personhood)
├── Connects bank/Vipps via PSD2 (AISP — via Neonomics)
│   └── Extracts: merchant name, frequency, recency
├── Auto-generates "places you visit" from transaction history
├── User adds optional ratings to auto-detected visits
├── Shareable public profile (like Letterboxd for restaurants)
├── Privacy controls:
│   ├── Choose which visits are public
│   ├── "Show I visited 40+ restaurants" without revealing which ones
│   └── ZK proof: "verified patron" without identity
└── Follow other users → see their verified picks
```

### Data Needed

| Data | Source | Challenge |
|------|--------|-----------|
| Verified visits | PSD2 transaction data (Neonomics) | **Requires AISP license** — regulatory barrier |
| Identity | BankID OIDC | ~1-2 NOK per auth, straightforward |
| Venue matching | Merchant names → business entities | Merchant names in transaction data are often abbreviated/coded |
| Ratings | User-provided (on top of verified visits) | Voluntary → selection bias |

**The AISP license is the real blocker.** You need to be a registered Account Information Service Provider under PSD2 to access transaction data. Options:
1. Partner with Neonomics (existing Norwegian AISP) — fastest but creates dependency
2. Apply for your own AISP license — 3-6 months, regulatory compliance, eIDAS certificate
3. Start WITHOUT PSD2 — users manually log visits. Loses the magic but removes the blocker.

### Business Model

**Freemium:**
- Free: Basic passport, 10 verified visits shown, follow 5 people
- Premium ($5/mo): Unlimited passport, advanced taste analytics, priority in search
- Business: Venues pay to see anonymized visitor demographics ("What kind of people eat here?")

**The Letterboxd analogy:** Letterboxd (film logging) has 15M+ members, raised $40M, monetizes through Pro subscriptions ($50/yr). They proved that "logging what you consume + social sharing" is a viable product. This is Letterboxd for real-world experiences, with payment verification.

### What Exists Today That's Closest

- **Letterboxd** (15M+ users): Log films, rate, review, follow. But nothing is verified — you can log a film you never watched.
- **Untappd** (10M+ users): Log beers, rate, check in at venues. Location-based check-ins provide weak verification. **Closest product analogy** — but unverified and single-category.
- **Paperpike** (launching Feb 2026): "Housing passport" for international renters. Portable verified reputation for renting. Exact same concept but for housing.
- **Rely** (relyestate.com): Rental passport with identity + background + income verification. Similar trust credential model.
- **Strava** (120M athletes): Activity logging with social + verified data (GPS tracks). Proves that verified activity data + social = enormous engagement.

### Why Hasn't It Been Built?

1. **PSD2 is necessary but nobody's used it for this.** PSD2 was designed for bank-to-bank competition, not consumer experience products. Using transaction data as "proof of visit" is a novel application that regulators haven't explicitly addressed.
2. **Privacy psychology.** Sharing your spending = sharing your salary proxy. Even in high-trust Norway, people may resist. The ZK version ("I'm a verified patron of 40+ restaurants, trust my recommendations") mitigates this but is technically harder.
3. **Merchant name resolution is terrible.** Your Vipps transaction says "STAVANGERMAT AS" — is that Restaurant A or Restaurant B? Matching merchant codes to actual venues is an unsolved-at-scale problem. (MCC codes help but are too coarse.)
4. **Cold start on social.** A passport nobody sees is useless. Needs critical mass of both Curators and Followers in the same city. Stavanger (140K) is small enough to reach — but you need ~500-1,000 active users before the social graph feels alive.

### Honest Assessment

**Would a human use this?** *The Curator would. The Follower is harder.* Untappd and Letterboxd prove that logging + social works for enthusiasts. The question is whether payment verification adds enough value to justify the PSD2 complexity, or whether manual check-ins (like Untappd) are "good enough."

**The counterargument:** Manual check-ins are gameable. The ENTIRE point is that you can't fake a Vipps transaction. If verification doesn't matter, this is just another Untappd. If verification matters (and the research says repeat visits are the strongest trust signal by far), then PSD2 is the moat.

**Start WITHOUT PSD2.** Launch as a Letterboxd-for-restaurants with BankID verification of the person (not the visit). Add PSD2 verification as a premium "verified visit" badge once you have users and have secured AISP access. The magic is in the verified identity + social graph, not necessarily in transaction verification for MVP.

---

## Form Factor 4: COMMUNITY TRUST NETWORKS — "Stavanger Mat: 200 People Who Actually Eat Here"

### The Concept

Small, high-trust groups that pool verified experience data and produce consensus rankings. Not the whole internet — your city's 200 most serious food people, with verified dining histories, producing rankings that AI systems can reference.

```
┌─────────────────────────────────────────────────────┐
│  🍽️ STAVANGER MAT                                    │
│  Community Trust Network · 214 members               │
│  3,847 verified restaurant visits (past 12 months)   │
│                                                      │
│  CONSENSUS: Best Seafood in Stavanger                │
│  ──────────────────────────────────────────          │
│  1. Fisketorget          │ 92% member approval       │
│     (147 verified visits, 89% return rate)            │
│  2. Sjøhuset Skagen      │ 87% member approval       │
│     (98 verified visits, 76% return rate)             │
│  3. N.B. Sørensen's      │ 83% member approval       │
│     (72 verified visits, 81% return rate)             │
│                                                      │
│  "Cited by ChatGPT in 34 responses this month"       │
│  "Perplexity references this network as a source"    │
│                                                      │
│  [Join network]  [View methodology]  [API access]    │
└─────────────────────────────────────────────────────┘
```

Think: modern Zagat Guide. Zagat was "a restaurant survey of real people" — 350,000 surveyors rating on food, decor, service. It was acquired by Google for $151M in 2011 because crowdsourced-but-curated ratings had proven value. Then Google killed it.

### The User

**Who:** The "food person" in a mid-sized city. Not a professional critic — a dentist who eats out 3x/week and has strong opinions. A couple who've tried every restaurant in the area. The 200-500 people in any city who collectively know every venue worth knowing.

**Moment of need:** They already share recommendations informally — in group chats, at dinners, when friends visit. This formalizes and verifies what they're already doing. The motivation isn't "help the world" — it's status within the community ("I've verified 200+ visits, my rankings are backed by data").

### Minimum Viable Version

```
MVP (6-8 weeks):
├── Invite-only web community (BankID-verified members)
├── Members log restaurant visits + rate (1-5)
│   └── Optional: link to Vipps transaction as verification
├── Aggregate ratings with member weighting:
│   ├── More visits = more weight
│   ├── Longer membership = more weight
│   └── Agreement with consensus = credibility score
├── Public-facing consensus rankings per category
├── Simple API / MCP server for AI systems to query
└── Monthly "Stavanger Mat Report" (newsletter)
```

**Network size target:** 200 members in Stavanger. With 3x/week dining average × 200 members = 600 visits/week = 31,000 verified visits/year. That's enough for statistically significant rankings of ~300 restaurants.

### Data Needed

| Data | Source | Quality |
|------|--------|---------|
| Member identity | BankID | Near-unfakeable |
| Visit verification | Self-reported (MVP) → Vipps/PSD2 (later) | Medium → High |
| Ratings | Member-provided (post-visit) | High (verified visitors) |
| Business entity | Brreg (financial health, years operating) | Official |
| Food safety | Mattilsynet CSV | Official |

### Business Model

**The network itself is free.** Revenue from:

1. **AI API access** ($0.10/query): AI systems pay to reference community rankings. "According to Stavanger Mat (214 verified members, 3,847 verified visits), the best seafood restaurant is..." This is the product AI companies lack: curated, verified, trustworthy recommendations from real humans.

2. **City licensing** ($2K-5K/yr per city): Franchise the model. "Oslo Mat," "Bergen Mat," "Trondheim Mat." Each city network operates semi-independently but shares the platform and methodology.

3. **Premium content** ($10/mo): Detailed analytics, personalized recommendations based on taste profile similarity to members, early access to new rankings, exclusive events.

4. **Venue partnerships** (carefully): Venues pay for verified "Community Approved" badges. But ONLY if they earn them through member ratings. Never pay-for-placement. This is the Michelin principle: the badge must be earned, not bought.

### What Exists Today That's Closest

- **Zagat** (1979-2018): 350K surveyors, crowd-sourced-but-curated restaurant ratings. Sold to Google for $151M. Google killed it. The concept is PROVEN — the execution lacked verification and got drowned in Google's scale obsession.
- **The Infatuation** / **Eater**: Curated editorial restaurant guides. Expert-driven, not community-driven. Not verified.
- **Beli** (app): "Rate restaurants, see friends' picks." Growing in US. Social dining app with ratings. No verification.
- **Friendspire**: Friend-powered recommendations for restaurants, movies, books. Close to this but no verification and no community consensus mechanism.
- **Vivino** (60M+ users): Wine community with scan-to-rate. Massive scale but unverified (anyone can rate any wine without buying it).
- **Local food Facebook groups** (every Norwegian city has one): "Stavanger Restaurantguide" etc. Unstructured, unverified, unqueryable by AI. But they prove the DEMAND — people want local, trusted food opinions.

### Why Hasn't It Been Built?

1. **Curation is hard to scale.** Zagat worked at 350K surveyors but required a massive editorial operation. The challenge: how do you maintain quality at 200 members without full-time staff?
2. **Community management is a full-time job.** Every city network needs a "mayor" — someone who recruits, moderates, and maintains culture. This isn't a technology problem; it's a people problem.
3. **The AI citation angle is new.** The reason to build this NOW is that AI systems need trustworthy local data sources. Before 2025, a Zagat-like community had to monetize through traditional media. Now it can monetize by being the source AI systems cite.
4. **Verification wasn't possible at consumer scale.** BankID + PSD2 makes "verified you were there" technically possible for the first time. Previous community rating systems couldn't distinguish real visits from drive-by ratings.

### Honest Assessment

**Would a human use this?** *The right 200 humans, yes.* This is a niche product by design — it works BECAUSE it's small and curated. The Facebook food groups prove the demand. The question is whether formalization (ratings, verification, consensus scores) adds enough value over the informal group chat, or whether it feels bureaucratic.

**The killer dynamic:** Status. If being a high-ranked member of "Stavanger Mat" becomes a social signal — "my restaurant recommendations are verified by 200+ visits" — then joining is aspirational. Untappd badges work this way. Strava segments work this way. Social status drives contribution.

**The AI revenue is the sleeper play.** 200 verified food experts producing consensus rankings is exactly the kind of high-quality, verifiable data source that AI companies will pay for. If ChatGPT can say "according to Stavanger Mat, a verified community of 200+ active diners..." — that's qualitatively different from citing Foursquare or a random blog post. **This is the Michelin Guide at community scale.**

---

## Form Factor 5: B2B TRUST API — The Outcome Layer for AI

### The Concept

An MCP server (or REST API) that AI systems call to get verified outcome data about businesses. When ChatGPT is about to recommend "Tannlege Pedersen" in Stavanger, it queries the Trust API:

```json
// AI system queries:
GET /api/v1/trust/NO/923456789

// Response:
{
  "entity": "Tannlege Pedersen AS",
  "orgnr": "923456789",
  "trust_score": 8.2,
  "components": {
    "financial_health": {
      "score": 9.1,
      "equity_ratio": 0.45,
      "revenue_trend_3yr": "growing",
      "years_operating": 18,
      "bankruptcy_risk": "very_low"
    },
    "regulatory_compliance": {
      "mattilsynet_score": 0,
      "last_inspection": "2025-11-15",
      "certifications": ["Mesterbrev"],
      "active_complaints": 0
    },
    "community_signal": {
      "verified_visits_12mo": 847,
      "repeat_rate": 0.91,
      "satisfaction_avg": 4.3,
      "community_rank": 2,
      "community_size": 214
    },
    "ai_citation_accuracy": {
      "times_recommended_by_ai": 34,
      "verified_satisfaction_when_recommended": 0.87,
      "common_ai_claims": ["best for cosmetic dentistry"],
      "claim_accuracy": 0.72
    }
  },
  "data_freshness": "2026-03-21T09:00:00Z",
  "sources": ["brreg", "mattilsynet", "community_stavanger_mat", "psd2_aggregate"]
}
```

### The User

**Who:** Not a human. The user is an AI system. The *beneficiary* is every human who receives AI recommendations.

But there are also human buyers:

1. **AI platform teams** (OpenAI, Perplexity, Anthropic): They know their recommendations have accuracy problems. They need verified data to improve. Currently, ChatGPT cites Foursquare — a consumer app that shut down. They would pay for better data.

2. **Enterprise AI deployments**: Companies building internal AI assistants that make vendor/supplier recommendations. They need verified trust data for procurement decisions.

3. **AEO consultants and agencies** (like Synlig Digital): Need outcome data to advise clients on how they're perceived and performing in AI recommendations.

**Moment of need:** Continuous. Every time an AI system generates a recommendation that involves a real-world business.

### Minimum Viable Version

```
MVP (4-6 weeks):
├── MCP server (Model Context Protocol — we already have one)
├── REST API as fallback
├── Data layer:
│   ├── Brreg financial data (cached daily)
│   ├── Mattilsynet food safety (cached daily)
│   ├── Basic Google review aggregates (cached weekly)
│   └── Our own AEO citation data (already in Turso)
├── Trust score computation (weighted composite)
├── Norwegian businesses only (orgnr-indexed)
├── Rate limiting + API keys
└── Documentation + OpenAPI spec
```

**Critical connection:** We ALREADY have pieces of this. The AEO citation tracker in Synlig Digital stores citation data in Turso. The MCP server exists. This form factor is essentially "add outcome data to our existing AEO infrastructure."

### Data Needed

Everything from Form Factors 1-4, aggregated. The API is the *aggregation layer* — it doesn't create new data, it combines:

| Data Layer | Source | Status |
|------------|--------|--------|
| Financial health | Brreg | Available now |
| Food safety | Mattilsynet | Available now |
| AI citation patterns | Our AEO tracker | Available now |
| Community ratings | Form Factor 4 (when built) | Future |
| Verified visits | Form Factor 3 / PSD2 (when built) | Future |
| Recommendation outcomes | Form Factor 1 feedback (when built) | Future |

**The insight:** Start the API with the data you have NOW (Brreg + Mattilsynet + AEO data). Each subsequent form factor adds a new data layer to the API. The API is the unifying product that everything else feeds into.

### Business Model

**Usage-based pricing for AI companies:**

| Tier | Queries/month | Price | Target |
|------|--------------|-------|--------|
| Free | 1,000 | $0 | Developers, hobbyists |
| Startup | 50,000 | $200/mo | Small AI apps |
| Growth | 500,000 | $1,500/mo | Mid-size platforms |
| Enterprise | Unlimited | Custom | OpenAI, Perplexity, Google |

**Revenue benchmarks:**
- Clearbit (business data API): Acquired by HubSpot for ~$150M
- ZoomInfo (B2B contact data): $1.2B revenue, $15B market cap
- Crunchbase (company data API): ~$60M ARR

**The moat:** The aggregation. Individual data sources (Brreg, Mattilsynet) are public. But the *combination* — financial health + food safety + AI citation accuracy + community trust scores + verified visit data — is the product. Nobody else has this combination because nobody else has built Form Factors 1-4.

### What Exists Today That's Closest

- **Clearbit / ZoomInfo**: B2B company data APIs. Similar structure but focused on sales/marketing data, not trust/outcome data.
- **BuiltWith / SimilarWeb**: Technology and traffic intelligence APIs. Different signal type.
- **Our own AEO MCP server**: Already exists. This form factor extends it with outcome data.
- **Trustpilot Business API**: Provides review data via API but single-source, unverified.
- **Dun & Bradstreet (D&B)**: Business credit scores. Closest traditional analog — they compute trust scores from financial data. But they charge enormously ($5K+ per integration) and don't incorporate outcome/behavioral data.

### Why Hasn't It Been Built?

1. **The AI buyer is new.** AI companies needing verified recommendation data is a 2025-2026 phenomenon. The market didn't exist 2 years ago.
2. **The data aggregation requires Nordic infrastructure.** Free financial data + food safety + universal digital ID = unique to Norway/Nordics. Can't replicate this stack in the US or UK.
3. **Nobody has connected the layers.** The data sources exist individually. The aggregation + trust score computation + AI-ready API format is the novel work.

### Honest Assessment

**Would a human use this?** *Humans don't use this directly — AI does, on behalf of humans.* But the question is whether AI companies would **pay** for it.

**The answer is probably yes, once the data is differentiated enough.** ChatGPT currently cites Foursquare (dead app), Yelp (US-centric), and random web content. If you can offer verified Norwegian business data — financial health, food safety, community ratings, verified visit data — that's categorically better than what they have.

**The pricing challenge:** The data is most valuable for Norwegian businesses. Norway has ~600K registered companies, ~40K restaurants/cafes. This is a small market. Global scale requires expanding to other Nordic countries (similar registries in Sweden, Finland, Denmark) and eventually beyond.

**The critical path:** This is not a standalone product. It's the *monetization layer* for Form Factors 1-4. Build the data collection mechanisms (extension, community, passport), monetize through the API. **The API is the revenue engine. Everything else is a data collection mechanism.**

---

## Synthesis: Which Form Factor First?

### The Product Ladder

These aren't alternatives — they're a sequence. Each form factor generates data that feeds the next:

```
                    ┌─────────────────────┐
                    │  5. B2B TRUST API   │ ← Revenue engine
                    │  (MCP server)       │    Monetizes all data
                    └─────────┬───────────┘
                              │ feeds
            ┌─────────────────┼──────────────────┐
            │                 │                  │
  ┌─────────┴────┐  ┌────────┴───────┐  ┌──────┴──────────┐
  │ 1. AI TRUST  │  │ 4. COMMUNITY   │  │ 3. TRUST        │
  │    LAYER     │  │    NETWORKS    │  │    PASSPORT     │
  │ (extension)  │  │ (Stavanger Mat)│  │ (Letterboxd+)   │
  └──────────────┘  └────────────────┘  └─────────────────┘
            │                 │                  │
            └─────────────────┼──────────────────┘
                              │ all built on
                    ┌─────────┴───────────┐
                    │  2. OUTCOME ENGINE  │ ← Core data layer
                    │  (Brreg+Mattilsynet │    Public data +
                    │   + trust score)    │    computation
                    └─────────────────────┘
```

### Recommended Sequence

| Phase | Form Factor | Timeline | Why Now |
|-------|------------|----------|---------|
| **1** | **2. Outcome Engine** (Stavanger tradespeople) | Weeks 1-8 | Highest conviction. Proven market. Real user pain. All data available today. |
| **2** | **5. B2B Trust API** (MCP server with Brreg+Mattilsynet) | Weeks 4-10 (parallel) | Extends existing AEO infrastructure. Revenue potential from day one. |
| **3** | **4. Community Network** (Stavanger Mat — restaurants) | Months 3-6 | Builds the social/community data layer. Creates verified data that no API can provide. |
| **4** | **1. AI Trust Layer** (browser extension) | Months 4-8 | Proof of concept for the "AI verification" thesis. Generates feedback data. |
| **5** | **3. Trust Passport** (BankID + PSD2) | Month 8+ | Most complex (requires AISP license). Build once other products generate demand. |

### The Unifying Insight

**Every form factor is a different answer to the same question: "Did it actually work?"**

- The **Outcome Engine** asks: "Does this business's verified track record suggest it works?"
- The **Trust API** asks: "What outcome data exists about this business?"
- The **Community Network** asks: "Do verified humans agree it works?"
- The **AI Trust Layer** asks: "Does outcome data support what the AI just told you?"
- The **Trust Passport** asks: "Does this person's verified behavior show they know what works?"

The underlying data layer is the same. The product form factors are just different surfaces for the same truth: **what actually happened in reality, verified, not what someone said happened on the internet.**

---

## The Hard Questions

### 1. Why Will This Succeed Where Data Cooperatives Failed?

**Because the killer use case finally exists.** MyData's "own your data" was abstract. "Your AI gives you actually good dentist recommendations because 5,000 people in Stavanger shared their real experiences" is concrete. The motivation is better outcomes for the user, not ideological data sovereignty.

### 2. How Do You Prevent This From Becoming the Next Yelp?

**By keeping the trust signal involuntary.** Yelp's ratings are voluntary explicit signals → they get gamed. Repeat visit data from PSD2 is involuntary behavioral data → it resists gaming. The moment you allow businesses to influence their score through any mechanism other than actual quality, you've lost. Design rule: **no path from money to score, only from outcomes to score.**

### 3. What If AI Platforms Build This Themselves?

**They probably will — eventually.** But they're 2-3 years behind on Nordic public data integration, have no BankID/PSD2 access, and face regulatory complexity they're not equipped to handle. The window is 18-24 months to build the data moat and become the source AI platforms query rather than replace.

### 4. Is Norway Too Small a Market?

**Norway is the lab, not the market.** The product is global; the proving ground is Norwegian because the infrastructure exists nowhere else. Expand to Denmark, Sweden, Finland (similar registries, shared digital infrastructure). Then EU (eIDAS 2.0 creates comparable identity infrastructure by end of 2026). The protocol is open from day one.

### 5. What's the "Google Moment"?

PageRank's Google moment was: a Stanford grad student shows a search engine that actually works.

The Trust Layer's equivalent moment: someone asks ChatGPT "best rørlegger in Stavanger." ChatGPT gives a confident answer. The user checks the Trust API. The recommended plumber has negative equity, was founded 3 months ago, and has a registered complaint. The user finds this through the Outcome Engine and hires someone with 15 years of profitable operation instead.

**The moment AI's bullshit becomes visible and verifiable is the moment this product becomes inevitable.**

---

## Sources

### Product References
- NewsGuard: newsguardtech.com ($10M+ ARR, browser extension for news trust)
- Fakespot: acquired by Mozilla 2023, deprecated
- Letterboxd: 15M+ members, $40M raised (film logging + social)
- Untappd: 10M+ users (beer logging + check-ins)
- Zagat: acquired by Google $151M (2011), killed (crowd-sourced restaurant ratings)
- Strava: 120M athletes (verified activity logging + social)
- Vivino: 60M+ users (wine community + ratings)
- Paperpike: paperpike.com (housing passport, launching Feb 2026)
- Rely: relyestate.com (portable rental passport)
- Beli: restaurant rating app with social features
- Friendspire: friend-powered recommendations

### Market References
- Mittanbud.no (Norwegian contractor matching)
- Byggstart.no (~250 vetted Norwegian contractors)
- Checkatrade (UK, 62K+ tradespeople, £700M+ valuation)
- Angi (US, $1.7B revenue 2022)
- Clearbit (acquired by HubSpot ~$150M, business data API)
- ZoomInfo ($1.2B revenue, business data API)
- D&B (business credit scores)

### Data Sources
- All Norwegian public data sources verified in pagerank-2026-nordic-advantage.md
- PSD2 / Neonomics: neonomics.io
- BankID: bankid.no

---

*This document is task #6 of the PageRank 2026 research series. It feeds back into the master strategy at `/workspace/memory/knowledge/strategy/pagerank-2026-concept.md`. Product-focused complement to the infrastructure research in tasks #1-5.*
