# PageRank 2026: Outcome-Based Trust Graphs

*Deep research. Created 2026-03-21. Covers four angles: outcome data inventory, who's building this, user-facing trust signals, and connection to our work.*

---

## The Core Question

PageRank solved "who matters when anyone can publish" by using links as trust votes. Content production is now free with LLMs. What is the equivalent trust mechanism when both content and links are machine-generated?

**Thesis:** Verified real-world outcomes — what actually happened when someone used a product or service — are the unfakeable signal. A repeat purchase is stronger than a thousand five-star reviews. A pattern of returns is a stronger warning than any negative article.

---

## 1. OUTCOME DATA INVENTORY

### What existing outcome data could form a trust graph?

| Data Type | Signal Strength | Accessibility | Privacy | Who Owns It | Key Barriers |
|---|---|---|---|---|---|
| **Transaction/Payment** | ★★★★★ | ★★★★ (PSD2) | Medium | Banks, Vipps | AISP license required; Neonomics covers 3,500+ banks |
| **Verified Purchase Reviews** | ★★★★ | ★★★ | Low | Amazon, Trustpilot, Google | Platform APIs restricted; scraping possible but fragile |
| **Food Safety Inspections** | ★★★★ | ★★★★★ | None | Mattilsynet (Norway) | Free API, structured JSON, grading 0-3, linked to Brønnøysund org numbers |
| **Business Registry** | ★★★ | ★★★★★ | None | Brønnøysund (Norway) | Free REST API, NLOD license, real-time search, full downloads |
| **Booking/Repeat Visit** | ★★★★★ | ★ | Medium | Booking.com, Airbnb, OpenTable, Resy | Completely locked. No export APIs for consumer behavior. Strongest signal, worst access |
| **Return/Complaint** | ★★★★ | ★ | Medium | E-commerce platforms | No standard export. E-commerce returns ~20% average, 30-40% apparel. Locked in platforms |
| **Foot Traffic/Visit** | ★★★★ | ★★★ | High | Google (Popular Times), Placer.ai, SafeGraph | Commercial data products. Google aggregates but doesn't expose raw. SafeGraph sells foot traffic |
| **IoT/Sensor (EU Data Act)** | ★★★ | ★★★ (from Sept 2026) | High | Device manufacturers → users | EU Data Act mandates access-by-design from Sept 12, 2026. Connected vehicles, smart home, wearables. Users get export rights + third-party sharing rights |
| **Health Outcomes** | ★★★★★ | ★★ | Highest | Hospitals, RWE databases, HCCI | HIPAA/GDPR special category. HCCI covers 1/3 US ESI population. Norway: Norsk pasientregister |
| **Insurance Claims** | ★★★★ | ★★ | High | Insurers, Verisk (1,850+ contributors) | ClaimSearch requires credentials. Loss ratio data public at state level (US). Norway: Finans Norge aggregates |
| **Conversion/Engagement** | ★★★ | ★ | Medium | Google Analytics, ad platforms | Aggregated only. No individual-level export. GA4 privacy changes further restrict |
| **Court Records** | ★★★ | ★★★ | Low | Lovdata (Norway) | Free API for laws. Court decisions: free from 2008 (Supreme Court), full access via LovdataPro subscription |

### The Norwegian Advantage

Norway has uniquely strong public outcome data infrastructure:

1. **Mattilsynet Smilefjes API** — Food safety inspection results for every restaurant/café, structured JSON, grading scale 0-3, linked to business registry org numbers. Free, real-time (within 5 business days). Open source frontend on GitHub.

2. **Brønnøysund REST API** — Complete business registry. Roles, ownership, beneficial owners, subsidies, financial data. Free, NLOD license, real-time search. Covers Norway + Nordic cross-search (Sweden, Finland, Iceland).

3. **BankID** — 4.6M users (virtually all adults). OIDC standard. ~1-2 NOK per auth. Transitioning to Stø AS single issuer (April 2026).

4. **PSD2/Open Banking** — Legal mandate for transaction data access via AISP license. Neonomics aggregates 3,500+ banks. Fields include: merchant name, category code, amount, date, account info.

5. **SSB (Statistics Norway)** — Open APIs for statistical data. No registration required.

### Critical Gap: The Feedback Loop

**No system currently connects "this AI recommendation was made" → "here is the verified real-world outcome" → feeds back into recommender's trust score.** Every existing system proves either provenance (where something came from) or identity (who did it). None proves outcome quality (did it work?).

### PSD2 Transaction Data — What You Actually Get

Via PSD2 AISP APIs, you can access:
- Transaction date, amount, currency
- Merchant name and category code (MCC)
- Account balance
- Remittance information

What you CAN'T get:
- What specific items were purchased
- Whether items were returned
- Customer satisfaction
- Repeat visit frequency (derivable from repeated merchant transactions)

**Repeat merchant transactions are the best available proxy for satisfaction.** If someone keeps going back to the same restaurant via Vipps, that's a stronger signal than any review.

---

## 2. WHO IS BUILDING THIS?

### Attestation Infrastructure (Production-Ready)

| Project | What It Does | Stage | Relevance |
|---|---|---|---|
| **EAS (Ethereum Attestation Service)** | Open-source attestation infra. Two contracts: schema registration + attestation creation. On-chain or off-chain | Production (attest.org) | Foundation for outcome attestations |
| **EAS Transitive Trust SDK** | TypeScript implementation of transitive trust graph with positive/negative edge weights. Improvement over EigenTrust — resistant to collusion, genuine endorsements only | Released Dec 2025 | Direct building block for trust computation from outcome attestations |
| **Verax Protocol** | Cross-chain attestation aggregation | Production | Composable attestation layer |
| **Coinbase Verifications** | On-chain identity attestations | Production | Identity verification for trust graph |
| **Reclaim Protocol** | ZK proofs from any HTTPS source (zkTLS). Proves data from any website without platform cooperation | Production | **Most promising primitive** — can verify outcome data portably |

### Trust Computation Systems

| Project | Mechanism | Stage | Relevance |
|---|---|---|---|
| **AgentRank (Hyperspace AI)** | PageRank adapted for autonomous agents. Cryptographic proof-of-computation anchors endorsements. Sybil-resistant (linear cost scaling, no economies of scale). Published March 15, 2026 | Paper + implementation | Direct parallel to our thesis — but for agents, not humans |
| **OpenRank (Karma3 Labs)** | EigenTrust on Farcaster/Lens social graphs. $4.5M seed. ZK-verifiable computation | Production | Trust graph computation over social data |
| **EigenTrust++** | Georgia Tech enhancement of original EigenTrust | Research | Improvements on trust propagation |

### Identity/Verification Layer

| Project | Scale | Mechanism | Relevance |
|---|---|---|---|
| **World ID** | 38M app users, 15M+ Orb-verified | Iris biometric + ZK proofs | Proof of personhood at global scale |
| **World ID Agent Kit** | March 2026 launch | Links Orb-verified identity to AI agents | Agent-to-human trust bridge |
| **eIDAS 2.0 EUDI Wallet** | ~450M potential (EU/EEA) | Government-backed digital identity wallets, deadline end of 2026 | The "global unlock" for trusted identity |
| **Human Passport (Holonym)** | 2M+ users (acquired Gitcoin Passport Feb 2025) | Multi-signal "stacked attestations" | Composable identity scoring |

### AI Citation Transparency

| Platform | Approach | Source Concentration | Key Finding |
|---|---|---|---|
| **Perplexity** | Inline numbered citations by default. ~9x more sources per response than Copilot | Reddit (46.7% of top-10 citations) | Citation as core product feature |
| **ChatGPT Search** | Inline citations + hover panel. Available to all users (Feb 2025) | Wikipedia (47.9% of top-10). Top 20 news sources = 67.3% of all citations | Winner-take-all citation dynamics |
| **Google AI Overviews** | Source list with AI Overview. 76-93% from organic top 10 | Reddit (2.2%). More distributed | Leverages existing search ranking |
| **Claude** | No browsing by default. Cites user-generated content at 2-4x rate of others | UGC-heavy | Constitutional AI → heavier reliance on reviews |
| **Exa** | 96% citation accuracy. Semantic search | N/A | Research-grade citation quality |

**Key finding:** 90% of pages ChatGPT cites rank position 21+ on Google. AI platforms draw from a fundamentally different authority pool than traditional search.

**Citation volatility is extreme:** ChatGPT cited Reddit in ~60% of responses in early August, collapsed to ~10% by mid-September. Same query returns same brand list less than 1% of the time. AI Overview content changes 70% for same query, 45.5% of citations replaced each regeneration.

### The Missing Layer

**"Proof of outcome" or "proof of experience" does not exist as a named project or protocol.** The concept exists as whitespace between converging layers:

1. Reclaim Protocol can verify outcome data from any website via zkProof
2. EAS Transitive Trust SDK provides trust propagation from attestations
3. AgentRank ranks agents by what the network relies on them for
4. x402 + World AgentKit create transactional substrate where agent outcomes could be measured

Nobody has connected: AI recommendation → verified outcome → feedback into trust score.

### Coalition for Trusted Reviews

Amazon, Booking.com, Expedia, Glassdoor, TripAdvisor, and Trustpilot launched a **Global Coalition for Trusted Reviews** (October 2023). Booking.com has "300M+ verified reviews from real guests" with ML fraud detection. But this is industry self-regulation, not an open protocol — and it doesn't connect reviews to outcomes.

---

## 3. USER-FACING TRUST SIGNALS

### How Humans Currently Evaluate AI Recommendations

**Global trust in AI is low (~46%)** but rising with familiarity. 56% of users accept AI outputs without verification. Younger users (18-30) are significantly more trusting.

#### The Transparency Paradox

**The most important finding from 2025 research:** More transparency is NOT always better. Multiple studies confirm an **inverted-U relationship** between explanation depth and trust:

- Too little transparency → suspicion
- Optimal transparency → calibrated trust
- Too much transparency → cognitive overload, DECREASED trust

"You can say too much and too little at the same time" (HBR, January 2026). AI disclosure can paradoxically erode trust — even phrases like "reviewed by a human" or "used only for grammatical correction" trigger negative bias (Schilke & Reimann, 2025).

**Implications for outcome-based trust signals:**
- Don't explain the algorithm. Show the result: "87% of people who followed this recommendation were satisfied."
- Use progressive disclosure: simple signal first, detail on demand.
- External trust signals (certifications, institutional reputation) may outperform detailed explanations.

#### Trust Signal Hierarchy (What Actually Works)

| Signal Type | Trust Impact | Evidence |
|---|---|---|
| **Personal network recommendation** | Highest | 92% trust peer recommendations over advertising. Relationship-weighted > raw social graph |
| **Verified outcome data** | Very high | "95% satisfaction among verified users" — nobody does this for AI yet |
| **Verified purchase/stay badge** | High | Reviews increase conversion 270%. BUT perfect 5-star DECREASES conversion by 12% vs 4.2-4.5 |
| **Aggregate rating + volume** | High | 98% of customers identify trust symbols that increase purchase likelihood |
| **Real-time social proof** | Medium-high | "X people looking at this" increases conversions 18% |
| **Source citation** | Medium | Matters for credibility but citation volatility undermines reliability |
| **Expert/institutional endorsement** | Medium | More effective for sophisticated users |
| **Confidence indicator** | Medium | "High confidence" vs "AI guess" tags. Interfaces implying certainty lose trust faster when wrong |

#### What's Missing: Outcome-Based Trust Signals for AI

Nobody currently shows: **"87% of people who followed this AI recommendation were satisfied."**

This is the novel trust signal for AI-first discovery. Amazon proved authenticity through imperfection (4.2-4.5 beats 5.0). But for AI recommendations specifically, there's no feedback loop — no "did this recommendation actually work?"

#### Existing Product Patterns

**Social proof patterns that work:**
- **Booking.com:** Dynamic text ("X people looking," "X booked in last hour"). Combined with 300M+ verified reviews. "Friends' reviews" most influential factor.
- **Amazon:** "Verified Purchase" badge. Perfect 5-star ratings decreased conversion by 12%.
- **Google Maps:** "For You" tab, group planning with emoji voting, Local Guides follow feature.
- **Friendspire/Friends Recommend:** Friend-powered recommendations for restaurants, movies, books.
- **Airbnb (2025):** "Who's Going" feature for Experiences. "Connections" section for people who shared experiences. Future recommendation potential from relationships.
- **Spotify Jam:** Combined taste profiles of actual friends during sessions.

**Relationship-weighted recommendations:**
- Netflix tried and failed (2004-2010): raw social graph without relationship-strength weighting doesn't work.
- Research consensus: trust relationship is MORE important than social relationship alone, but they're complementary.
- Collaborative filtering with trust propagation (SocialMF, FTRA) substantially outperforms CF alone on cold-start and sparsity problems.

#### Explainable AI — Current UI Patterns

| Pattern | Example | Effect |
|---|---|---|
| **"Why this?" links** | Zaplify tooltips | On-demand reasoning without clutter |
| **Confidence indicators** | "High confidence" / "AI guess" tags | Calibrates expectations |
| **Expandable rationale chips** | Reveal reasoning on demand | Progressive disclosure |
| **Live previews** | Shopify Magic, GitHub Copilot | Editable shows what's AI vs user |
| **Risk-level color coding** | Tromzo/Polaris security cards | Visual priority tracking |

#### Citation Approaches Compared

| Platform | Format | Transparency | User Experience |
|---|---|---|---|
| **Perplexity** | Inline numbered citations linking to sources | High — every claim sourced | Best for verification-oriented users |
| **ChatGPT Search** | Inline citations + hover for details + Sources panel | Medium — sometimes blends training data with web | Good balance of fluency and sourcing |
| **Google AI Overviews** | Source list alongside overview, not always inline | Medium — draws from organic top 10 | Familiar for Google users |
| **Claude** | No default browsing; cites when given source material | Low — relies on training data | Most cautious; highest UGC citation rate when searching |

---

## 4. CONNECTION TO OUR WORK

### Synlig Digital — AEO as Primitive Trust Graph

The AEO citation tracker (`runner.ts`, citation checker, Turso `aeo_audits` + `aeo_tracked`) **is already a primitive version of the outcome-based trust graph:**

- It tracks which AI models cite which businesses → the citation graph
- It measures changes over time → trust trajectory
- It identifies what makes businesses get cited → trust factors

**The citation graph is invisible to everyone else.** Whoever maps it first has enormous information advantage. Scale the AEO tracker up = **Ahrefs for AI citations.**

**Product opportunity ladder:**
1. **Today (Synlig Digital):** Help businesses climb the AI citation graph. Consultant position. Immediate revenue.
2. **Near-term (Scaled tracker):** Map the entire AI citation graph for Norway → Nordics → globally. Infrastructure position. SaaS product.
3. **Long-term (Protocol):** Build the outcome layer that sits beneath citations — not just "who gets cited" but "who actually delivers." Protocol position.

**Concrete next step:** The AEO tracker already stores citation data in Turso. Adding an outcome signal (did the cited business actually satisfy the customer who followed the AI recommendation?) would be the first implementation of the missing feedback loop.

### AgentLair — Agent Trust Infrastructure

AgentLair's positioning as "the infrastructure that makes agents legit" maps directly to the trust graph for AI agents:

| AgentLair Feature | Trust Graph Role |
|---|---|
| **Email identity** | Verifiable agent identity (Layer 1 of trust protocol) |
| **Vault (ZK-encrypted secrets)** | Secure credential storage for trust attestations |
| **API key provenance** | Human-to-agent accountability chain |
| **Audit trail** | Verifiable agent behavior history |
| **Calendar** | Verifiable agent commitments and follow-through |

**AgentRank (Hyperspace, March 2026)** ranks agents by what the network relies on them for — this is exactly what AgentLair's identity infrastructure enables. An agent with a verified AgentLair identity, credential history, and behavior trail has the building blocks for trust graph participation.

**Concrete opportunity:** AgentLair could integrate with EAS to issue attestations about agent behavior (uptime, response quality, task completion). These attestations feed into trust computation (EAS Transitive Trust SDK or OpenRank).

### ERC-8004 — On-Chain Agent Identity Standard

ERC-8004 provides:
- Agent registration at `.well-known/agent-registration.json`
- Reputation scoring (fixed-point `value: int128, valueDecimals: 0-18`)
- Feedback tags for multi-dimensional measurement
- Anti-Sybil: weight feedback by reviewer reputation
- Validation: stake-secured re-execution, zkML proofs, TEE oracles

**ERC-8004 is the identity primitive for agents in the trust graph.** Combined with EAS attestations for behavior/outcomes and Transitive Trust SDK for score propagation, it creates a complete trust infrastructure stack for AI agents.

### The Product Opportunity: Building the Outcome Graph

**Three "two guys in a garage" versions:**

#### Version A: AEO Citation Graph as SaaS (Smallest swing, most immediate)
- Scale the citation tracker to cover every business in Norway
- Sell dashboard access to businesses and agencies
- Add competitive citation intelligence
- Revenue: SaaS subscription ($50-200/month per business)
- Timeline: 3-6 months

#### Version B: AI Recommendation Feedback Loop (Medium swing)
- Build a browser extension or app that lets users rate AI recommendations
- "Did this recommendation work?" → simple thumbs up/down after following an AI suggestion
- Aggregate outcome data per business/product
- Expose via MCP server to AI models
- Revenue: API access fees from AI companies
- Timeline: 6-12 months

#### Version C: Reciprocal Behavioral Trust Network (Biggest swing)
- Users opt-in to share transaction data (PSD2) + rate outcomes
- BankID for identity, ZK for privacy
- TEE + DP for aggregation
- MCP server exposing trust data to AI models
- Revenue: AI company API access + enterprise analytics
- Timeline: 12-24 months, grant-funded initially
- See: `/workspace/memory/knowledge/strategy/pagerank-2026-concept.md`

**These aren't mutually exclusive.** Version A funds learning. Version B builds the dataset. Version C is where it all leads.

---

## 5. NON-OBVIOUS INSIGHTS

### 1. The Absence of Negative Outcome Data is the Biggest Structural Gap

Returns (20-24% of e-commerce), cancellations (17% of restaurant bookings), insurance claims — all are powerful negative trust signals. All are completely locked in platforms with no export standard. GDPR Article 20 explicitly excludes inferred/derived data from portability. The most valuable behavioral intelligence is legally locked.

### 2. Citation Volatility Undermines Content-Based Trust

AI citation patterns change dramatically week to week (ChatGPT's Reddit citations: 60% → 10% in one month). Same query returns same brand list less than 1% of the time. This means citation-based trust is inherently unstable. **Outcome data doesn't have this problem** — a repeat purchase is a repeat purchase regardless of which AI cited the business.

### 3. The Transparency Paradox Favors Simple Outcome Signals Over Complex Explanations

Research shows that detailed AI explanations can backfire. Simple, verifiable outcome signals ("87% satisfaction among verified users") align with the inverted-U transparency curve better than complex citation chains or algorithm explanations.

### 4. Booking/Repeat-Visit Data is the Strongest Signal with Worst Access

Repeat patronage = strongest possible trust signal. But Booking.com, OpenTable, Resy, Airbnb all keep this data locked. The EU Data Act (Sept 2025/2026) creates legal right to IoT data export but doesn't cover booking platform data. PSD2 transaction data is the best available proxy (repeated merchant transactions indicate repeat visits).

### 5. Norwegian Public Data Could Seed the Cold Start

Mattilsynet Smilefjes (food safety inspections) + Brønnøysund (business registry) + BankID (identity) = a bootstrapping stack that exists nowhere else:
- Food safety grades are real-world outcome signals (government verified)
- Business registry provides entity resolution
- BankID provides proof of personhood
- All have free APIs
- Cold start problem becomes: combine public outcome data (food safety) with private outcome data (transactions) to create useful recommendations from day one

### 6. The "Two Guys in a Garage" Version is the Browser Extension

The simplest version of an AI recommendation feedback loop:
1. User installs browser extension
2. Extension detects when user follows an AI recommendation (clicks a cited link from Perplexity/ChatGPT/etc.)
3. After the user completes the action (visits restaurant, buys product), extension asks: "Did this work out?"
4. Aggregate thumbs-up/down per business per AI model
5. Expose via simple API

This requires no PSD2 license, no BankID integration, no ZK proofs. It's a Chrome extension and a database. It's ugly but it's the minimum viable feedback loop.

---

## Sources

### Attestation & Trust Protocols
- EAS: attest.org, github.com/ethereum-attestation-service
- EAS Transitive Trust SDK: github.com/ethereum-attestation-service/transitive-trust-sdk
- AgentRank: agentrank.hyper.space (March 2026)
- OpenRank: openrank.com (Karma3 Labs)

### Identity
- World ID: world.org (38M app users, 15M+ Orb-verified)
- eIDAS 2.0: digital-strategy.ec.europa.eu
- Human Passport: human.tech (acquired Gitcoin Passport Feb 2025)

### AI Citation Research
- "AI Platform Citation Patterns": tryprofound.com
- "How AI Engines Cite Sources": medium.com/@geolyze, searchengineland.com
- "News Source Citing Patterns in AI Search Systems": arxiv.org/html/2507.05301v1
- Semrush "Most-Cited Domains in AI" (July 2025)
- xfunnel.ai: "What sources do AI Search Engines cite?" (40K responses, 250K sources)
- Yext: "How ChatGPT, Perplexity, Gemini, and Claude Decide What to Cite" (March 2026)

### Trust & Transparency Research
- "The Transparency Paradox in Explainable AI": arxiv.org/pdf/2601.13973
- "The Transparency Dilemma: How AI Disclosure Erodes Trust": sciencedirect.com (Schilke & Reimann 2025)
- "How to Get Your Customers to Trust AI": HBR January 2026
- "Trust in AI: progress, challenges, and future directions": Nature 2024
- Coalition for Trusted Reviews: press.aboutamazon.com (October 2023)

### Outcome Data
- EU Data Act: digital-strategy.ec.europa.eu (effective Sept 12, 2025; design requirements Sept 12, 2026)
- Mattilsynet API: mattilsynet.no/om-mattilsynet/api, data.norge.no
- Brønnøysund API: brreg.no/en/use-of-data
- PSD2/Neonomics: neonomics.io
- NRF/Happy Returns: 2025 Retail Returns Landscape
- Trustpilot API: developers.trustpilot.com

### Social Collaborative Filtering
- "Social Collaborative Filtering by Trust": IJCAI 2013 / IEEE TPAMI 2016
- "A collaborative filtering recommendation framework utilizing social networks": ScienceDirect 2023
- "Personalized Recommendation System of E-Commerce in the Digital Economy Era": Tandfonline 2025

---

*This document feeds back into the master strategy document at `/workspace/memory/knowledge/strategy/pagerank-2026-concept.md`. The seven p7 research tasks are now partially complete — this covers tasks #1 (outcome data inventory), parts of #2 (user trust journey), and connects to our work across all three product lines.*
