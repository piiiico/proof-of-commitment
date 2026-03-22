# PageRank 2026: The Commitment Graph

*Master document. Synthesized 2026-03-21 from Socratic dialogue (Håkon + Pico) and ten completed research deep-dives. This replaces all prior versions.*

---

## A. The Problem

Content is free. AI generates text, images, video, reviews at zero marginal cost. The internet is experiencing 1996 again — anyone can publish anything — but at a scale and quality level that makes the old trust signals (links, reviews, ratings) worthless.

Google solved 1996 with PageRank: links between pages revealed who matters. But links are an *information layer* signal. When AI generates both the content and the links, the information layer collapses into self-referential noise.

**The link between what the internet says and what's actually true is severing.**

AI models are trained on this noise. They hallucinate recommendations because they have no access to what actually happened — only to what someone wrote about what happened. 32% of AI search results about local businesses are wrong. 67% of consumers don't fact-check AI recommendations. The loop tightens: hallucination referencing hallucination.

The question: *"There must be an equivalent idea now that content becomes meaningless."*

---

## B. The Insight

**Commitment is the new link.**

There are two layers to any signal:

- **Information layer:** content, reviews, ratings, articles. Cheap to produce, easy to fake. This is the layer AI has flooded.
- **Commitment layer:** transactions, repeat purchases, behavioral patterns. Expensive to produce, hard to fake. Requires embodiment, money on the table, or temporal investment.

PageRank's genius was that links were costly at scale — you had to build a website and convince someone to link to it. That cost was the trust signal. The equivalent cost now is commitment: any act requiring skin in the game.

A repeat purchase is a stronger signal than a thousand five-star reviews. Going to a bad restaurant and never returning is a powerful negative signal. The aggregate behavior of real people making real decisions with real consequences is the data layer AI needs and doesn't have.

**The signal must come from the people making the commitment, not the entity receiving it.** This mirrors PageRank directly: Google counted links *from* others, not self-declared authority.

**Google indexed the web. The next step is indexing reality.**

---

## C. The Three Pillars

The entire architecture reduces to three components. Everything else — slashing, reputation points, access gating, data quality scoring — is overengineering.

### Pillar 1: Proof of Personhood — The Security Mechanism

**There is no "bad data" — only fake data. Fake data comes from fake people. Prevent fake people, prevent fake data.**

This is the ONLY security mechanism. If you know every contributor is a real, unique human, then their behavioral data is inherently valuable — positive or negative. Someone visiting a terrible restaurant once and never returning is useful data. The only threat is fabricated data from fabricated identities.

**What research confirms:**
- BankID (Norway): 4.6M users, zero fraud on NFC path. Creating a fake identity costs $10,000+ (document fraud + bank KYC). Strongest proof-of-personhood in any country. *(Source: BankID developer docs, pagerank-2026-proof-of-personhood.md)*
- World ID: 15M+ Orb-verified unique humans across 160 countries. Iris-based biometric with ZK proofs. SDK ready, OIDC compatible, free for developers. Controversial (privacy concerns, Altman association) but real scale. *(Source: World whitepaper)*
- eIDAS 2.0: EU mandate requiring EUDI Wallets by end of 2026 across all EU/EEA (~450M people). W3C Verifiable Credentials with selective disclosure. The "global unlock." *(Source: EU Commission)*

**Architecture:** Pluggable identity abstraction layer. BankID for Nordic launch, World ID for global expansion, eIDAS for EU maturity. All connected via OIDC + W3C Verifiable Credentials standard. The network sees "verified unique human" — never which human.

```
User → Identity Provider (BankID | World ID | eIDAS | Humanity Protocol)
     → Verifiable Credential: "unique human"
     → ZK proof strips identifying info
     → Anonymous behavioral data contribution
```

**What's still open:**
- Which PoP system for regions without government digital ID (much of Africa, South America)? Composite identity scores (multiple weak signals) are the fallback but weaker against sybils.
- eIDAS 2.0 deadline is end of 2026 but full ecosystem maturity likely 2027-2028.
- Attack vector: paying real humans for fake behavior. Expensive per identity (cross-validated against whole-life patterns), but unquantified at scale.

### Pillar 2: ZK Proofs — The Privacy Mechanism

**Contribute your full behavioral history without revealing any of it.**

Users prove properties of their data without exposing the data itself. "I visited this restaurant 5+ times in 6 months" — provable, without revealing identity, other visits, or amounts.

**What research confirms is production-ready:**
- **zkTLS** (Reclaim Protocol): Prove claims about any HTTPS data source. 3M+ verifications, zero fraud. ~30 seconds per proof. Already used by ZKP2P (fiat-to-crypto ramps), 3Jane (undercollateralized DeFi lending using credit scores). *(Source: pagerank-2026-zk-behavioral.md)*
- **Semaphore V4:** Anonymous group membership proofs. 192-byte proofs, 3ms verification, runs in-browser. Production-ready. *(Source: Semaphore docs)*
- **Prio3/DAP (Divvi Up):** Privacy-preserving aggregate statistics. Secret-sharing between two non-colluding servers. Already running in Firefox production. The aggregation problem is solved for simple statistics. *(Source: ISRG/Mozilla)*

**The specific greenfield opportunity:** zkTLS + PSD2 banking APIs for behavioral attestation. PSD2 mandates standardized bank transaction APIs across 3,500+ European banks (via Neonomics, Tink, Plaid). Nobody has combined zkTLS data provenance with PSD2 transaction data for behavioral proofs. Each component exists; the integration is the innovation. *(Source: pagerank-2026-zk-behavioral.md §2.5)*

**What's hard but feasible (6-18 months engineering):**
- Behavioral proofs beyond simple thresholds (frequency, duration) require custom Circom circuits + zkTLS. Simple claims: yes. Complex behavioral pattern classification: no (circuits too large).
- BankID → Semaphore anonymity bridge. Technically straightforward, needs GDPR analysis.
- Aggregating 10K+ behavioral proofs into trust scores via Prio3/DAP + Semaphore.

**What's genuinely impossible today (2-5 years):**
- Pure cryptographic aggregation without TEE or trusted server. Must use hybrid: ZK for input validation + TEE for aggregation + differential privacy for output protection.
- Complex behavioral ML in zero knowledge (time-series classification). zkVM performance improving 8x/year but not there yet.
- Privacy-preserving graph computation (PageRank on encrypted data). TEE is the practical path.

**The honest assessment:** V1 uses hybrid architecture (ZK proofs for individual claims, TEE for aggregation, DP for output). This introduces hardware trust assumptions (AWS Nitro Enclaves). Pure cryptographic aggregation is 3-5 years out. This is a pragmatic compromise, not a fundamental weakness — it matches what Google, Apple, and Mozilla deploy in production.

### Pillar 3: Tokenomics — The Incentive Mechanism

**Money, not reputation. Earn by contributing verified behavioral data. Pay to query the network's collective intelligence.**

Reputation alone was explicitly rejected: *"I want Eskil's recommendations and I don't care about my own reputation."* Free-rider problem: why contribute quality if you get others' good data anyway? Access-gating (lose access) is too binary. Money is universal skin in the game.

**What research warns against:**
- Every tokenized data marketplace has failed: Ocean (-95%), Streamr (-99.7%), Swash (-99.8%), Datum (-100%). Common pattern: token emissions simulate activity → emissions mask absence of demand → facade collapses. *(Source: pagerank-2026-incentive-mechanism.md §1.3)*
- Every data cooperative has failed at consumer scale: MIDATA (<$5M), Polypoly (acquired), CitizenMe (shut down). Pattern: abstract motivation → no killer use case → chicken-and-egg → death. *(Source: pagerank-2026-economics.md Part 3)*
- Product-first, token-second is the ONLY pattern that worked for behavioral data (Brave: 101M users, $26M revenue — built a browser people wanted, then added BAT). *(Source: pagerank-2026-incentive-mechanism.md §1.4)*

**What's different now:** AI is the first killer use case for contributed behavioral data. Not "protect your privacy" (abstract) but "your AI works better with your data" (concrete, immediate). Trustpilot's 1,490% surge in AI search click-throughs and 320% operating profit jump proves trust data has direct value to AI systems — even when it's opinion-based and gameable. *(Source: pagerank-2026-economics.md Part 5)*

**Per-action cost doesn't work.** *"There would still be spam if the click-through rate is 1% and income per customer is >$100."* Per-action cost is a linear defense; attackers adjust volume until ROI exceeds cost. Staked positions are fundamentally different: the entire stake is at risk, making expected value of cheating negative.

**Two-layer architecture (from March 21 conversation):**
- **Layer 1 (passive):** Behavioral data. Transactions, visits, repeat purchases. ZK-verified. No opinion expressed.
- **Layer 2 (active):** Staked endorsements. "I stake $10 that others will also like this restaurant." A prediction about generalizable quality. The resolution oracle for Layer 2 IS Layer 1 — did people actually come back?

This creates genuine additional information: a transaction says "I was here," an endorsement says "you should go here too." Endorsements can't be gamed because resolution is behavioral data, not opinions.

**What's still open:**
- Precise money flow. Subscription model? Data micropayments? Prediction-market-style endorsements? The March 21 conversation surfaced staked endorsements but didn't finalize the model.
- Token vs stablecoin denomination. Every native token has experienced catastrophic volatility. USDC denomination (recommended by bonds research) avoids this but limits composability.
- Bootstrap: *"Don't seed with existing data. Launch empty, invite pioneers with extra incentives."* Like Bitcoin's genesis block. But this requires the product to be compelling at zero network density — the hardest chicken-and-egg problem.
- Who pays on the demand side? Yelp AI API ($25/1K calls) proves AI companies will pay for trust data. Insurance companies have structural incentive (verification reduces claims). But neither is confirmed.

---

## D. How Money Flows (Sketch)

Three revenue streams, in order of certainty:

### Stream 1: B2B Trust Data API (Highest certainty)
AI companies pay to query verified behavioral trust data via MCP server / REST API.

**Evidence:** Yelp AI API already monetizes at $25/1K calls. DataLane raised $27M for verified business listing data. OpenAI spends $5-50M/year per publisher licensing deal. Trustpilot is the 5th most-cited domain on ChatGPT. The demand exists; the product doesn't.

**Revenue estimate:** $1.2M ARR at Norwegian scale (10M queries/month × $10/1K). $6M ARR at Nordic scale. $60M+ ARR if adopted by one major AI platform.

### Stream 2: Staked Endorsements (Medium certainty)
Users and agents stake capital on recommendations. Correct endorsements earn returns from query fees; incorrect ones lose stake. Resolution is automated via behavioral data (Layer 1 resolving Layer 2).

**Reference:** Recommendation bonds mechanism design specifies: dynamic bond sizing (value-proportional, reputation-discounted), optimistic resolution (95% automated), multi-layer oracle for disputes. Protocol fee: 1.5% of settlements. At 1M monthly bonds averaging $10: ~$8.4M ARR.

**Caution:** This is speculative. No recommendation bonding system exists at scale. The mechanism design is sound on paper (mirrors Numerai, UMA, EigenLayer patterns) but unproven.

### Stream 3: Pioneer Network Value
Contributors earn from the network's success — either directly (share of query fees) or through improved AI quality. Early contributors are incentivized with founder status and enhanced returns during bootstrap.

**Model:** Product-first (Brave pattern). Build something people want — an AI that gives better recommendations because it accesses real behavioral data — then add financial incentives.

### Value Capture Point
The protocol is open. Value accrues at the **AI integration layer** — the MCP server that AI models query for trust data. This is how Google captured HTTP value: not by owning the protocol, but by building the intelligence on top.

```
Open protocol (trust data + computation) → free
                    ↓
AI integration layer (MCP server, API) → paid
Identity verification bridges → paid
Enterprise analytics → paid
```

---

## E. Why Now (Convergence)

Three independent maturation curves converging in 2026:

**1. The problem is acute.** AI agents flood content. AI search wrong 32% of the time on local businesses. Traditional trust signals (links, reviews) are being gamed at machine speed. Every AI company is scrambling for better data — spending billions on publisher licensing and data partnerships.

**2. ZK proofs are practical.** zkTLS creates proofs about any HTTPS data (3M+ verifications). Semaphore V4 proves group membership in 3ms. Prio3/DAP aggregates statistics privately in Firefox production. Five years ago, none of this worked outside academic papers. *(Confirmed by research: pagerank-2026-zk-behavioral.md)*

**3. Proof of personhood exists at scale.** World ID: 15M+ verified. eIDAS 2.0: mandated for 450M people by end of 2026. BankID: universal in Nordics. The identity layer that makes sybil-resistant data networks possible is being built by others. *(Confirmed: pagerank-2026-proof-of-personhood.md)*

**Nobody has connected the three.** The specific intersection of PSD2 banking data + zkTLS provenance + behavioral pattern proofs + privacy-preserving aggregation + trust graph computation does not exist anywhere. Each component is production-ready or near-ready. The integration is the innovation.

**AI as the first killer use case.** Every previous data cooperative died because the value proposition was abstract ("own your data"). AI makes it concrete: "your AI gives better recommendations with your data." MyData's 2025 theme was literally "From MyData to MyAI." The sector is converging on this realization.

---

## F. Hard Remaining Questions

Ranked by how much they threaten the viability of the entire project.

### Existential
1. **Cold start without seeding.** Håkon rejected seeding with existing data — launch empty, like Bitcoin. But Bitcoin's genesis block didn't need network density to be useful. A behavioral trust network with 10 users in Stavanger is worthless. How do you make the product valuable before critical mass? The Carfax model (public data lookup useful to one person checking one business) is the fallback — but Håkon explicitly rejected seeding.

2. **Who is the first paying customer on the demand side?** Every data marketplace died because the buyer side never materialized. Is it AI companies (Yelp API proves willingness)? Insurance companies (structural incentive but 12-24 month sales cycles)? The answer determines everything.

3. **Token or no token?** Research is brutally clear: every tokenized data marketplace failed. But the vision is a global, permissionless protocol — which almost requires a coordination token. AT Protocol/Bluesky attempts tokenless global protocol with mixed results. Staked endorsements require something to stake. USDC avoids speculation but limits organic ecosystem incentives.

### Architectural
4. **Staked endorsement resolution.** The two-layer architecture (passive behavioral data resolving active endorsements) is elegant but untested. Attribution problem: if 100 people visit a restaurant after an endorsement, how much of that is caused by the endorsement vs organic? Time horizons: restaurants resolve in weeks, financial products in years.

5. **Data freshness bottleneck.** Users must periodically re-prove behavioral data via zkTLS. PSD2 APIs have rate limits (typically 4 calls/day per consent). At 1M users re-proving monthly: 100M API sessions with banking infrastructure. Banks may detect and block attestor infrastructure.

6. **Hybrid ZK/TEE architecture.** Pure ZK aggregation is impossible today. TEE introduces hardware trust assumptions (Intel/AMD/AWS). This is the same compromise Google Privacy Sandbox makes, but it's a compromise.

### Strategic
7. **Platform counter-moves.** Google, Apple, Meta could lock down data export further. PSD2 mandates openness in banking, but platforms have no such mandate. EU Data Act (Sept 2026) may help but scope is limited.

8. **Blockchain: necessary or practical?** 5 of 6 system components converge in blockchain ecosystems. Financial staking works best on-chain. But "crypto under the hood, Vipps on the surface" is the UX requirement. World ID changes the equation: global, blockchain-native, ZK-native. Proof of personhood research remains open — Håkon said *"I'm not married to World ID."*

9. **Value capture in open protocols.** Signal Protocol was used by billions, captured nothing. Linux captured value via Red Hat. HTTP via Google. The AI integration layer (MCP server) is the proposed capture point, but this must be designed into the architecture from day one.

---

## G. Connection to Existing Work

### Synlig Digital (AEO consulting)
AEO is linkbuilding for the AI era — helping businesses climb the AI citation graph. This is the **consultant position**: immediate revenue, market education, direct insight into how AI trust works. The AEO citation tracker already maps which AI models cite which businesses — a primitive commitment graph. Revenue funds learning. Every client conversation validates (or invalidates) assumptions about what businesses will pay for.

### AgentLair (Agent infrastructure)
Agent identity, email, and interaction infrastructure. If agents participate in the commitment graph — making staked recommendations, building reputation — AgentLair provides the identity and communication layer. The recommendation bonds mechanism design places agents as first-class participants. ERC-8004 (on-chain agent identity) plugs directly into the protocol's identity layer.

### ERC-8004 (Agent identity standard)
Pluggable identity for AI agents. If agents need to prove they represent a verified entity to stake recommendations, ERC-8004 provides the mechanism. Direct integration path with the bond registry.

### Strategic Sequence
1. **Consultant** (Synlig now): Revenue + market education + insight.
2. **Infrastructure** (scaled AEO tracker → trust API): Map AI citations → aggregate public trust data → sell via MCP server to AI companies.
3. **Protocol** (this document): Build the commitment graph. Biggest swing, longest timeline.

These are sequential stages, not competing bets. Position 1 funds learning. Position 2 builds the data asset and proves demand. Position 3 is where it all leads.

---

## Research Corpus

All research files feeding this document:

| File | Topic | Key Contribution |
|------|-------|-----------------|
| `pagerank-2026-zk-behavioral.md` | ZK for behavioral data | Confirmed zkTLS + PSD2 is buildable. Performance envelopes. Hybrid architecture. |
| `pagerank-2026-proof-of-personhood.md` | Identity landscape | Pluggable PoP architecture. BankID → World ID → eIDAS sequence. |
| `pagerank-2026-economics.md` | Business model | B2B API most viable. Trustpilot AI windfall as proof point. No cooperative has succeeded. |
| `pagerank-2026-incentive-mechanism.md` | Earn/lose mechanics | Every token marketplace failed. Product-first only pattern that works. Three candidate designs. |
| `recommendation-bonds-mechanism-design.md` | Bonded recommendations | Full mechanism spec for agent-staked recommendations. Smart contracts, attack vectors. |
| `pagerank-2026-open-protocol.md` | Protocol architecture | Four-layer stack. Governance. Value capture at AI integration layer. |
| `pagerank-2026-research.md` | Outcome-based trust | EigenTrust as foundation. Behavioral signals vs opinion signals. |
| `pagerank-2026-verification.md` | Outcome verification | How outcomes get verified. Attack surfaces. |
| `pagerank-2026-user-journey.md` | Product vision | User trust journey in AI-first discovery. |
| `pagerank-2026-historical-trust.md` | Historical precedent | How other domains solved trust. |
| `pagerank-2026-nordic-advantage.md` | Nordic infrastructure | BankID, PSD2, Brønnøysund, Mattilsynet as launch advantages. |
| `pagerank-2026-product-vision.md` | Consumer product | What it looks like. Form factors. |
| `pagerank-2026-reciprocal-trust.md` | Data cooperatives | Why all died. What's different with AI as use case. |
| `strategy/pagerank-2026-conversation-march21.md` | March 21 dialogue | The three pillars. All key design decisions. Håkon's direction. |

---

*Speculation is flagged with "speculative" or "untested." Claims marked "confirmed by research" have source citations in the referenced files. Everything else is synthesis from the research corpus.*
