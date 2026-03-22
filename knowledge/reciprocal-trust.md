# PageRank 2026: Reciprocal Trust Networks and Data Cooperatives

*Deep research on opt-in behavioral data sharing as AI trust infrastructure. Created 2026-03-21.*

## Core Thesis

When content is free and meaningless, AI needs access to real human behavior to give good recommendations. The mechanism: people opt in to share behavioral data (transactions, locations, repeat visits, complaints) anonymously into a network. In return, they get the network's collective intelligence. "I share my reality to get better answers."

This is a **sense organ for AI**, powered by human opt-in. Not surveillance — conscious trade.

---

## 1. Who Has Tried This? (Prior Art)

### Personal Data Stores & Sovereignty Initiatives

Every initiative followed the same arc: **bold vision → build technology → consumers don't show up → pivot to enterprise or die.**

| Initiative | Founded | Status (2026) | Peak Scale | What Happened |
|---|---|---|---|---|
| **MyData Global** (Finland) | 2014 | Alive — pivoted to policy advocacy | 120+ orgs, 40+ countries | Never a product. Now focused on EU policy influence. 2025 keynote: "From MyData to MyAI" — AI is the reason personal data infra matters. Published "People-First Playbook" with Sitra (Finnish Innovation Fund). |
| **Solid** (Tim Berners-Lee) | 2016 | Alive under pressure | ~50 employees at Inrupt peak | Personal data "pods" for user-controlled storage. Inrupt (commercial arm) raised ~$30M but revenue modest. Berners-Lee's 2025 book frames pods as way to feed AI without surrendering to platforms. BBC, NHSx, Flemish gov were pilots. |
| **Digi.me** (UK) | 2009 | Likely dead | GBP 23.5M invested | "Consent-based personal data sharing" — app let users import social media, finance, health data. Failed to find sustainable business model. No meaningful web presence by 2025. |
| **Meeco** (Australia) | 2012 | Pivoted to enterprise credentials | Unknown | Abandoned consumer data store. Now builds verifiable credential infrastructure for enterprise customers. Survived by finding B2B buyers. |
| **HAT/Dataswyft** (UK) | 2015 | Pivoted to enterprise | ~$3M raised | Hub of All Things — academic project from Warwick. Spun out as Dataswyft. Shifted from personal data exchange to enterprise data integration. |
| **CitizenMe** (UK) | 2014 | App shut down | 500K users, 10M data transactions | Ethical zero-party data platform. Pivoted entirely to DataSapien (private AI). The best proof-of-concept in the space — and it still died. |

**Pattern:** Privacy alone never motivated consumers. "Own your data" is abstract. The survivors all pivoted to enterprise (B2B) or policy (advocacy). The one that got real consumer traction (CitizenMe, 500K users) still couldn't sustain itself.

**The AI inflection:** The entire space is now converging on AI as the motivation that was missing. Not "protect your privacy" but **"your AI works better with your data."** MyData's 2025 conference theme, Berners-Lee's 2025 book, and multiple academic papers all arrive at the same conclusion.

### Data Cooperatives

None have achieved meaningful consumer scale.

| Cooperative | Domain | Status (2026) | What Happened |
|---|---|---|---|
| **MIDATA** (Switzerland) | Health data | Alive, small | Non-profit cooperative since 2015. Platform by ETH Zurich + BFH. Has data ethics council. Focused on clinical research data contribution. Under 10 employees, <$5M. Healthiest surviving example. |
| **Salus.coop** (Barcelona) | Health data | Quiet | Founded 2017. Citizen-governed health data sharing for research. Small scale, limited visibility. |
| **Driver's Seat** | Gig worker data | Wound down | Aggregated smartphone data from gig workers. Ended up at Princeton as research project. |
| **Polypoly** (Berlin) | General data | Acquired | European data cooperative. Got VC funding, then acquired. Undisclosed revenue. |
| **Swash** | Browsing data | Niche | Pools web surfing data from members. Crypto-adjacent. Small. |
| **Resonate** | Music | Niche | Data cooperative owned by musicians, labels, fans. |

**Core lesson from failures:** Individual data is too low-value to create meaningful per-member payments. You can't compete with "free" platform services. Cooperative governance is too slow for fast-moving tech markets.

### Decentralized Data Marketplaces

Technically further along but economically marginal.

| Project | Status (2026) | Key Insight |
|---|---|---|
| **Ocean Protocol** | Merged into ASI Alliance (with Fetch.AI, SingularityNET) | Real infrastructure, tiny TVL, messy alliance breakup. Data marketplace concept validated but usage negligible. |
| **Streamr** | Pivoting to video conferencing | Impressive engineering, betting everything on StreamrTV pivot. Abandoned data marketplace focus. |
| **Oasis Network** | Best AI-privacy narrative alignment | Privacy-preserving computing. Usage hard to verify. |
| **Grass Network** | 3M+ active nodes | Actually growing — users monetize bandwidth for AI web crawling. $10M raised. DePIN model works when contribution is passive (just install the app). |

**Key observation:** The projects that work (Grass: 3M nodes, Plaid: 200M accounts) all make contribution **passive**. The projects that failed require active effort from users.

### What Actually Moves Data at Scale

| Mechanism | Scale | Why it Works |
|---|---|---|
| **GDPR enforcement** | €5.65B in fines since 2018, €2.3B in 2025 alone | Regulation > voluntary participation |
| **PSD2/Open Banking** | Plaid: 200M accounts globally | Legal mandate forces banks to share |
| **Healthcare interoperability** (US TEFCA) | 9,200 organizations | Government mandate |
| **Loyalty programs** | Starbucks: 34.6M, Sephora: 74M members | Clear value exchange (rewards for data) |
| **EU Data Act** (effective Sept 2025) | EU-wide | Extends data portability beyond personal to IoT/industrial |

---

## 2. The Killer Use Case Problem

### Why Previous Attempts Failed
Previous data cooperative attempts lacked a compelling reason for users to share:
- "Own your data" — abstract, no immediate benefit
- "Protect your privacy" — structural problem framed as individual responsibility
- "Get paid for your data" — individual data worth pennies; Grass pays ~$0.50-2/month

### Is "Better AI Recommendations" the Missing Motivation?

**The timing argument:** Before AI, data cooperatives were abstract. Now there's a concrete benefit: share your data → AI gives you actually good answers instead of SEO-optimized garbage.

**Evidence for:**
- MyData's 2025 theme: "From MyData to MyAI"
- Berners-Lee's 2025 book positions Solid pods as AI infrastructure
- 90% of firms growing privacy/governance functions specifically because of AI (Cisco 2026 study)
- 44% of consumers recognize data transparency as #1 trust driver
- Google declining (-7% unique visitors 2019-2021) as AI answers replace web browsing

**Evidence against:**
- ChatGPT/Perplexity give "good enough" answers from public data alone
- Users already get AI recommendations without sharing anything extra
- The "cold start" benefit gap: early users share but get nothing back

**Assessment:** AI is the strongest motivator data cooperatives have ever had. But the benefit must be **immediate and visible** — not a promise of future intelligence. The winning formula is likely: import your existing data (bank transactions, Google Takeout) → see useful recommendations within minutes → then contribute ongoing data passively.

---

## 3. Technical Architecture: What's Practical Today?

### Pragmatic Path for Small Team (2-5 Engineers, 6-12 Months)

**Recommended stack:** Differential Privacy + Federated Learning + Secure Aggregation

| Technology | Readiness | Use Case | Small Team Feasibility |
|---|---|---|---|
| **Differential Privacy** | ✅ Production-proven | Add noise while preserving statistical value | **YES.** Libraries: OpenDP, Google's DP library, PipelineDP. Apple uses ε=4-8, Google ε=2-16. At ε≈2, ML models lose only ~4.7% accuracy. |
| **Federated Learning** | ✅ Production-proven | AI learns from user data without data leaving device | **YES.** Google (Gboard, Chrome), Apple (on-device ML) deploy at scale. Cross-device FL for behavioral preferences is feasible. Key challenge: model poisoning attacks. |
| **ZK Proofs** (attestations) | ⚠️ Ready for simple proofs | "I visited this restaurant" without revealing identity | **PARTIAL.** Semaphore V4: 192-byte proofs, 3ms verification, runs in-browser. Groth16: ~1s in browser, ~100-270ms native. Good for identity attestation, not for complex computations. |
| **Secure Multi-Party Computation** | ⚠️ Ready for specific use cases | Multiple organizations pool data securely | **PARTIAL.** Works for cross-organization analytics. Platforms: Sharemind, SPDZ. Good alternative to FL for enterprise data pooling. |
| **Homomorphic Encryption** | ❌ Not ready for this use case | Compute on encrypted data | **NO.** Still 1000-10,000x slowdown. CNN inference over FHE takes minutes vs milliseconds. GPU acceleration helping but not sufficient for real-time recommendations. |

### ZK and GDPR — Critical Legal Finding

ZKPs are classified as enabling **pseudonymization**, not full anonymization under current GDPR interpretation. Pseudonymized data still counts as personal data under GDPR. This means:
- ZK-processed behavioral data likely still falls under GDPR
- INATBA position paper addresses "right to be forgotten" challenges
- Interactive ZKPs give data subjects more control (prover must actively enable verification)
- **The legal landscape is evolving** — standardization bodies and GDPR compliance auditors must continuously reassess

### Practical Recommendation

```
Phase 1 (Months 1-6):  DP + centralized aggregation
Phase 2 (Months 6-12): Add federated learning (data stays on device)
Phase 3 (Year 2):      ZK attestations for identity + trust signals
Phase 4 (Year 2+):     MPC for cross-organization data pooling
```

Never: FHE for recommendation systems (wait 3-5 years).

---

## 4. Behavioral Data Types: Inventory

### The Data Landscape

| Data Type | Where It Lives | Exportable? | Privacy Sensitivity | Recommendation Value | Technical Feasibility |
|---|---|---|---|---|---|
| **Transaction/Payment** | Banks, Vipps, cards | ✅ PSD2 mandates API access | Medium | ★★★★★ Highest | ✅ Legal pipes exist in Norway |
| **Location/Movement** | Google, Apple, carriers | ⚠️ Google Takeout (JSON), Apple limited | High | ★★★★ Very high | ⚠️ Locked by platform design |
| **Search/Browsing** | Google, browsers | ⚠️ Takeout, browser local | Medium-High | ★★★★ Intent data = gold | ⚠️ Export exists, format varies |
| **Booking/Appointments** | Calendar, booking platforms | ⚠️ Calendar export (ICS) | Medium | ★★★ Rebook = loyalty | ⚠️ Fragmented across platforms |
| **App Usage** | Apple Screen Time, Google | ⚠️ On-device only | Medium | ★★★ Engagement signal | ❌ No API export |
| **Reviews/Ratings** | Google, Yelp, Trustpilot | ⚠️ Business APIs, not user APIs | Low | ★★★ Explicit trust | ⚠️ Scraping required for users |
| **Communication (metadata)** | Telcos, messaging apps | ❌ Restricted by law | Very High | ★★ Social graph | ❌ Legal barriers |
| **Health Data** | Apple Health, providers | ⚠️ FHIR standard emerging | Highest | ★★ Narrow domain | ⚠️ Legal complexity |
| **Return/Complaint** | E-commerce, retailers | ❌ No standard export | Medium | ★★★★ Strong negative signal | ❌ Locked in platforms |

### Critical Insight: PSD2 is the Only Ready Pipe in Norway

Transaction data via PSD2/Open Banking is the **only category** where all pipes exist:
- ✅ Legal framework (PSD2, implemented in Norway 2019)
- ✅ Standardized APIs (XS2A interface, each bank provides)
- ✅ Licensed intermediaries (Neonomics in Norway, Plaid globally)
- ✅ User-familiar consent flows (BankID for authentication)
- ✅ Rich behavioral signal (where you spend = what you value)

Everything else requires either scraping, manual effort, or waiting for platform cooperation.

### GDPR Data Portability Reality Check

**Article 20** (right to data portability) explicitly **excludes inferred and derived data.** The algorithms' conclusions — taste profiles, predicted preferences, behavioral segments — are the exact data most valuable for a recommendation network, and they are the one category that is legally not portable. You can export your raw transaction history, but not what Google/Amazon infers from it.

**Data Transfer Project** (Google, Apple, Meta, Microsoft, Twitter): Enables direct provider-to-provider transfer, but scope limited to photos, contacts, calendars. Not behavioral data.

---

## 5. Network Effects and Cold Start

### How Many Users Do You Need?

| Benchmark | Users | Context |
|---|---|---|
| Tinder campus launch | 500 | One campus, critical mass for dating |
| Waze city-level usefulness | ~3,000 | Traffic data becomes reliable |
| Nextdoor neighborhood launch | ~300-500 per neighborhood | Hyperlocal information network |
| Small community platforms | <5,000 | 33% active participation (not the dreaded 1%) |
| **Stavanger estimate** | **2,000-5,000** active users sharing spending data | Produces genuinely useful local recommendations |

### Why the Numbers Are Lower Than Expected

For a **local recommendation network** (not a global social network):
- Geography concentrates value. 1,000 users in Stavanger > 100,000 spread globally.
- Transaction data is dense. One user's Vipps history = hundreds of implicit "reviews" per year.
- Collaborative filtering works with sparse data. Netflix Prize showed ~20 ratings per user sufficient.

### Bootstrapping Strategy

**What wins:** Passive data collection (Waze model — using the app IS contributing).

**What fails:** Active contribution (Foursquare check-ins — requiring conscious effort).

**Recommended approach:**
1. **Import existing data** — Vipps/bank exports via PSD2, Google Takeout location history
2. **Passive ongoing collection** — Transaction notifications, location in background
3. **Seed with public data** — Google Reviews, Mattilsynet (food safety), Brønnøysund (company data)
4. **Start with one category** — Restaurants in Stavanger. Expand from "white hot center."

### No Nordic Incumbent

No hyperlocal recommendation network exists in Scandinavia. Google Maps/Reviews holds the space **by default, not by purpose-built dominance.** A cooperative with real transaction data (not just star ratings) would have a structurally different and arguably better signal.

**The Vipps analogy:**
- Vipps: 4.2M users in Norway (78% of population). Backed by Norwegian banks.
- Vipps solved cold start via bank backing and instant P2P transfers
- Could a data cooperative **piggyback on Vipps's user base** via PSD2 access?
- PSD2 access goes through underlying banks (DNB, Eika, etc.), not Vipps directly
- But BankID (used by Vipps) provides the identity/consent layer

---

## 6. Business Models

### The Hard Truth

**No data cooperative has achieved profitability.** MIDATA: <$5M, <10 people. Driver's Seat: ended at Princeton. Polypoly: acquired. CitizenMe: shut down app. This is genuinely uncharted territory.

### The Viable Path: Sell Intelligence, Not Data

The data stays with users. The **derived intelligence** is the product. This is exactly how Google works — they don't sell your data, they sell intelligence derived from it. A cooperative can replicate this without becoming Google by keeping the intelligence open and the governance cooperative.

**Credit union analogy:** Members pool a resource (data instead of deposits). The cooperative derives value from the pool (intelligence instead of interest income). Surplus flows back to members.

### Revenue Streams (Ranked by Viability)

| Stream | Pricing Benchmark | Viability |
|---|---|---|
| **AI company API access** (MCP server) | $0.01-$0.50/query. At 1M queries/month = $10K-$500K/month | ★★★★★ Best capture point |
| **Business analytics** ("87% of verified users who tried A also went to B") | Nielsen: $110K-$380K/yr per client | ★★★★ Proven market |
| **AI training data licensing** | $2.5B market now, projected $30B. Consent-based data increasingly premium | ★★★★ Growing fast |
| **Freemium consumer** (basic insights free, premium paid) | $5-15/month for premium recommendations | ★★★ Supplements, not sustains |
| **Business verification** (businesses pay to be "verified trusted") | $50-500/month | ★★ Risk of conflicts with trust |

### Legal Structures

| Structure | Fit | Notes |
|---|---|---|
| **Samvirkeforetak** (Norwegian cooperative) | ★★★★★ | Strong Nordic cooperative tradition. Tax advantages. Member governance built-in. |
| **SA + AS hybrid** | ★★★★ | Cooperative owns protocol/data, commercial company sells intelligence. Element/Matrix model. |
| **B Corp** | ★★★ | Social enterprise status. Can take investment. Less cooperative governance. |
| **Foundation + company** | ★★★★ | Non-profit foundation owns spec. Company monetizes. Linux/Red Hat model. |

### Nordic Funding Landscape

| Source | Amount | Relevance |
|---|---|---|
| **SkatteFUNN** | 19% back on up to NOK 25M R&D costs | Direct subsidy for building FL platform |
| **Innovation Norway** | Grants + loans for innovative startups | Data cooperative = innovation project |
| **Research Council of Norway** | Major research grants | Privacy-preserving AI = hot topic |
| **Nordic Innovation** | Cross-Nordic collaboration funding | Expand to Denmark (MobilePay), Sweden (Swish) |
| **EU Horizon Europe** | Large grants for data governance | Data cooperatives are an EU policy priority |

**Realistic funding runway:** 3-5 years of grants + investment before revenue covers costs.

### The Wikimedia Parallel

Wikimedia Foundation: $185M/yr revenue, 8M donors, average donation $10.58. Sustained by grassroots fundraising + Wikimedia Enterprise ($3.4M/yr from big reusers like search engines). **The same model could work:** free for members, enterprise pricing for AI companies who query the trust graph.

---

## 7. Synthesis: What's Different This Time?

### Why Previous Data Cooperatives Failed

1. **No killer use case.** "Own your data" = abstract. No immediate benefit.
2. **Active contribution required.** Users had to DO something. Friction killed adoption.
3. **No technical infrastructure to make data useful.** Before FL/DP, sharing data = losing privacy.
4. **No buyer for the intelligence.** Before AI, who would pay for behavioral insights at cooperative scale?
5. **Governance too slow.** Cooperative decision-making vs. VC-backed competition.

### What's Structurally Different Now

1. **AI IS the killer use case.** "Your AI works better with your data" is concrete, immediate, and getting more true every day.
2. **PSD2 makes transaction data passive.** Connect your bank once → data flows automatically. Waze model, not Foursquare model.
3. **Privacy tech is production-ready.** DP + FL enable "share everything, reveal nothing." This was theoretical in 2015; it's deployed by Apple/Google today.
4. **AI companies are the buyers.** The MCP server model creates a natural market: AI companies pay to query real behavioral data instead of hallucinating recommendations.
5. **Regulation is tailwind.** EU Data Act, GDPR enforcement (€2.3B/yr), growing AI Act requirements all push toward consent-based data sharing.
6. **Nordic structural advantages.** BankID (identity), Vipps (payments), PSD2 (data access), high digital trust, cooperative tradition, SkatteFUNN (R&D subsidy).

### The Remaining Hard Problems

1. **Cold start benefit gap.** Early users share but get little back. Must seed with public data.
2. **GDPR treats ZK-processed data as pseudonymized, not anonymous.** Still personal data. Legal compliance required.
3. **Inferred/derived data is not portable.** The most valuable behavioral intelligence is locked in platforms by GDPR Article 20's exclusion.
4. **No profitable precedent exists.** Every data cooperative to date has failed financially. This would be the first.
5. **Platform counter-moves.** Google, Apple, Meta could lock down data export further. Race condition.

### Minimum Viable Product

**City:** Stavanger (140K population, ~78% Vipps penetration, dense enough for local recommendations).

**Data source:** Vipps/bank transactions via PSD2 (AISP license required).

**Identity:** BankID (proof of personhood, Norwegian residents only to start).

**First use case:** "Where should I eat?" — restaurant recommendations based on real spending patterns of people like you.

**Target:** 2,000-5,000 active users sharing transaction data. At 300 restaurants in Stavanger, that's 7-17 users per restaurant — enough for meaningful collaborative filtering.

**Revenue from day one:** No. Grant-funded for 2-3 years. First revenue from AI API access once network has 10K+ users.

---

## 8. Open Questions for Hakkon

1. **Should this be a product, a protocol, or a research project?** A product (app) gets users. A protocol (open spec) prevents capture. A research project (grants) gets funded. Probably need all three, phased.

2. **AISP license — who gets it?** Becoming a registered AISP requires eIDAS certificate, FSA approval. Build it yourself or partner with Neonomics (existing Norwegian AISP)?

3. **One city or pan-Nordic?** Stavanger to start (density), but the protocol should work in any Nordic city. Denmark (MobilePay) and Sweden (Swish) have equivalent payment infrastructure.

4. **Commercial company, cooperative, or both?** The Element/Matrix model (cooperative/foundation owns protocol, company sells intelligence) has the best track record. But it's hard to run both simultaneously.

5. **Is this the thing to build, or is this the insight that informs what to sell?** The insight (behavioral data as AI trust signal) could be commercialized through Synlig Digital (AEO + trust analytics) without building the full cooperative infrastructure.

---

*Sources: MyData Global (mydata.org), Inrupt/Solid (solidproject.org, inrupt.com), Digi.me, Meeco, Dataswyft/HAT, CitizenMe, MIDATA.coop, Salus.coop, Driver's Seat Cooperative, Ocean Protocol, Streamr, Grass Network, Wikimedia Foundation Annual Report 2023-2024, INATBA ZKP Position Paper, Semaphore V4, OpenDP, Google Federated Learning, PSD2/EBA RTS, GDPR Article 20, Neonomics, NFX Network Effects Bible, Nielsen pricing, Cisco 2026 Data Privacy Benchmark, EU Data Act, SkatteFUNN, Innovation Norway.*
