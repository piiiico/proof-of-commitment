# PageRank 2026: Open Source Trust Protocol

*Research and architecture document. Created 2026-03-20.*

## The Core Idea

Users opt in to share behavioral data (visits, purchases, outcomes) anonymously. In return they get access to the network's collective intelligence for better AI recommendations. The protocol is open source from day one. Value comes from owning the protocol standard, not the data.

**Google's mistake was owning the graph.** They became the gatekeeper. This project owns the PROTOCOL, not the data.

---

## 1. Existing Trust/Reputation Protocols

### EigenTrust (2003) — The Foundation

**The** trust algorithm. ~5,800 citations. Same math as PageRank: computes global trust vector via power iteration on a normalized trust matrix. Stationary distribution of a random walk on the trust graph.

**Algorithm:** Local trust `s_ij = sat(i,j) - unsat(i,j)` → normalize to `c_ij` ∈ [0,1] → build matrix C → iterate `t(k+1) = (1-a) * C^T * t(k) + a * p` until convergence. Damping factor `a` and seed trust distribution `p` provide Sybil resistance.

**Known weaknesses:**
- NOT sybilproof (UC Berkeley). Symmetric reputation functions can be gamed by duplicating trust subgraphs
- Flawed local metric: 10,000 sat / 9,980 unsat = same score as 20/0. Bayesian metrics strictly better
- Collusion: effective up to ~70% malicious in simple models, breaks at 20-40% under sophisticated attacks
- Seed peer centralization: Sybil resistance requires trust anchors, which reintroduce centralization
- Churn: malicious peers rejoin with clean identities

**Modern renaissance:** [OpenRank](https://openrank.com/) (Karma3 Labs, $4.5M seed) runs EigenTrust on Farcaster/Lens social graphs with ZK-verifiable computation. Also: EigenTrust++ (Georgia Tech), z-TAB (clinical trials on Hyperledger Fabric). The ZK-EigenTrust implementation was deprecated Nov 2023 — the codebase is forkable, the space is open.

**Verdict:** 23 years later, still the default algorithm. Weaknesses well-documented but no replacement has achieved comparable adoption.

### AT Protocol (Bluesky)

**Architecture:** Personal Data Servers (PDSes) host user data → Relays aggregate firehose → App Views render experiences. Identity via DID:PLC (Public Ledger of Credentials) and DID:Web. Self-authenticating data — every record is signed and content-addressed.

**Trust/moderation:** "Composable moderation" — users subscribe to labeling services (think independent moderators). No built-in reputation scoring. Trust is delegated to labelers, not computed by the protocol. This is a conscious design choice.

**Governance:** Bluesky PBC controls in practice (specs, relay, AppView, PLC directory). IETF standardization in progress (Jan 2026). "Free Our Feeds" initiative raising $30M for independent foundation. Patent Non-Aggression Pledge since Oct 2025.

**Lesson for us:** Portable identity + composable services is the right architecture. But Bluesky's biggest vulnerability is that ONE company still runs the only relay at scale. We must avoid this from day one.

### Nostr

**Architecture:** Radically simple. Users = keypairs. Events = signed JSON. Relays = dumb pipes. No accounts, no usernames (just pubkeys), no consensus. Clients and relays choose what to implement.

**Trust layers being built:**
- **NIP-32 Labeling:** generic tagging system for content classification
- **Web of Trust (WoT):** multiple implementations emerging — "follow-of-follows" trust radius
- **NIP-56 Reporting:** users flag content, relays can act on reports
- No formal governance: rough consensus via NIP discussions on GitHub. Anyone proposes, community debates, implementations that work get adopted

**Lesson for us:** Radical simplicity enables rapid adoption but makes coordination hard. NIPs must be implemented by 2+ clients and 1 relay before merging. Governance = rough consensus + running code.

### Lens Protocol

**Architecture:** Decentralized social graph on Lens Chain (zkSync + Avail L2). Profiles, follows, content as NFTs. Migrated ~647K profiles and 31M publications to Lens Chain in early 2025.

**Governance:** Lens Improvement Proposals (LIPs) — community-led, NOT token-based initially. Progressive decentralization toward full DAO with LENS token. Created by Aave team (Stani Kulechov).

**Reputation:** On-chain activity (governance participation, asset holding) forms implicit reputation. FollowNFTs have built-in governance capabilities (delegation, voting power).

**Lesson:** On-chain social graphs are possible and working at moderate scale. But gas costs and blockchain complexity limit mainstream adoption. The NFT-as-identity model is elegant but alienates non-crypto users.

### KERI (Key Event Receipt Infrastructure)

**Architecture:** Decentralized identity WITHOUT blockchain. Self-certifying identifiers generated algorithmically from key pairs. Key Event Log (KEL) = append-only log of key management events. Witnesses validate events, watchers verify logs. CESR encoding for composable cryptographic primitives.

**Key innovation:** "Ambient verifiability" — anyone can verify without querying a central authority. Pre-rotation of keys (quantum-resistant key management). Self-Addressing Identifiers (SAIDs) for content-addressed data.

**Status:** IETF Internet Draft. Part of Trust over IP Foundation (Layer 1). 140+ page whitepaper split into KERI, ACDC, CESR specs. Low adoption but strong technical foundations.

**Lesson:** Identity doesn't need blockchain. KERI's self-certifying approach is the most technically elegant identity solution — but elegance hasn't translated to adoption. Distribution > architecture.

### Trust over IP Foundation (ToIP)

**Architecture:** Four-layer stack modeled on TCP/IP:
1. **Trust Support** — cryptographic keys (DIDs, KERI AIDs)
2. **Trust Spanning Protocol (TSP)** — "IP for trust." End-to-end verifiable communication via VIDs
3. **Trust Task Protocols** — credential exchange (OID4VC, DIDComm, Verifiable Credentials)
4. **Trust Applications** — governance frameworks

**Key insight:** ToIP does NOT compute trust scores. It provides infrastructure for trust signals to flow. "Trust is not a number; it is a verifiable relationship."

**Status:** 500+ members. Linux Foundation Decentralized Trust (since Sept 2024). Trust Spanning Protocol first Implementers Draft April 2024.

**Lesson:** Ambitious infrastructure, well-funded, slow. Complementary to algorithmic trust — ToIP provides pipes, EigenTrust provides scoring. The dual governance/technology stack is wise.

### ActivityPub / Fediverse

**Trust layers:**
- **Fediseer** — chain-of-trust with cascading revocation (most interesting technically). Guarantees, endorsements, censures.
- **IFTAS** — coordinating body. CARIAD observes ~45% of Mastodon accounts.
- **Defederation** — binary, blunt, no appeals. Information asymmetry is extreme.

**Status (2025):** Mod-to-user ratio 1:3,500. Spam is #1 concern. 1 in 5 admins report burnout. Meta Threads (300M users) opted into ActivityPub, dwarfing Fediverse's 14M.

**Lesson:** Community-driven trust outpaces algorithmic trust in practice — but it doesn't scale. Human moderators are the bottleneck.

### OpenReputation — Dead

Last activity: December 2017. 5 GitHub stars. No artifacts. The name is available.

---

## 2. Protocol vs Product — Where's the Value?

### Case Studies

| Protocol | Open? | Who captured value | How | Revenue scale |
|----------|-------|--------------------|-----|---------------|
| Linux | GPL | Red Hat (IBM $34B acquisition) | Enterprise support, certification | ~$3.4B/yr pre-acquisition |
| TCP/IP | Open standard | Cisco | Hardware implementation | $51.6B/yr (FY2024) |
| Bitcoin | MIT license | Coinbase, Binance, exchanges | On/off ramps, custody, trading | Coinbase $6.6B (2024), Binance larger |
| HTTP | Open standard | Google | Indexing content served over it | $350B/yr (Alphabet) |
| Signal Protocol | Open source | WhatsApp (Meta) | Integrated into 2B-user app | Signal Foundation struggles (~$50M/yr donations) |
| Matrix | Apache 2.0 | Element (company) | Enterprise deployment, hosting | ~$30M funding, small revenue |

**The brutal truth:** The protocol itself almost never captures the value it creates. Signal Protocol is the clearest warning — built the best encryption in the world, used by billions, captured nothing.

### Value Capture Points for an Open Trust Protocol

**Ranked by defensibility:**

1. **AI Integration Layer (MCP Server)** — The query interface between AI models and the trust graph. This is where Google captured HTTP value: not the protocol, but the intelligence on top. An MCP server that gives Claude/GPT/Gemini access to behavioral trust signals is the most natural value capture point. **Defensibility: HIGH** — network effects of data, first-mover, model integrations.

2. **Identity Verification Layer** — Pluggable identity is the protocol design. But the verification bridge (BankID ↔ protocol, eIDAS ↔ protocol, World ID ↔ protocol) requires commercial relationships. **Defensibility: MEDIUM** — regulatory moats, partnership lock-in.

3. **Enterprise/API Layer** — Red Hat model. The protocol is free, enterprise features (SLAs, compliance, analytics dashboards) cost money. **Defensibility: MEDIUM** — commoditization risk.

4. **Data Aggregation & Analytics** — Running relays/aggregators that process the trust graph at scale. Cisco model — implementation at scale requires infrastructure. **Defensibility: MEDIUM** — capital-intensive, multi-player.

5. **Reference Implementation** — Building the canonical client. Bluesky model. **Defensibility: LOW** — forkable, dependent on continued development pace.

**Recommended strategy:** Capture value primarily through the AI integration layer (MCP server exposing trust data to AI models) and identity verification bridges. The protocol is free and open. The intelligence on top of it is the product.

---

## 3. Architecture for a Global Open Protocol

### Minimum Viable Protocol Spec

```
┌─────────────────────────────────────────────────┐
│              QUERY LAYER (Layer 4)               │
│  MCP Server / API / GraphQL                      │
│  "How trustworthy is X for task Y?"              │
├─────────────────────────────────────────────────┤
│              PROOF LAYER (Layer 3)               │
│  ZK aggregation of trust signals                 │
│  Semaphore V4 for anonymous group membership     │
│  Differential privacy (ε ≈ 2) for aggregation    │
├─────────────────────────────────────────────────┤
│              DATA LAYER (Layer 2)                │
│  User-controlled behavioral data stores          │
│  Trust attestations (EAS-compatible)             │
│  Federated — data stays on user devices/pods     │
├─────────────────────────────────────────────────┤
│              IDENTITY LAYER (Layer 1)            │
│  Pluggable: BankID, World ID, eIDAS, Aadhaar,   │
│  device attestation, KERI AIDs, DID:Web          │
│  Proof-of-personhood (not proof-of-wealth)       │
└─────────────────────────────────────────────────┘
```

### Layer 1: Identity (Pluggable)

**Requirement:** Work everywhere, including countries with NO digital ID infrastructure.

**Design:** Composite identity score (like Gitcoin Passport "stamps"). Multiple weak signals combine into strong identity:
- **Strong signals:** BankID (Norway), eIDAS (EU), Aadhaar (India), World ID (iris)
- **Medium signals:** Phone verification, email verification, government ID scan
- **Weak signals:** Device attestation, social account linking, behavioral consistency
- **Threshold:** Users need a minimum composite score to participate. Higher scores = more weight in trust graph.

**Privacy:** ZK proof of "I meet the identity threshold" without revealing WHICH identity signals were used (Sismo pattern). Nullifiers prevent double-counting.

**Global considerations:**
- Locale-agnostic by design — no text, currency, or jurisdiction in the protocol layer
- Low-bandwidth compatible — identity attestation is a one-time operation, not per-query
- GDPR/CCPA/LGPD/POPIA compliant by design: user controls data, protocol sees only ZK proofs

### Layer 2: Data (User-Controlled, Federated)

**Where does behavioral data live?** On user devices or personal data stores. NOT on protocol-controlled infrastructure.

**Data types:**
- Visits (what content/products/services did the user engage with)
- Purchases (what did they actually buy — outcome signal)
- Outcomes (was the restaurant good? did the product work? — quality signal)
- Reviews/ratings (explicit trust signals)

**Format:** Signed attestations compatible with Ethereum Attestation Service (EAS) schema. Each behavioral data point is a structured, signed claim.

**Federation:** Users run lightweight agents (browser extensions, mobile apps) that hold their data locally. Data is NEVER transmitted raw — only as ZK proofs or differentially-private aggregates.

### Layer 3: Proof (Privacy-Preserving Aggregation)

**Core insight:** The protocol doesn't need to see individual data. It needs to compute collective intelligence from private data.

**Technical stack:**
- **Semaphore V4** for anonymous group membership and signaling (192-byte proofs, 3ms verification, runs in-browser). "I am a verified member of this group" without revealing who.
- **Differential privacy** (ε ≈ 1.6-3) for aggregate statistics. At ε=2, deep learning models lose only ~4.7% accuracy vs no privacy. Apple and Google operate at ε=2-16 in production.
- **Federated learning** for the recommendation model. Users contribute to model training without sharing raw data.
- **EigenTrust variant** for global trust computation. Modified to use Bayesian local metrics (not naive sat-unsat). ZK-verifiable via Halo2 (fork ZK-EigenTrust codebase).

**The hardest unsolved problem:** Negative reputation in anonymous systems. How do you penalize bad actors without de-anonymizing them? The zk-promises paper (IACR 2024) has the best theoretical approach but isn't production-ready. **Pragmatic approach:** time-decay + required minimum positive signals (like EigenTrust's seed trust), rather than explicit negative scoring.

### Layer 4: Query (AI Integration)

**The interface that makes this valuable:**
- **MCP Server** that AI models (Claude, GPT, Gemini) can query: "What do trusted users in Stavanger think about restaurant X?" → privacy-preserving aggregate response
- **API** for applications: recommendation engines, search, marketplaces
- **GraphQL** for developers building on top

**Query types:**
1. **Entity trust score:** "How trustworthy is business X?" (aggregate of behavioral signals)
2. **Recommendation:** "What do people like me recommend for Y?" (collaborative filtering on trust graph)
3. **Verification:** "Has user Z been verified to identity threshold T?" (boolean)
4. **Comparison:** "How does business A compare to business B among users who tried both?"

### Governance

**Foundation model** (not DAO, not benevolent dictator):
- Non-profit foundation owns the protocol spec and reference implementation IP
- Governance token NOT required — avoids financialization and speculation
- Technical steering committee (elected, term-limited) for protocol changes
- RFC process (like IETF) for protocol evolution
- Patent Non-Aggression Pledge from day one
- **Capture prevention:** No single company on steering committee can have >25% of votes. Foundation board must include at least 3 jurisdictions.

---

## 4. Open Source Launch Strategy

### Lessons from Successful Protocols

| Protocol | Launch approach | Time to critical mass | Key success factor |
|----------|----------------|----------------------|--------------------|
| Bitcoin | Whitepaper → implementation → mailing list | ~4 years to $1B market cap | Solved a real problem (censorship-resistant money) |
| Ethereum | Whitepaper → foundation → ICO → developer ecosystem | ~2 years to major adoption | Developer incentives (smart contracts = new capability) |
| AT Protocol | Company-backed → invite-only beta → open | ~3 years to 20M users | Attached to a product people wanted (Bluesky app) |
| Matrix | Foundation + company → reference implementation | ~6 years to critical mass | Enterprise demand (secure comms) |
| Signal Protocol | Best-in-class implementation → WhatsApp adoption | ~2 years (via WhatsApp) | Integration into existing massive platform |
| ActivityPub | W3C standardization | ~5 years to meaningful adoption | Twitter implosion (external catalyst) |

### Recommended Launch Strategy

**Phase 1: Spec + Reference Implementation (Months 1-6)**
- Publish protocol spec as RFC-style document on GitHub
- Build reference implementation in TypeScript/Rust
- Focus on ONE use case: local business trust (restaurants, services)
- "The first thing someone can DO with it" = rate a local business and see privacy-preserving aggregate ratings

**Phase 2: Developer Community (Months 6-12)**
- Developer docs, SDKs, tutorials
- MCP server reference implementation (the killer app for AI developers)
- Hackathons / grants for third-party implementations
- Target: Farcaster/Lens developers (already building on trust graphs)

**Phase 3: User Traction (Months 12-24)**
- Browser extension that passively builds your behavioral profile
- Mobile app for explicit ratings/reviews
- Integration with 1-2 AI assistants via MCP
- Geographic focus: start with ONE city (density matters for local trust)

**Phase 4: Foundation + Governance (Months 18-30)**
- Establish non-profit foundation
- Formalize governance (steering committee, RFC process)
- Commercial entity for enterprise/API layer
- Identity provider partnerships

### Preventing Fragmentation
- **Single canonical spec** maintained by foundation (like HTTP RFCs)
- **Conformance test suite** — if your implementation passes, it's compliant
- **Backwards compatibility guarantee** — breaking changes require supermajority of steering committee
- **Liberal licensing** (Apache 2.0 or MIT) — no copyleft friction

### Preventing Corporate Capture
- Foundation charter prohibits single-entity control
- Steering committee diversity requirements (jurisdiction, sector)
- Patent Non-Aggression Pledge
- No token (removes financial capture vector)
- Core spec under foundation; extensions can be proprietary

---

## 5. Global From Day One — Practical Implications

| Dimension | Design choice |
|-----------|---------------|
| **Language/locale** | Protocol layer is locale-agnostic (byte strings, not text). Application layer handles i18n |
| **Identity** | Pluggable. Works with BankID AND device attestation AND nothing (weak anonymous participation allowed, weighted accordingly) |
| **Connectivity** | Offline-first for data collection. Sync when connected. ZK proofs can be computed locally |
| **Currency** | Behavioral data is the currency. No token, no cryptocurrency |
| **Privacy law** | GDPR-compliant by architecture: data never leaves user device. Protocol sees only ZK proofs. No data processor role |
| **Infrastructure** | Run on commodity hardware. No blockchain required. Optional chain anchoring for timestamping |

---

## 6. The README Test

### Draft README

```markdown
# TrustGraph Protocol

> An open protocol for reciprocal behavioral trust.
> Users share anonymized behavioral signals. The network returns collective intelligence.
> No company owns the graph. No company owns your data.

## The Problem

Google built the world's trust graph — then locked the door.
Your restaurant visits, purchase decisions, and quality assessments are
trapped in walled gardens. AI models hallucinate recommendations because
they can't access the real signal: what actual humans actually did.

## The Solution

TrustGraph is an open protocol where:
1. **You share** behavioral signals (visits, purchases, ratings) — encrypted, on your device
2. **The network aggregates** collective intelligence using zero-knowledge proofs
3. **AI models query** the trust graph via MCP — no raw data exposed, just verified aggregate insights
4. **Everyone benefits** — better recommendations, based on real behavior, not SEO manipulation

Think of it as PageRank, but:
- Open source (not owned by one company)
- Privacy-preserving (ZK proofs, not surveillance)
- Reciprocal (you contribute, you benefit)
- AI-native (MCP server, not web crawling)

## Quick Start

\`\`\`bash
# Install the CLI
npm install -g @trustgraph/cli

# Create your identity (generates keypair + optional ID verification)
trustgraph init

# Record a behavioral signal
trustgraph signal --entity "restaurant:stavanger:pierstop" --type "visit" --outcome "positive"

# Query the trust graph
trustgraph query --entity "restaurant:stavanger:pierstop" --radius 2
# → Trust score: 0.87 (based on 234 verified behavioral signals within 2 hops)

# Start MCP server (for AI integration)
trustgraph serve --mcp
\`\`\`

## Architecture

[Identity Layer] → [Data Layer] → [Proof Layer] → [Query Layer]
   Pluggable        User-owned     ZK + DP         MCP / API

## Contributing

This is a protocol, not a product. We need:
- **Cryptographers** — ZK circuit optimization, differential privacy tuning
- **Protocol engineers** — spec review, reference implementation
- **Application developers** — clients, integrations, MCP adapters
- **Privacy researchers** — formal verification of privacy guarantees

Apache 2.0 · No token · No VC · Foundation-governed
```

### Name Options

- **TrustGraph** — direct, descriptive, available (trustgraph.org likely available)
- **OpenRank** — taken (Karma3 Labs)
- **TrustWeb** — descriptive but generic
- **Reciprocal** — evocative, captures the exchange model
- **Signal** — taken (messaging app)
- **Verity** — truth-oriented, available

**Recommendation:** "TrustGraph Protocol" for now. The name should signal: open, trust, graph, protocol. Rename later if a better name emerges from community.

---

## 7. Key Tensions & Open Questions

### Unsolved Problems

1. **Negative reputation in anonymous systems.** How to penalize bad actors without de-anonymizing? Best current approach: zk-promises (IACR 2024), but not production-ready. Pragmatic: time-decay + minimum positive signals.

2. **Cold start problem.** Trust graphs need density to be useful. A city with 10 users is worthless. Need to solve geographic density from launch.

3. **Sybil resistance vs accessibility.** Strong identity = high barrier to entry (excludes billions). Weak identity = Sybil vulnerability. Composite identity score is the compromise.

4. **Incentive alignment.** Why would users share behavioral data? The "reciprocal" model (share to access) helps. But early network has nothing to offer early users.

5. **Seed trust bootstrapping.** Who are the pre-trusted peers? Every system needs trust anchors. This is the EigenTrust seed peer problem in a new context.

### Strategic Questions for Haakon

- **One city or global from launch?** Density matters (local trust needs local users). But global protocol design prevents geographic lock-in.
- **Consumer or developer first?** MCP server for AI developers is a faster path to value than consumer app. But consumer data is what creates the value.
- **Foundation or company first?** Foundation establishes credibility. Company generates revenue. Doing both simultaneously is hard but probably necessary (Element/Matrix model).
- **Blockchain or no blockchain?** Protocol doesn't require it. Optional anchoring for timestamping. No token. But crypto community is the most natural early adopter for open protocols.

---

## 8. Cross-Cutting Insights

1. **Trust scoring remains unsolved at the protocol layer.** All four major decentralized protocols (AT Protocol, Nostr, Lens, ActivityPub) delegate trust computation. None embed it as a protocol primitive. This is the design space.

2. **The privacy technology is ready.** Semaphore V4 (192-byte proofs, 3ms verification), differential privacy (ε≈2, ~4.7% accuracy loss), federated learning — all production-proven. The gap is protocol design, not cryptography.

3. **Network effects determine winners, not tech.** ActivityPub's trust tools are worse than any proposed system but they're actually used. Distribution > architecture.

4. **Google captured HTTP value by indexing, not by owning the protocol.** The AI integration layer (MCP server) is the analogous capture point for a trust protocol. Own the intelligence on top, not the pipes underneath.

5. **Design the value capture mechanism into the architecture from day one.** Signal Protocol's warning: build the best technology in the world, used by billions, capture nothing.

---

*Sources: EigenTrust (Stanford 2003), OpenRank/Karma3 Labs, Trust over IP Foundation, AT Protocol/Bluesky, Nostr NIPs, Lens Protocol, KERI/ACDC specs, Fediseer, IFTAS, Carnegie Endowment, Social Web Foundation, Semaphore V4, Ethereum Attestation Service, Sismo Connect, Gitcoin Passport, World ID, Solid/Inrupt, NIST differential privacy guidelines. Full source URLs in research agents' output transcripts.*
