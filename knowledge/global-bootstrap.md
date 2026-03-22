# The Commitment Graph: Global Bootstrap Strategy

*How do we get the first 1,000 people worldwide to stake their behavioral data?*

*Compiled 2026-03-22. Task 3/3 of PageRank 2026 research. Builds on [pagerank-2026-concept.md](strategy/pagerank-2026-concept.md) and [bootstrap-incentive-research.md](bootstrap-incentive-research.md).*

---

## 1. WHO ARE THE 2026 INTERNET PIONEERS?

### Lessons from History

Every successful protocol was bootstrapped by a shockingly small core:

| Network | First-Year Core | Total Y1 Users | First-Mover Profile | Immediate Utility |
|---------|----------------|----------------|---------------------|-------------------|
| **Bitcoin** (2009) | 1 (Satoshi alone for months) | ~dozen active | Cypherpunks, cryptographers, libertarians | None (ideology only) |
| **Linux** (1991) | 5 named contributors | ~100 by 1993 | Developers who needed a free Unix | Yes — usable OS |
| **Wikipedia** (2001) | ~dozen Nupedia refugees | ~1,000 editors by Dec 2001 | Tech-savvy academics, Slashdot readers | Yes — free encyclopedia |
| **Mastodon** (2016) | ~20,000 by end of 2016 | 330,000 by Apr 2017 | Queer people, furries, leftist activists | Yes — safe social space |
| **Brave** (2016) | Privacy-conscious users | 1M by 2018 | Privacy advocates, ad-hating web users | Yes — ad blocker |
| **Farcaster** (2022) | 3,000 (personally onboarded) | ~5,000 DAU pre-Frames | Silicon Valley crypto insiders | Weak — social graph too small |
| **Lens** (2022) | Aave community, NFT artists | 50,000 profiles by mid-2022 | Crypto-native builders, DeFi users | Weak — speculative |
| **Signal** (2014) | Security researchers, journalists | Niche until 2021 WhatsApp shock | Privacy absolutists | Yes — encrypted messaging |

### The Universal First-Mover Profile

**Every network bootstrapped by the same type of person:** ideologically motivated, technically competent, frustrated with the status quo. Never mainstream users. The ideology bridges the gap between "this is useless now" and "this will matter later."

- **Bitcoin:** Believed in freedom from central banks. Mining cost nothing, upside was infinite.
- **Wikipedia:** Believed knowledge should be free. Writing articles was intrinsically rewarding.
- **Mastodon:** Believed social media should be safe for marginalized communities. Built safety features the mainstream wouldn't.
- **Linux:** Needed a free Unix and was willing to build it.

### The Commitment Graph Pioneer Profile

The person who would stake their behavioral data in a global commitment network:

**Core belief:** "AI is making decisions about my life using bad data. My real behavior is more trustworthy than internet content. The world would be better if AI could access what actually happened rather than what someone wrote about what happened."

**Demographic intersection:**
- **Privacy-aware technologists** who understand both the value and the risks of behavioral data
- **AI power users** who've been burned by hallucinated recommendations (32% error rate on local businesses)
- **Open data advocates** — the people who built OpenStreetMap, contributed to Wikipedia, ran Mastodon instances
- **Crypto-natives who are disillusioned with speculation** — they've seen every data token fail (-95% to -100%) and want something real
- **Small business owners** who are invisible to AI (83% of restaurants don't appear in ChatGPT results)

**Where they gather:**
- Hacker News, Lobsters (tech idealists)
- Farcaster, crypto Twitter (crypto-native builders)
- Privacy-focused communities (Signal groups, Mastodon instances)
- IndieWeb, personal website advocates
- AI safety/alignment communities
- Open data communities (OKFN, civic tech)

### Minimum Viable Community

Historical precedent suggests **the bootstrapping core is 10-100 committed people**, not 1,000:
- Bitcoin: Literally 1 person for most of 2009
- Linux: 5 contributors after 6 months
- Wikipedia: A few dozen productive editors in month 1
- Farcaster: 3,000 via personal Zoom calls

**The first 1,000 is not the bootstrap target — it's the first milestone.** The actual bootstrap is the first 50-100 true believers who contribute data, provide feedback, and recruit their networks.

---

## 2. GLOBAL SEED DATA — WHAT'S ALREADY PUBLIC

### Tier 1: Highest ROI (Rich Data, Free APIs, Global or Near-Global)

| Source | Data Available | API | Coverage | Freshness | Commitment Signal |
|--------|---------------|-----|----------|-----------|-------------------|
| **GitHub / GH Archive** | Stars, forks, commit frequency, contributor retention, PR patterns | REST + BigQuery (free 1TB/mo) | Global (100M+ repos) | Real-time | **Very strong** — sustained contribution = deep commitment |
| **OpenAlex** | 250M+ academic works, citations, author profiles, institutional affiliations | Free, no auth needed | Global | Updated daily | **Strong** — citations = peer commitment to ideas |
| **Crossref** | 150M+ DOIs, citation metadata | Free, polite pool | Global | Updated daily | **Strong** — publication persistence |
| **On-chain data (Dune/Flipside)** | DeFi positions, wallet histories, DAO voting, token holding duration | SQL queries (free tier) | Global (blockchain) | Real-time | **Very strong** — money on the line |
| **npm/PyPI downloads** | Download counts by package/version, daily granularity | Free REST API | Global | Daily | **Medium** — reveals dependency commitment |

### Tier 2: Rich Data, Regional (Nordic/EU Focus)

| Source | Data Available | API | Coverage | Signal |
|--------|---------------|-----|----------|--------|
| **Norway BRREG** (Brønnøysund) | Company registration, financial statements, board members, bankruptcies | Free, no auth | Norway (1M+ entities) | **Very strong** |
| **Norway Mattilsynet** (Smilefjes) | Food safety inspection grades, violation history | CSV download | Norway | **Strong** |
| **UK Companies House** | Registration, annual accounts, **Persons of Significant Control** (ownership graph), filing history | Free, API key | UK (5M+ companies) | **Very strong** — PSC creates natural graph edges |
| **Denmark CVR** | Company data, accounting, ownership | Free API (virk.dk) | Denmark | **Strong** |
| **Sweden Bolagsverket** | Company registration, annual reports | Limited API | Sweden | **Medium** |
| **Finland PRH** | Company register, financial data | API (ytj.fi) | Finland | **Medium** |

### Tier 3: Valuable but Harder to Access

| Source | Data Available | API | Coverage | Signal |
|--------|---------------|-----|----------|--------|
| **US SEC EDGAR** | 10-K/10-Q filings, insider trades, institutional ownership | XBRL API (free, 10 req/sec) | US public companies | **Strong** |
| **OpenCorporates** | 200M+ companies across 145 jurisdictions | Paid (free for nonprofits) | Global | **Medium** (aggregator) |
| **EU EFSA / CHEFS database** | 392M analytical results, food safety monitoring across all EU member states | Zenodo download | EU-wide | **Medium** |
| **US FDA / openFDA** | Food inspection classifications, recall data | Free REST API | US | **Medium** |
| **UK Food Standards Agency** | Food hygiene ratings | Free API | UK | **Strong** (similar to Smilefjes) |
| **France Alim'confiance** | Restaurant hygiene ratings | Public web | France | **Strong** |
| **OpenStreetMap** | Map edits, changeset history, contributor patterns | Free API | Global | **Medium** — contribution = commitment |
| **WIPO / USPTO / EPO** | Patent filings, prosecution history | Various APIs | Global | **Medium** — filing = commitment to innovation |
| **App stores** | Ratings, review counts (no official API — scraping required) | Third-party scrapers | Global | **Low-medium** |
| **WHOIS/RDAP** | Domain registration, renewal dates | RDAP protocol | Global | **Low** — registration ≠ commitment |

### Strategic Insight: Where to Start

**The four highest-ROI starting data sources for a global commitment graph:**

1. **GitHub / GH Archive** — Already public, massive, global, behavioral (not opinion-based). Contribution patterns over time are pure commitment signals. Via BigQuery, billions of events are queryable.
2. **On-chain data** — Already public by design. Wallet behavior across DeFi = verified commitment with money on the line. The richest behavioral data that exists, for the crypto-native pioneer community.
3. **Norway BRREG + Mattilsynet** — Home turf advantage. Richest public business data of any country. The "demo country."
4. **UK Companies House** — PSC (Persons of Significant Control) data creates natural graph edges between people and companies. Second-best free business API globally.

**What's NOT globally available (and matters):**
- Consumer transaction data (locked inside Visa/Mastercard/banks — PSD2 unlocks it in EU only)
- Repeat visit data (no public source — this is the core value proposition to collect)
- Real estate transaction histories (varies wildly by jurisdiction)

---

## 3. PROOF OF PERSONHOOD — GLOBAL IDENTITY

### The Landscape (March 2026)

No single identity system covers the planet. The winning architecture is a **credential aggregator**.

| System | Coverage | Strength | Status | Sybil Resistance |
|--------|----------|----------|--------|-------------------|
| **World ID** | 38M enrolled, 160+ countries | Iris biometric + ZK proofs | Live, SDK ready, OIDC compatible | **Very high** (biometric) |
| **BankID Norway** | 4.7M (~84% of population) | NFC verification, zero fraud | Live, mature | **Very high** (bank KYC) |
| **BankID Sweden** | ~8.5M users | Similar to Norway | Live | **Very high** |
| **eIDAS 2.0 / EUDI Wallet** | Mandated for ~450M in EU/EEA | Government-issued, W3C VCs | **Early stage** — Norway in "concept study," deadline Dec 2027 | **Very high** (government) |
| **Aadhaar (India)** | 1.4B+ | Biometric (fingerprint + iris) | Live, domestic use mainly | **Very high** domestically |
| **Human Passport** (ex-Gitcoin Passport) | Crypto-native users | ML-based sybil detection, EigenLayer AVS ($1.4B staked) | Live, evolving | **Medium-high** (composite) |
| **Humanity Protocol** | — | **Pivoted away from PoP** (Feb 2026) → "Proof of Trust" | Changed direction | N/A |

### Key Surprises from Research

1. **Humanity Protocol abandoned Proof of Personhood entirely** (Feb 2026). Pivoted to verifiable credentials ("Proof of Trust"). Even well-funded PoP projects find pure uniqueness-proving harder than expected.

2. **World ID's enrollment-to-DAU gap is 380x**: 38M enrolled, ~100K daily active. Partnerships (Visa, Tinder, Reddit, Telegram) are impressive but usage is thin. Token down 97% from ATH.

3. **Human Passport (ex-Gitcoin Passport)** was acquired by Holonym Foundation. Now runs on EigenLayer AVS with ML-based sybil detection analyzing wallet behavior in real time. Meaningful evolution from stamps-only.

4. **NOBID** (Nordic-Baltic) has a tender out (March 2026) for cross-border digital ID verification. Norway BankID is now under a new company called **Sto AS** after Vipps/BankID merger and demerger.

### Architecture for the Commitment Graph

```
                         ┌─────────────────────┐
                         │  Credential Gateway  │
                         │  "Verified Human"    │
                         └─────┬───────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
      ┌───────▼──────┐ ┌──────▼──────┐ ┌───────▼──────┐
      │  Government   │ │  Biometric  │ │  Composite   │
      │  BankID       │ │  World ID   │ │  Human       │
      │  eIDAS EUDI   │ │  Aadhaar    │ │  Passport    │
      │  Aadhaar      │ │             │ │  (ML-scored) │
      └──────────────┘ └─────────────┘ └──────────────┘

      Nordics/EU         Global bridge    Crypto-native
      (strongest)        (160+ countries) (progressive)
```

**Minimum viable identity for staking behavioral data:**
- **Level 1 (Basic):** World ID or composite identity (Human Passport). Allows read access and limited data contribution. Sufficient for global bootstrap.
- **Level 2 (Verified):** Government digital ID (BankID, eIDAS). Full contribution rights, higher trust weight. Data from Level 2 contributors is weighted more heavily.
- **Progressive identity:** Start at Level 1, strengthen over time. Multiple weak signals compound into strong identity. This is how the network handles regions without government digital ID.

---

## 4. BOOTSTRAP STRATEGIES — WHAT HISTORY TEACHES

### What Actually Works for Behavioral Data Networks

| Strategy | Mechanism | Retention | Relevant Example |
|----------|-----------|-----------|-----------------|
| **Passive contribution + validated demand** | Background process, buyers already exist | **High** | Grass (8.5M nodes, $12.8M/quarter revenue) |
| **Points before tokens** | Accrue value, undefined conversion | **High** | EigenLayer ($15B TVL before token) |
| **Product-first, tokens as bonus** | Real utility, rewards on top | **Medium-high** | Brave (101M users, ad-blocking works alone) |
| **Testnet with mainnet carry-over** | Competition, results count | **Medium-high** | Filecoin Space Race (356 miners, 32 countries) |
| **Near-zero cost + ideology** | Free to participate, belief-driven | **Very high** | Bitcoin (18 months before any value) |
| **Personal onboarding** | Founder does Zoom calls | **Very high** | Farcaster (3,000 individual calls) |

### What Consistently Fails

1. **Token before product.** Ocean (-95%), Streamr (-99.7%), Swash (-99.8%), Datum (-100%). Every tokenized data marketplace that launched incentives before proving demand died.
2. **Supply-side subsidies without demand validation.** Helium deployed 500,000 hotspots generating $6,500/month in real revenue. The Helium Test: *revenue per contributor > cost per contributor, or you've failed.*
3. **Requiring active effort for tiny rewards.** Swash (64K users, pennies earned) vs. Grass (8.5M nodes, passive background process). The difference: contribution passivity and validated buyers.
4. **Pseudonymous data quality.** Ocean couldn't enforce quality without identity. A lemon market where bad data crowds out good.

### The Bootstrap Formula

From the research, the optimal sequence is:

```
Phase 1: PRODUCT (centralized, no token)
├── Build something with single-player utility
├── Data contribution is a passive side effect
├── Validate demand: find one buyer willing to pay
└── Target: 100 true believers

Phase 2: COMMUNITY (points, not tokens)
├── Launch points system (accrue, don't define conversion)
├── Behavioral data "testnet" — competition for data quality
├── Personal onboarding of first 1,000 contributors
└── Target: 1,000 active contributors

Phase 3: NETWORK (progressive decentralization)
├── Launch token only after proven demand
├── Retroactive rewards for Phase 1-2 contributors
├── Open protocol, value capture at AI integration layer
└── Target: 10,000+ contributors, multiple data buyers
```

---

## 5. THE FIRST USE CASE — WHAT MAKES 1,000 USERS STAY

### The Problem at 1,000 Users

At 1,000 users, the network can't:
- Provide statistically meaningful recommendations for most businesses
- Compete with Google or Yelp on coverage
- Offer "better AI answers" for arbitrary queries

At 1,000 users, the network CAN:
- Provide deep behavioral data for specific verticals in specific geographies
- Demonstrate the difference between hallucinated and verified recommendations
- Give each contributor better AI for their own use (single-player mode)

### Single-Player Utility is Everything

The strongest bootstrapping advantage across all studied networks is **single-player utility** — value to the individual before the network reaches critical mass:

- **Brave:** Ad-blocking works alone (101M users)
- **Linux:** Usable OS for one person (100+ developers by 1993)
- **Signal:** Encrypted messaging with one contact is still encrypted
- **Bitcoin:** Store of value for one person (Satoshi, alone, mining for months)

**The commitment graph MUST have single-player utility.** The question: what is it?

### Proposed First Use Case: "Your AI, Your Data"

**The product:** A browser extension (Chrome/Firefox) that passively observes your behavioral patterns — which sites you return to, which services you keep using, which businesses you visit repeatedly — and makes this data available to YOUR AI assistant via MCP.

**Single-player value (Day 1, 1 user):**
- "ChatGPT says Tango Restaurante is great for tapas. Your commitment data shows you've visited 12 times in 6 months → CONFIRMED."
- "Perplexity recommends switching to Notion. Your data shows you've used Obsidian daily for 2 years → CONTRADICTION."
- Your AI becomes personalized to reality, not internet content.

**Multi-player value (at scale):**
- "327 verified users visited this restaurant. 78% returned within 3 months → HIGH COMMITMENT."
- Aggregated behavioral data becomes a trust signal AI systems can query.

**Why this works at 1,000 users:**
- Each user gets better AI from their OWN data immediately (single-player)
- Aggregate data for specific verticals (e.g., restaurants in Stavanger, SaaS tools used by developers) becomes useful at ~100-500 users per vertical
- The extension is free; the product is the improved AI experience

### The "Wow Demo"

The demo that would convince an internet pioneer:

1. **Ask ChatGPT:** "What's the best restaurant in Stavanger?"
2. **Show ChatGPT's answer** (likely hallucinated or based on stale reviews)
3. **Show commitment graph data:** Actual repeat visit rates, financial health from Brønnøysund, food safety from Mattilsynet, cross-referenced with real behavioral data from contributors
4. **The gap** between what AI says and what's actually true IS the value proposition
5. **The punchline:** "Now imagine if YOUR behavioral data made AI tell the truth. And you earned from contributing it."

The equivalent of Bitcoin's first transaction (10,000 BTC for two pizzas) — a concrete, memorable moment that proves the concept works.

### Why Previous Approaches Failed and This Might Not

| Past failure | What went wrong | How this differs |
|-------------|-----------------|-----------------|
| "Own your data" (MIDATA, Polypoly) | Abstract motivation, no killer use case | "Your AI works better" is concrete and immediate |
| Data marketplaces (Ocean, Streamr) | No validated demand, token-first | AI companies are already paying for trust data (Yelp AI API: $25/1K calls) |
| Browsing data monetization (Swash) | Pennies earned, active effort required | Passive collection, value is personal utility not earnings |
| Data cooperatives (CitizenMe) | Chicken-and-egg, no single-player mode | Single-player utility from Day 1 |

---

## 6. GLOBAL MINIMUM VIABLE PROTOTYPE

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CONTRIBUTORS                          │
│                                                         │
│  Browser Extension (passive behavioral data collection)  │
│  ├── Sites visited (frequency, return rate)              │
│  ├── Services used (duration, regularity)                │
│  ├── Purchases (via PSD2 where available)                │
│  └── All processed locally → ZK proofs sent to network   │
│                                                         │
│  Identity Layer (pluggable)                              │
│  ├── World ID (global, Level 1)                          │
│  ├── BankID (Nordic, Level 2)                            │
│  └── eIDAS EUDI (EU, Level 2, when ready)                │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   COMMITMENT GRAPH                       │
│                                                         │
│  Seed Data (public, ingested automatically)              │
│  ├── GitHub contributor patterns (GH Archive/BigQuery)   │
│  ├── On-chain behavioral data (Dune Analytics)           │
│  ├── Norway BRREG + Mattilsynet                          │
│  ├── UK Companies House (incl. PSC ownership graph)      │
│  ├── OpenAlex academic citations                         │
│  └── SEC EDGAR (US public company filings)               │
│                                                         │
│  User-Contributed Data (ZK-verified)                     │
│  ├── Behavioral attestations via zkTLS                   │
│  ├── PSD2 banking data (Nordic/EU)                       │
│  └── App usage patterns                                  │
│                                                         │
│  Aggregation Layer                                       │
│  ├── Hybrid: ZK proofs (input) + TEE (aggregation)      │
│  ├── Differential privacy on outputs                     │
│  └── Trust scores computed per entity                    │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│                    QUERY LAYER                            │
│                                                         │
│  MCP Server (for AI assistants)                          │
│  ├── "What's the commitment score for entity X?"         │
│  ├── "How many verified repeat visitors?"                │
│  └── "Financial health + safety grade + behavioral data" │
│                                                         │
│  REST API (for applications)                             │
│  ├── B2B trust data queries                              │
│  └── Enterprise analytics                                │
│                                                         │
│  Browser Extension UI (for contributors)                 │
│  ├── Trust overlay on AI responses                       │
│  ├── Your personal commitment graph visualization        │
│  └── Points accrual dashboard                            │
└─────────────────────────────────────────────────────────┘
```

### Phase 1: MVP (4-8 weeks, 1-2 developers)

**What to build:**
1. **Chrome extension** (Manifest V3) that:
   - Detects AI response pages (ChatGPT, Perplexity, Gemini)
   - Extracts business/entity names from AI text
   - Shows sidebar with commitment data from public sources
   - Traffic light: 🟢 Verified / 🟡 Limited data / 🔴 Red flags
   - Optionally collects user's own behavioral patterns (opt-in, local-first)

2. **Public data ingestion pipeline:**
   - Norway: BRREG API + Mattilsynet CSV (financial health + food safety)
   - UK: Companies House API (registration + PSC ownership)
   - GitHub: GH Archive via BigQuery (developer commitment signals)
   - Entity resolution: fuzzy matching business names to registry IDs

3. **MCP Server** (the value capture point):
   - AI systems can query commitment data
   - Returns trust scores, repeat visit rates, financial health
   - Free during bootstrap; paid at scale

4. **Identity:** World ID for global, BankID for Nordic (via OIDC)

**What NOT to build in Phase 1:**
- Tokens or tokenomics
- On-chain anything
- Complex ZK circuits
- Staked endorsements
- Mobile app

### Phase 2: Points & Community (Months 3-12)

1. **Points system:**
   - Accrue "Commitment Points" for contributing behavioral data
   - Weighted by identity level (Level 2 BankID = more points than Level 1 World ID)
   - Weighted by data quality (consistent patterns over time > one-time data dumps)
   - No defined conversion rate (EigenLayer model)

2. **Behavioral Data Testnet:**
   - Time-bounded competition (Filecoin Space Race model)
   - Contributors compete on data quality, not volume
   - Top contributors earn "Founder" status with permanent network advantages
   - Regional pools to ensure geographic diversity

3. **Personal onboarding:**
   - Farcaster model: personally onboard the first 1,000 contributors
   - Zoom calls, explain the vision, get feedback
   - Recruit from: Hacker News, Farcaster, open data communities, AI power users

4. **First B2B customer:**
   - Validate demand: find ONE AI company willing to pay for commitment data
   - Even at $1,000/month, this proves the model
   - Yelp AI API ($25/1K calls) proves the market exists

### Phase 3: Protocol (Year 2+)

1. **Progressive decentralization** (a16z framework):
   - Open-source the protocol
   - Community governance for data standards
   - Token launch only after validated demand and active community

2. **Staked endorsements** (Layer 2 on top of behavioral data):
   - "I stake $X that others will also like this restaurant"
   - Resolution via behavioral data (Layer 1 resolving Layer 2)
   - Only after the behavioral data layer is proven

3. **Global expansion** of identity and data sources:
   - eIDAS EUDI Wallet integration (EU-wide, 2027-2028)
   - Additional government registries (EU, Asia-Pacific)
   - PSD2 banking data integration (3,500+ European banks)

---

## 7. THE HARD TRUTHS

### What This Research Confirms

1. **The bootstrapping core is 50-100 people, not 1,000.** Every protocol started with a handful. The question isn't "how do we get 1,000" but "who are the first 50?"

2. **Single-player utility is non-negotiable.** Without it, you're asking people to contribute to an empty network on faith. With it, each contributor gets immediate value.

3. **Demand validation comes before everything.** The Helium test: if you build the supply side without a buyer, you've built nothing. One paying customer > 1,000 free contributors.

4. **Passive contribution beats active contribution 100x.** Grass (8.5M passive nodes) vs. Swash (64K active users). The browser extension must collect data in the background, not ask users to do things.

5. **Every tokenized data marketplace has failed.** This is not a minor detail. Ocean, Streamr, Swash, Datum — all dead or dying. The commitment graph must prove product-market fit before any token discussion.

6. **External shocks are the best growth catalysts** — and they're unpredictable. WhatsApp→Signal, Twitter→Mastodon, Slashdot→Wikipedia. Build the infrastructure and be ready when a major AI hallucination scandal hits.

### What's Still Open

1. **Who is the first paying customer?** AI companies (Yelp model), insurance companies (structural incentive), or something else? This is the most important unanswered question.

2. **Will contributors actually install a browser extension?** The Brave model (101M users) says yes IF the extension has standalone value. The Swash model (64K users) says no if the value proposition is "earn tokens."

3. **Can entity resolution work at scale?** Matching "Tango Restaurante" in AI text to org nr 920123456 in Brønnøysund is solvable. Matching across 145 jurisdictions in OpenCorporates is much harder.

4. **Is the AI hallucination problem urgent enough?** 32% error rate on local businesses is bad, but do consumers care enough to install an extension? Or does the B2B path (selling data to AI companies to fix their own models) bypass this question?

5. **Norway as demo country vs. global from day one?** The concept doc says global. But Norway has the richest public data. Tension: Norwegian data makes the best demo, but "Norwegian product" limits the pioneer pool. **Resolution: Norwegian data as ONE seed among many (GitHub, on-chain, UK, US), not the center.**

---

## 8. THE PLAYBOOK: FIRST 90 DAYS

### Week 1-2: Identify the First 50

- Post the vision on Hacker News, Farcaster, IndieWeb communities
- Frame it as: "We're building the data layer AI needs but doesn't have. Here's how."
- Look for the people who respond with "I've been thinking about exactly this"
- Set up a community space (Discord or Farcaster channel)

### Week 3-6: Build the MVP

- Chrome extension: AI response detection + public data overlay
- Data pipeline: BRREG + Mattilsynet + UK Companies House + GitHub
- MCP server: AI-queryable trust data endpoint
- Identity: World ID integration (simplest global path)

### Week 7-10: Launch to Pioneers

- Personal onboarding (Farcaster model): explain the vision 1:1
- Collect behavioral data opt-in from the first 50 contributors
- Generate the first "AI said X, reality says Y" demonstrations
- Document and share the most compelling discrepancies

### Week 11-12: Validate Demand

- Reach out to 5 potential B2B customers (AI companies, data aggregators)
- Offer free access to the commitment data MCP server
- Ask: "Would you pay for this? How much? What data would you need?"
- One "yes" validates the entire model. Zero "yes" means pivot.

### Ongoing: Be Ready for the Shock

Every network in this research had its breakthrough moment triggered by an external event. For the commitment graph, the shock will likely be a **major AI hallucination scandal** — when AI recommendations cause real harm at scale (wrong medical advice, closed businesses recommended, etc.). Build the infrastructure now. When the shock comes, be the solution that already exists.

---

## Sources & Research Corpus

This document synthesizes findings from:

### Direct Research (This Task)
- Protocol bootstrap histories: Bitcoin, Wikipedia, Linux, Farcaster, Lens, Signal, Mastodon, Brave
- Global commitment data mapping: 15+ countries, 20+ data sources
- Proof of personhood landscape: World ID, eIDAS, BankID, Aadhaar, Human Passport
- Bootstrap incentive strategies: 12 case studies (Bitcoin through Grass)

### Detailed Research Files
- [bootstrap-incentive-research.md](bootstrap-incentive-research.md) — Full analysis of 12 bootstrap strategies with lessons
- [strategy/pagerank-2026-concept.md](strategy/pagerank-2026-concept.md) — Master concept document (three pillars)
- [pagerank-2026-economics.md](pagerank-2026-economics.md) — Business model analysis
- [pagerank-2026-incentive-mechanism.md](pagerank-2026-incentive-mechanism.md) — Earn/lose mechanics
- [pagerank-2026-proof-of-personhood.md](pagerank-2026-proof-of-personhood.md) — Identity landscape
- [pagerank-2026-zk-behavioral.md](pagerank-2026-zk-behavioral.md) — ZK for behavioral data
- [pagerank-2026-product-vision.md](pagerank-2026-product-vision.md) — Product form factors

### Key External Sources
- [GH Archive](https://www.gharchive.org/) — GitHub event data on BigQuery
- [OpenAlex](https://openalex.org/) — Open academic citation data
- [UK Companies House API](https://developer.company-information.service.gov.uk/)
- [openFDA API](https://open.fda.gov/apis/)
- [Dune Analytics](https://dune.com/) — On-chain data
- [OpenCorporates](https://opencorporates.com/) — 200M+ companies, 145 jurisdictions
- [a16z Progressive Decentralization](https://a16zcrypto.com/posts/article/progressive-decentralization-a-high-level-framework/)
- [Farcaster bootstrapping](https://www.alexanderjarvis.com/farcaster-doing-things-that-dont-scale/)

---

*This document answers the question: "How do we get the first 1,000 people worldwide to stake their behavioral data?" The answer: find the first 50 true believers. Build something with single-player utility. Make contribution passive. Validate demand with one paying customer. Then scale.*
