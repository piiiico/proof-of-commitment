# Proof of Personhood for a Global Commitment Graph

*Deep research. Updated 2026-03-22. Replaces prior version (2026-03-21).*
*Context: Task 4 for PageRank 2026. Full thesis: `strategy/pagerank-2026-concept.md`.*

---

## 1. Landscape: Every Significant PoP System (2024-2026)

### 1.1 World ID (Worldcoin → World)

**The 800-pound gorilla. Largest crypto-native PoP by far.**

- **Scale:** ~18M Orb-verified unique humans (CoinDesk, March 17 2026). ~38M total World App accounts. ~45K new wallets/day. Growth: 2M (mid-2023) → 6M (Sep 2024) → 12M (May 2025) → 18M (Mar 2026). Missed 50M target for end-2025.
- **Mechanism:** Iris scan via custom Orb hardware → IrisCode (hash, not image) → ZK proof of uniqueness via Semaphore. Orb does on-device processing ~10s. Images permanently deleted from Orb.
- **Privacy:** AMPC protocol — iris code sharded across independent custodians (Nethermind, FAU, KAIST, UC Berkeley RDI). No single custodian can reconstruct. ZK proofs reveal "valid member of verified set" — nothing else.
- **Coverage:** 160+ countries, ~1,300+ Orbs. Strong in US (6+ cities), Argentina, Colombia, Japan, Singapore. Banned/restricted in Spain, Portugal, Kenya, Brazil, Hong Kong, Indonesia, India, France (+South Korea fined, Germany under order).
- **World ID 4.0** (RFC Dec 2025): Account abstraction for identity. Multi-key, multi-authenticator (not locked to World App). Key rotation, biometric recovery. Foundation for AgentKit.
- **AgentKit** (March 17, 2026): AI agents carry ZK proof of human backing. Integrates with Coinbase/Cloudflare x402 micropayment protocol. One human → multiple agents, platforms enforce per-human rate limits. Limited beta.
- **Partnerships:** Visa (co-branded card), Match Group/Tinder (Japan pilot), Razer (verified-human gaming), Shopify, Morpho, Rappi (on-demand Orb delivery in South America).
- **Token:** WLD trading at ~$0.33 (March 2026). >90% held by top 100 wallets.

**Key criticisms:**
- Irrevocable biometric — compromised iris code is permanent
- Exploitation concerns — Kenya participants scanned for ~$55 WLD, ruled invalid consent
- Regulatory whack-a-mole — 8+ country bans/restrictions
- Hardware bottleneck — Orb requires physical presence; Orb Mini (portable) expected 2026 but unproven
- Sam Altman dual role (OpenAI + World) raises concentration-of-power concerns

### 1.2 BankID (Nordics)

**Highest sybil resistance of any system. Regional only.**

| Country | System | Users | Mechanism |
|---------|--------|-------|-----------|
| Norway | BankID | ~4.6M | Fødselsnummer + bank KYC + OIDC |
| Sweden | BankID | ~8.6M | Personnummer + bank KYC + PKI |
| Denmark | MitID | ~5M (87% weekly) | CPR number + authenticator/hardware key |
| Finland | FTN | Federated | Bank + telco identities via Traficom |
| Estonia | Smart-ID/e-Residency | Near-universal + ~100K e-Residents | Most advanced globally. Open to non-citizens via e-Residency |

- **Norway BankID NFC path:** Zero fraud cases (1M+ activations). NFC passport chip + iProov liveness check. 35% reduction in support calls. Gold standard.
- **Norway transition:** Stø AS becoming single issuer (April 2026). Legacy systems being discontinued.
- **Sybil cost:** Creating fake Norwegian identity estimated $10K+ (document fraud + bank KYC bypass). Main attack vector is social engineering existing holders, not forging new ones. 1 in 5 Norwegians have shared BankID credentials; 50% of those experienced fraud.
- **Integration:** OIDC standard. Via Signicat, Criipto, Curity, or direct. ~0.50-2 NOK per auth.
- **Limitation:** Nordic-only. Not useful outside region.

### 1.3 eIDAS 2.0 / EUDI Wallet

**The game changer — if it ships on time.**

- **Legal status:** Regulation EU 2024/1183 entered force May 20, 2024. Implementing acts adopted Nov 28, 2024.
- **Deadline:** Every EU member state must offer ≥1 certified EUDI Wallet by **December 2026**. EEA countries (Norway, Iceland, Liechtenstein): **December 2027**.
- **Scope:** EU + EEA = ~450M potential users.
- **Countries with deployed wallets (mid-2025):** Austria (Valera — frontrunner), Italy (IT Wallet), Belgium, Cyprus, Czech Republic, France, Hungary, Poland, Portugal.
- **Countries lagging:** Netherlands (explicitly signaled delay), Bulgaria (hasn't started), Latvia, Malta.
- **Forecast:** 169M digital ID wallets in circulation across Europe by 2026 (ABI Research).

**Technical architecture:**
- Credential formats: SD-JWT VC (JSON) + ISO mDL/mdoc (CBOR)
- Issuance: OpenID4VCI
- Presentation: OpenID4VP (remote) + ISO 18013-5 (proximity, BLE/NFC)
- Trust: EU Trusted Lists, Wallet Instance Attestations
- Privacy: Selective disclosure via SD-JWT. Full unlinkability via ZKPs mandated (Recital 14) but **not at launch** — batch issuance workaround for now. BBS# most promising post-launch ZKP scheme. Expect 2027-2028.
- Cross-border: Works by design. Demonstrated at December 2025 Launchpad event. Norwegian wallet verifies in Spain via EU Trusted Lists.

**Business acceptance mandate:** Late November/December 2027 — regulated sectors (banking, telecom, healthcare, VLOPs, DMA gatekeepers) must accept EUDI Wallet. Micro/small enterprises may be exempt.

**Norway specifically:**
- Digdir running "Program eIDAS 2026." KVU (concept study) completing **March 27, 2026** (this week).
- Led NOBID pilot (Nordic-Baltic). BankID and DNB participated.
- Still in strategic planning phase. ~18 months behind leading EU countries. Core wallet not yet under construction.
- Key question: state-built vs private provider wallet.

**Pilot results:**
- POTENTIAL: Cross-border interoperability proven. Common standards essential.
- NOBID: Validated payments (in-store/online), eID, attribute sharing across Nordic-Baltic.
- DC4EU: Educational degree validation reduced from weeks to 45 seconds. Healthcare rights verification from 30 minutes to 13 seconds.
- EWC: 80% found wallet-based checkout easier than traditional banking.

**Integration path for third parties:** OpenID4VP protocol. Use intermediary (Signicat, Hopae) rather than integrating 27+ national wallets directly. Plan 12-18 months.

### 1.4 Aadhaar (India)

- **Scale:** 1.3B enrolled, 99% adult coverage. 150B+ cumulative auth transactions.
- **Mechanism:** 12-digit number + biometrics (fingerprint, iris, face). eKYC returns yes/no only.
- **API access (Jan 2025 expansion):** Private sector can now apply for auth licenses. ~₹20 ($0.24) per transaction.
- **Outside India?** No. Residence-based enrollment (182+ days/year). Data localization mandated. No pathway for foreign entities.
- **Sybil resistance:** Extremely high (1:1 biometric match against 1.3B records).
- **For the commitment graph:** Architectural reference only. Not directly usable.

### 1.5 Human Passport (Holonym + Gitcoin Passport)

**The composite identity aggregator.**

- **History:** Holonym acquired Gitcoin Passport for $10M (Feb 2025). Rebranded to Human Passport under `human.tech`.
- **Scale:** 2M+ users, 34.5M+ ZK credentials, 120+ projects, $430M+ capital protected from sybils.
- **Mechanism:** Weighted additive score from verified Stamps. Each stamp weighted by cost-of-forgery. Default threshold: 20 points. Max: 100.
- **Stamp categories:** Biometric/KYC (Binance BABT: 16 pts, Civic: 6 pts), On-chain NFTs (10 pts), Identity Staking (14 pts), ETH activity (10 pts), GitHub (7 pts), Gitcoin Grants (5 pts), Social (Discord/Google: ~0.5 pts each).
- **ZK architecture:** Holonym's VOLE-based ZK prover — orders of magnitude faster for RSA/SHA256. Mobile browser proof-of-passport in seconds. Client-side computation only.
- **NFC passport verification:** 150+ countries via Private Passport Verifier app.
- **New (Q3 2025):** ZK Email Stamp (verifies Amazon/Uber activity via Gmail metadata ZKPs), ML-powered sybil detection on Base.

**Sybil resistance assessment:** Moderate-high. Gitcoin data shows fraud tax dropped from 6.6% (GR9) to 0.6% (GR11), but GR14 showed 35.8% sybil rate — arms race continued. Critical finding: many sybils had *higher* trust scores than real users because cheap stamps were easy to accumulate.

### 1.6 Proof of Humanity (Kleros)

- **Mechanism:** Video submission + social vouching + Kleros decentralized court for disputes.
- **Scale:** ~20K total registered (small). PoH V2 launched. PNK airdrop for first 10K verified.
- **Sybil resistance:** Strong dual-layer (video + vouching + penalties). But manual = doesn't scale.
- **Costs:** $100-200 gas on L1 per registration. Moving to Gnosis Chain for cheaper fees.
- **For commitment graph:** Too small and slow. Worth monitoring V2.

### 1.7 BrightID

- **Mechanism:** Social graph analysis. Connection parties (video calls). Force-directed graph algorithms push sybils to borders.
- **Privacy:** Very high — no personal info required.
- **Sybil resistance:** Moderate. Gameable with coordinated groups. Small-scale attacks are hard to detect.
- **Scale:** Niche. Active but limited growth.

### 1.8 Idena

- **Mechanism:** Synchronized "flip tests" — visual puzzles at global time slots. 1 person = 1 node.
- **Privacy:** High. Anonymous participation.
- **Scale:** ~5K-10K active. Too small for serious consideration.
- **Innovation:** Synchronous timing prevents operating multiple identities simultaneously. Novel but unproven at scale.

### 1.9 Humanity Protocol

- **Mechanism:** Palm scan via phone camera + ZK proofs. No specialized hardware.
- **Scale:** 6M+ test users, 8M+ reserved Human IDs.
- **Backing:** Polygon Labs + Animoca Brands. $1.1B valuation. Mastercard partnership.
- **Pivot (Feb 2026):** From "Proof of Personhood" to "Proof of Trust" — now a verifiable credentials ecosystem (age, residency, employment) on palm biometric foundation.
- **Phase 2:** External IR camera for palm vein scanning.
- **For commitment graph:** Interesting World ID alternative without hardware dependency. Newer, less proven. Phone-only approach suits developing world.

### 1.10 Other Systems

| System | Mechanism | Status | Relevance |
|--------|-----------|--------|-----------|
| **Humanode** | Facial liveness + uniqueness via 60+ AI modules | ~10K validators. BotBasher (Discord) has real traction | Privacy architecture good (CVM) |
| **Civic** | KYC + blockchain pass. Pivoted to "security layer for AI agents" | Civic Nexus (Q3 2025), Civic Auth | Enterprise-grade. SOC 2 compliant |
| **Fractal ID** | Privacy-preserving KYC → ZK credentials | Open-sourced. "Dataless KYC" | Good compliance model |
| **Privado ID** (ex-Polygon ID) | ZK identity primitives (Iden3/Circom) | Enterprise PoCs: Deutsche Bank, Citi, HSBC. "Billions" PoP system launched | Building blocks for composable identity |
| **Rarimo** | Cross-chain identity bridge | Polygon ID credentials on other chains | Infrastructure layer |
| **Polkadot PoP** | Novel ZK crypto, non-biometric | Project Individuality, $3M referendum. Gavin Wood | Emerging. Interesting non-biometric approach |

---

## 2. Comparative Analysis

| System | Global Reach | Uniqueness | Privacy | Permissionless? | User Cost | Sybil Resistance | Decentralized? |
|--------|-------------|------------|---------|----------------|-----------|-------------------|----------------|
| **BankID Norway** | ❌ Norway only | ★★★★★ | ★★ (full ID known) | ❌ (bank+gov) | ~2 NOK | ★★★★★ ($10K+ per fake) | ❌ |
| **eIDAS 2.0** | ⚠️ EU/EEA (~450M, 2027) | ★★★★★ | ★★★★ (selective disclosure, ZKP pending) | ❌ (gov mandate) | Free | ★★★★★ (gov-level fraud) | ⚠️ (designed decentralized) |
| **World ID (Orb)** | ✅ 160+ countries, 18M | ★★★★ | ★★★★ (ZK proofs) | ✅ | Free | ★★★★ ($30-70 per fake) | ⚠️ (hardware centralized) |
| **Aadhaar** | ❌ India only | ★★★★★ | ★★ (centralized DB) | ❌ (regulated) | ~$0.24 | ★★★★★ | ❌ |
| **Human Passport** | ✅ Global (150+ countries for NFC passport) | ★★★ | ★★★★ (ZK, client-side) | ✅ | Free-low | ★★★ ($5-50K per 1000) | ✅ |
| **Humanity Protocol** | ✅ Phone-only, global | ★★★ | ★★★★ (ZK, on-device) | ✅ | Free | ★★★ (palm collusion) | ⚠️ |
| **PoH Kleros** | ✅ Global (small) | ★★★★ | ★★ (video public) | ✅ | $100-200 (L1) | ★★★★ (expensive per fake) | ✅ |
| **BrightID** | ✅ Global (small) | ★★ | ★★★★★ | ✅ | Free | ★★ (small-scale gameable) | ✅ |
| **Idena** | ✅ Global (tiny) | ★★★★ | ★★★★ | ✅ | Free | ★★★★ (synchronous) | ✅ |

**Strongest per dimension:**
- **Global reach:** World ID (18M across 160 countries)
- **Uniqueness:** BankID/Aadhaar/eIDAS (government-backed biometric dedup)
- **Privacy:** BrightID (no personal data), then World ID/Humanity Protocol (ZK proofs)
- **Permissionless:** World ID, Human Passport, BrightID (no gatekeepers)
- **Sybil resistance:** BankID NFC path (zero fraud cases), then eIDAS/Aadhaar (gov infrastructure)
- **Decentralized:** BrightID, PoH Kleros, Human Passport

---

## 3. Composability: Can Multiple Weak Signals Make One Strong Identity?

### 3.1 The Theory

**Douceur (2002):** Without a trusted identity authority, sybil attacks are always possible. No purely protocol-level trick can infer unique human identity without an external anchor. This motivates composing multiple partial signals.

**Information theory:** To uniquely identify among 8B people, you need ~33 bits of identity entropy. A 90%-reliable signal provides ~3.3 bits. So ~10 independent 90%-reliable signals theoretically suffice. But independence is the hard part — having GitHub correlates with having Discord; on-chain activity across chains correlates.

**Practical minimum estimate (from evidence):**
- Minimum 3 truly independent signal *categories* (not individual stamps — categories with independent failure modes)
- At least 1 high-cost signal (government ID, financial stake, or biometric) providing 10+ bits
- At least 2 behavioral/social signals from uncorrelated domains providing 3-5 bits each
- Total entropy floor: ~20-25 bits for meaningful sybil resistance

### 3.2 Empirical Evidence: Gitcoin Grants

The most transparent real-world data on composite identity gaming:

| Round | Fraud Tax | Sybil Rate | Defense |
|-------|-----------|------------|---------|
| GR9 | 6.6% of matching pool | — | Manual review |
| GR10 | 2.1% | — | Multi-signal introduced |
| GR11 | 0.6% | 6.4% | Passport stamps + ML |
| GR14 | — | **35.8%** | Arms race: attackers adapted |
| GR15 | $285K squelched | ~23% | COCM + Model-Based Detection |
| GR20-23 | — | Improved | COCM + MBD standard |

**Key finding:** Composite identity reduced fraud dramatically (6.6% → 0.6%) but attackers adapted. At least 44 points achievable through moderately simple sybil vectors. Many sybils had *higher* trust scores than real users.

### 3.3 Composite vs. Single Biometric

| Dimension | Multi-Signal Composite | Single Strong Biometric |
|-----------|----------------------|------------------------|
| Forgery cost | Scales with independent signals | High per-identity but black market floor exists |
| Privacy | Selective — user chooses stamps | All-or-nothing biometric capture |
| Accessibility | High — many free stamps | Requires physical hardware |
| Centralization | Low — distributed providers | High — single hardware manufacturer |
| Degradation | Graceful — losing one signal reduces score | Binary — compromised biometric = total failure |
| Deepfake resistance | Moderate | Higher short-term (Buterin: "1-2 years" for general biometrics) |
| Regulatory | Flexible — add KYC stamps for regulated contexts | GDPR concerns in multiple jurisdictions |

**CyberConnect case study:** Integrating Gitcoin Passport reduced eligible participants from 278K to 70K in week one — 75% sybil reduction from composite scoring alone.

### 3.4 Academic Foundations

- **CanDID (IEEE S&P 2021, Cornell/IC3):** Converts legacy data sources into sybil-resistant, privacy-preserving credentials using DECO (Chainlink TLS oracles) + MPC for deduplication. PoC with J.P. Morgan.
- **Hades (ACM ACSAC 2023):** Fine-grained sybil resistance — dApps customize personalized strategies per user's identity attributes.
- **Upala:** Dollar-denominated forgery markets. Each identity has an "explosion price." Market dynamics force equilibrium on forgery cost.

### 3.5 The Gap

**Nobody has built:** BankID (government trust anchor) + World ID (biometric uniqueness) + on-chain history (behavioral proof) wrapped in ZK credentials with a formal composite score. Each component is production-ready. The integration is the innovation. Human Passport's meta-aggregation architecture provides the integration layer. Privado ID provides ZK composability primitives. The NOBID consortium provides regulatory/infrastructure foundation.

---

## 4. The Biometric Question

### 4.1 Is Biometric PoP the Inevitable Endgame?

**Arguments for inevitability:**
- Nothing else proves biological uniqueness at the individual level
- Behavioral signals are gameable. Social graphs are gameable. Only biometrics directly anchor to a physical body
- Buterin estimated general biometric security (phone face/fingerprint) viable "another 1-2 years" against deepfakes — specialized hardware (Orb) extends this window
- Every high-assurance government ID system uses biometrics (Aadhaar, eIDAS, BankID NFC)

**Arguments against:**
- Irrevocable. You cannot rotate an iris code like a password. If compromised, permanent
- Regulatory hostility is real and growing: 8+ countries banned World ID specifically
- Privacy nightmare *at registration moment* — even if storage is zero-knowledge, the act of scanning requires physical presence and creates a temporal/spatial record
- Creates power asymmetry: whoever controls the hardware controls the gate. World's Orb is proprietary (open-sourced software, not hardware)

### 4.2 The Privacy/Adoption Tradeoff

**The honest risk/reward:**
- Risk: Mass biometric collection by a private company (even with ZK storage) creates a permanent surveillance vector. Regulatory bans demonstrate this isn't theoretical
- Reward: 18M verified unique humans across 160 countries — the only global-scale permissionless PoP that exists
- The tradeoff is asymmetric: privacy loss from compromise is permanent, security gain from adoption is contingent

### 4.3 Non-Biometric Alternatives for Uniqueness

| Approach | Uniqueness Guarantee | Practical Scale |
|----------|---------------------|-----------------|
| Government ID (BankID, eIDAS) | Very high | Regional (Nordics: 25M, EU/EEA: 450M by 2027) |
| Synchronized puzzle tests (Idena) | High (temporal constraint) | ~5K-10K |
| Social graph (BrightID) | Low-moderate | Small |
| Composite scoring (Human Passport) | Moderate | 2M+ |
| Behavioral biometrics (typing/gait) | Unknown at scale | Emerging |
| Polkadot PoP (novel ZK crypto) | Unknown | Not yet launched |

**Honest assessment:** No non-biometric, non-government approach achieves the uniqueness guarantee needed for a high-value commitment graph at global scale. The choice is between:
1. Government ID (high trust, regional, not permissionless)
2. Specialized biometrics (global, permissionless, privacy concerns)
3. Composite scoring (global, permissionless, weaker uniqueness)
4. Some combination of the above

### 4.4 Recommendation on the Biometric Question

**Both.** The commitment graph should not pick one — it should abstract over all of them. Biometric proof of personhood is likely the endgame for *global, permissionless* uniqueness. But:
- Don't require it. Accept it as a strong signal alongside government ID and composite scoring
- Design the identity layer so that as eIDAS 2.0 matures, government ID becomes the dominant path in EU/EEA (higher trust than iris, no private company dependency)
- Accept biometric PoP (World ID, Humanity Protocol) as the bridge for regions without government digital ID
- Never build or operate biometric hardware — consume what exists via SDK/OIDC

---

## 5. The Developing World

### 5.1 The Numbers

- **800 million** lack any legal ID (down from 1B+ in 2017)
- **3.3 billion** cannot access government-recognized digital ID for online transactions
- **5.6 billion** have smartphones (2025)
- **94%** of African mobile subscriptions are prepaid — SIM = primary identity touchpoint
- **155 countries** have mandatory SIM registration

### 5.2 What Works Without Government ID

**Tier 1 — Phone-only, no gov ID required (works today):**
1. Palm print via phone camera (Humanity Protocol: 6M+ test users)
2. Facial liveness with on-device AI (gestures + speech)
3. Phone/SIM possession as weak signal
4. Social graph vouching (hard to bootstrap without crypto community)

**Tier 2 — Requires some existing identity:**
5. Mobile money transaction history (M-Pesa/GCash — behavioral identity)
6. SIM registration tied to national ID (155 countries, excludes bottom 800M)
7. National digital ID where available (Nigeria NIN: 127M, Philippines PhilSys: 84M)

**Tier 3 — Requires specialized hardware:**
8. Iris scanning (World Orb) — banned in most developing-world markets
9. Palm vein scanning (Humanity Phase 2 — needs external device)

### 5.3 World ID Orb Deployment Gaps

Structurally failing in the developing world:
- **Banned/suspended:** Kenya, India, Brazil, Indonesia, Hong Kong
- **Strong only in:** Argentina (Buenos Aires flagship), Colombia (~2M users)
- Orb Mini (portable, smartphone-sized) expected 2026 — could change equation if it ships
- Manufacturing factory being built in Texas — focus is US scale, not developing world

### 5.4 Regional Identity Systems

| Region | Key Systems | Scale | Digital Readiness |
|--------|-------------|-------|-------------------|
| **Nigeria** | NIN | 127M enrolled, 1.3M daily verifications | NINAuth tokenization, target 180M by Dec 2026 |
| **Kenya** | Huduma Namba + M-Pesa | 31M enrolled; M-Pesa: $300B+ annual transactions | M-Shwari uses transaction history as credit identity |
| **Rwanda** | Single Digital ID System | Launching 2026, $57M investment, 300K biometrically enrolled | Most innovative African approach |
| **Philippines** | PhilSys/National ID | 84M digital IDs | GCash integration: 41% of verifications use National ID |
| **Indonesia** | e-KTP → IKD (digital) | 200M+ biometric registered | Mandatory biometric e-SIM registration |
| **India** | Aadhaar | 1.3B enrolled | Not exportable. India-only by design |

### 5.5 Mobile Money as Identity

M-Pesa model: 6+ months of transaction history + Safaricom usage → credit score (M-Shwari). Transaction history IS the identity signal. Proves sustained economic activity, SIM possession, behavioral uniqueness.

**Limitations:** Doesn't prove the phone user is the registered owner. Doesn't prove uniqueness across providers. Doesn't prove humanity vs. automation. Best as one signal in multi-factor system.

### 5.6 Architectural Conclusion for the Developing World

No single method works globally. The viable path is **multi-signal, phone-native, privacy-preserving:**
- Start with what people already have (phone, SIM, usage history)
- Layer on phone-camera biometrics (palm, face liveness) with on-device processing
- Add behavioral signals over time (passive, continuous)
- Support but don't require government ID
- Use ZK proofs throughout
- Degrade gracefully — more signals = higher trust score, but the system works with fewer

---

## 6. Agent Identity

### 6.1 World ID AgentKit (March 17, 2026)

AI agents carry ZK proof they are backed by a unique, iris-verified human.

- **How:** Verified World ID holder registers agent → delegated ZK credential → agent presents proof of human backing → one human can delegate to multiple agents, platforms enforce per-human limits
- **Integration:** Built on x402 protocol (Coinbase/Cloudflare micropayments embedded in HTTP). Agent pays + proves human backing in single flow
- **Use cases:** Free-trial abuse prevention, phone number allocation, content curation integrity
- **Status:** Limited beta. 1.0 planned alongside next protocol generation
- **Chicken-and-egg:** Requires mass iris-verification adoption, which requires a must-have use case, which requires mass adoption

### 6.2 ERC-8004: Trustless Agents

On-chain agent identity standard. **Mainnet since January 29, 2026.**

Authors: Marco De Rossi (MetaMask), Davide Crapis (Ethereum Foundation), Jordan Ellis (Google), Erik Reppel (Coinbase).

Three lightweight registries:
1. **Identity Registry:** Agent minted as ERC-721 NFT → agent card (name, capabilities, endpoints, payment address)
2. **Reputation Registry:** Bounded numerical scores + categorical tags. Pre-authorization via EIP-191/ERC-1271 signatures
3. **Validation Registry:** Agents request validation → validator contracts respond pass/fail

10K+ agents registered on testnet before mainnet. Ecosystem support: ENS, EigenLayer, The Graph, Taiko. Growing from 337 to ~130K agents since start of 2026 (+39,000%).

### 6.3 Agent Identity Inheritance Models

Three models for proving an agent represents a verified human:

**Model A: ZK Delegation (World AgentKit)** — Human's World ID → ZK proof of human backing → agent carries proof. Strongest privacy. Requires World ID adoption.

**Model B: On-Chain Delegation (ERC-7710, KYA)** — Human's KYC attestation is address-bound. Agent at different address needs delegation contract with spending caps, time limits, scope boundaries. DeFi protocols must be updated to check delegation chains.

**Model C: Verifiable Credentials with Selective Disclosure** — Human obtains VC from identity provider → issues derived VC to agent with minimum attributes → agent presents via W3C protocols.

**Emerging framework: "Know Your Human" (KYH)** — beyond KYC/KYB. Continuous validation that human remains in control, consent was informed, agent permissions are bounded.

### 6.4 Should Agents Have Separate Identity?

**2026 consensus: Yes, but tethered to human accountability.**

- Agents fit neither "human user" nor "service account" — they reason, interpret, take dynamic actions
- Under borrowed credentials, system logs show human performing actions human didn't take (attribution destroyed)
- Real-world failures: Google's Antigravity agent deleted entire Drive; Replit agent deleted production database during code freeze
- Enterprise vendors responding: Okta (GA April 30, 2026), SailPoint (connectors for Microsoft 365 Copilot, Bedrock, Vertex AI, Salesforce Agentforce)
- Gartner: by 2026, 30% of enterprises rely on agents acting independently

### 6.5 Agent-to-Agent Trust

**No major vendor ships mutual agent-to-agent authentication in production yet.**

The gap is real:
- 82:1 agent-to-human ratio in hybrid workforces
- 87% cascading compromise within 4 hours from single compromised agent (Galileo AI simulation)
- 89% YoY increase in AI-enabled attacks (CrowdStrike)
- Only 6% of organizations have advanced AI security strategy

**Approaches converging:**
- IETF draft (March 2026): WIMSE + SPIFFE + OAuth 2.0. Composition of existing standards
- Google A2A: On-Behalf-Of pattern preserving identity through agent chains
- Microsoft: Extending Zero Trust to agentic AI (RSAC 2026, March 20)
- Agentic AI Foundation (Linux Foundation, Dec 2025): Anthropic MCP + OpenAI AGENTS.md + Block Goose

### 6.6 For the Commitment Graph

Should agents have their OWN commitment data, separate from operator?

**Yes, with constraints:**
- An agent that independently shops, visits, and transacts generates genuine commitment signals
- These signals are useful data — an AI shopping agent's repeat purchases at a store IS a commitment signal
- But agent signals must be distinguishable from human signals and weighted differently
- Every agent must trace to an accountable human (per-human limits on agent count/activity)
- Agent commitment data should be labeled as such — "agent visited" vs "human visited" are different trust signals

---

## 7. Attack Vectors

### 7.1 Cost Per Fake Identity

| System | Cost (1 identity) | Cost (1,000 identities) | Primary Constraint |
|--------|-------------------|------------------------|--------------------|
| **BankID Norway (NFC)** | $500-5,000+ | $500K+ | Physical gov ID + NFC chip + liveness |
| **eIDAS 2.0** | Gov-level fraud | Prohibitive | National registry infrastructure |
| **World ID (Orb)** | $30-70 | $30K-70K | Unique human iris at physical Orb |
| **Proof of Humanity** | $110-250 (L1) | $110K-250K (L1) | Video + deposit + gas + vouch chain |
| **Human Passport** | $5-50 | $5K-50K | Aged accounts + multiple credential stamps |
| **BrightID** | $10-50 | $10K-50K | Physical attendance at connection parties |
| **Idena** | ~$20 | ~$20K | Synchronous time slot per identity |
| **Dark web fullz (no PoP)** | $4-100 | $4K-100K | Supply of stolen PII |

### 7.2 Documented Attacks

**World ID:**
- Black market: Verified IDs sold for $30 on Chinese ecommerce (May 2023). "A few hundred instances" per Worldcoin
- Orb operator compromise: Malware → portal access. CertiK found verification bypass bug
- Kenya: 350K signed up, informal cash-for-tokens markets at Orb locations
- Singapore: Investigation for money laundering via account trading

**Gitcoin Passport:**
- GR14: 35.8% of contributors (16,073/44,886) flagged as sybils
- GR15: $285K in fraudulent matching squelched
- Attack methods: Bulk transfers from common source, coordinated donation patterns, sequential behavior automation

**BankID/Nordics:**
- 930M NOK ($93M) bank fraud losses in Norway (2023)
- 800K Norwegians (~18%) victimized by fraud/ID theft (2024)
- Phishing now ~40% of fraud cases. But NFC path: zero fraud

### 7.3 Deepfakes vs. Biometric Systems

The arms race is real:
- **+1,400%** deepfake attacks in H1 2024. 1 attempt every 5 minutes (Entrust)
- **+704%** biometric authentication bypass attempts (2023)
- Deepfake toolkits now cost **<$20**
- Best detection systems claim 98%+ rate, but novel deepfakes cause 40-50% accuracy drop
- Dark web forums show criminals frustrated by blood flow/micro-muscle detection — advanced liveness checks work
- BankID Norway NFC + iProov = zero fraud. This is the current gold standard

### 7.4 The Crowdturfing Attack (Commitment Graph-Specific)

**The hardest attack to defend against.** Paying real humans to generate authentic-looking behavioral data.

Ben Zhao (UC Santa Barbara): *"If you have a real human involved who is determined, then what you can do is really only limited by the price they are paid."*

Cost: $0.10-0.50 per action via crowdsourcing platforms. Building 1,000 convincing behavioral profiles: $50K-500K depending on depth required.

**Why it's uniquely dangerous for a commitment graph:**
- The behavioral data IS authentically human-generated — no deepfake/bot signature to detect
- Cross-validated against "whole-life patterns" is the only defense (expensive behavior over time)
- The commitment graph's value proposition (real behavioral data from real people) becomes the attack surface

**Defenses:**
- Economic barriers: Make each action cost more than attacker is willing to pay
- Temporal requirements: Require sustained behavior over timeframes that make renting humans expensive
- Cross-signal consistency: Does this person's spending match their location, demographics, other data?
- Statistical anomaly detection: Hired agents show "shirking" — reuse content, time-bounded activity
- Coordination graph mapping: Coordinated timing patterns reveal hired agents

### 7.5 The Meta-Insight

**No system is sybil-proof.** Every system examined has been attacked or has documented weaknesses. The question is not "which is unbreakable?" but "which makes attacks cost more than the expected gain?"

For a commitment graph where a sybil contributes fake behavioral data to influence trust scores: the gain from one fake identity is relatively small (one additional data point among many). This means the *per-identity attack ROI is low*, which is a structural advantage. Making each fake identity cost even $30-70 (World ID level) may be sufficient — the attacker needs thousands to meaningfully influence aggregate scores.

---

## 8. Recommendation: Identity for the Commitment Graph

### 8.1 Core Architecture: Pluggable Identity Abstraction

**Don't pick one provider. Abstract over all of them.**

```
User → Identity Provider (BankID | World ID | eIDAS | Humanity Protocol | Human Passport)
     → Verifiable Credential: "verified unique human"
     → ZK proof strips identifying info
     → Anonymous behavioral data contribution
```

The network sees "verified unique human, trust level N" — never which human or which provider. OIDC + W3C Verifiable Credentials are the standards. Both BankID and World ID already support OIDC. eIDAS 2.0 builds on W3C VCs. The abstraction is technically feasible today.

### 8.2 Launch Sequence

**Phase 0 — Nordic MVP (Now):**
- BankID Norway via OIDC (Signicat or Criipto). Everyone has it. Zero fraud on NFC path
- Highest possible trust level. ~1-2 NOK per verification
- This is the "Bitcoin genesis block" — small, high-trust, provably real

**Phase 1 — Nordic Expansion (2026):**
- Add Swedish BankID, Danish MitID, Finnish FTN, Estonian Smart-ID
- All OIDC-compatible. Via aggregators or direct integration
- ~25M potential users at highest trust level

**Phase 2 — Global Bridge (2026-2027):**
- Add World ID (18M verified, 160 countries, OIDC-compatible, free SDK)
- Add Humanity Protocol (phone-only biometric, developing world coverage)
- Lower trust level than BankID but enables global participation
- Accept Human Passport for composite scoring in regions without other options

**Phase 3 — eIDAS Maturity (2027-2028):**
- EUDI Wallet integration via OpenID4VP
- 450M potential users across EU/EEA
- Government-backed, selective disclosure, highest trust alongside BankID
- May eventually supersede BankID as Nordic provider

**Phase 4 — Agent Identity (2027+):**
- ERC-8004 for on-chain agent registration and reputation
- World AgentKit or VC-based delegation for human-backed agents
- Agent commitment data labeled and weighted separately from human data
- Per-human limits on agent count and activity

### 8.3 Trust Tiers

Not all identity providers are equal. The network should assign trust tiers:

| Tier | Provider Examples | Trust Level | Commitment Data Weight |
|------|-------------------|-------------|----------------------|
| **Tier 1** | BankID NFC, eIDAS EUDI Wallet | Maximum | Full weight |
| **Tier 2** | World ID (Orb), government KYC via ZK | High | Full weight |
| **Tier 3** | Humanity Protocol (palm), Human Passport (composite ≥40) | Medium | Weighted 0.7x |
| **Tier 4** | Human Passport (composite 20-39), social vouching | Low | Weighted 0.3x |
| **Agent** | ERC-8004 + human delegation | Derived from operator | Labeled separately |

Higher trust = stronger data signal. Lower trust = still contributes but with less influence on aggregate scores. This creates natural incentive to upgrade identity without excluding people.

### 8.4 Should Identity Be Pluggable from Day One?

**Yes. This is the single most important architectural decision.**

Reasons:
1. The PoP landscape is moving extremely fast. Picking one provider locks you into their trajectory
2. eIDAS 2.0 will reshape the landscape by 2027-2028 — any day-one choice may be wrong by then
3. Different regions need different providers (BankID in Nordics, World ID in South America, Humanity Protocol in Africa)
4. Provider-agnostic design IS the moat. It makes the commitment graph more valuable than any provider-specific alternative
5. Migration risk is real: if you build on one provider and need to switch, you lose all users

**The standards exist:** OIDC (universal auth), W3C VCs (credential format), DIDs (identifiers), OpenID4VP (presentation). These are not experimental — they're deployed in production by BankID, World ID, and eIDAS pilots.

**Implementation cost:** An OIDC gateway abstracting over 2-3 providers is a few weeks of engineering. The VC issuance layer uses existing libraries (Spruce, walt.id, Veramo). The ZK proof layer uses Semaphore V4 or Iden3/Circom. This is integration work, not R&D.

### 8.5 What's the Risk of Picking Wrong?

**Medium-high if you pick a single provider. Low if you abstract from day one.**

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Provider banned/shut down | Medium (World ID: 8 countries) | High (all users on that provider lose access) | Multi-provider from day one |
| Provider pivots away from PoP | Medium (Humanity Protocol just pivoted) | High | Abstraction layer insulates |
| eIDAS 2.0 delayed past 2027 | Medium (some countries lagging) | Low (BankID fills Nordic gap) | Don't depend on eIDAS timeline |
| Biometric tech obsoleted by deepfakes | Low-medium (3-5 year horizon) | Medium | Weight biometric signals lower over time |
| New PoP breakthrough emerges | Medium | Positive (add to abstraction layer) | Pluggable architecture by design |

### 8.6 The Minimum Viable Identity for Launch

1. **BankID Norway OIDC integration** — one provider, highest trust, everyone in Norway has it
2. **VC issuance layer** — converts BankID verification into "verified unique human" credential
3. **ZK proof generation** — Semaphore V4 for anonymous group membership proofs
4. **Identity abstraction interface** — designed to accept additional providers from the start

Cost: Weeks of engineering. Standard integrations. No novel cryptography required.

### 8.7 The Ideal Long-Term Identity Stack

```
Identity Abstraction Layer (OIDC + W3C VC + ZK)
├── Government eID
│   ├── BankID Norway, Sweden, Denmark, Finland
│   ├── Estonian Smart-ID / e-Residency
│   ├── eIDAS 2.0 EUDI Wallet (EU/EEA)
│   └── [Future: Nigeria NIN, Philippines PhilSys, etc.]
├── Biometric PoP
│   ├── World ID (Orb — iris)
│   ├── Humanity Protocol (phone — palm)
│   └── [Future: Polkadot PoP, etc.]
├── Composite Identity
│   ├── Human Passport (multi-signal scoring)
│   └── [Future: custom composite for regions without other options]
├── Agent Identity
│   ├── ERC-8004 (on-chain registration + reputation)
│   ├── World AgentKit / VC delegation (human-backed proof)
│   └── Per-human agent limits + labeled data
└── Trust Tier Engine
    └── Assigns weight per provider. Updates as providers prove/lose reliability.
```

### 8.8 Open Questions

1. **What trust tier should be the minimum for participation?** Too high = excludes developing world. Too low = sybil vulnerability. Recommendation: accept Tier 4 but weight their data minimally. Let the market (query fees, staked endorsements) determine the marginal value of different trust tiers.

2. **Should the network charge for identity verification or subsidize it?** BankID costs ~1-2 NOK. World ID is free. Recommendation: free at the network level (funded by query fees). Identity verification is the network's security mechanism — taxing it reduces security.

3. **How to handle identity revocation/upgrade?** A user who starts at Tier 4 and later gets BankID should seamlessly upgrade. Their historical data should be re-weighted. Design the data model for this from day one.

4. **Cross-provider deduplication?** If someone verifies with both BankID AND World ID, the network should recognize them as one person, not two. This requires a privacy-preserving deduplication mechanism (CanDID-style MPC).

---

## Sources

Research conducted March 22, 2026. Key sources:

**World ID:** CoinDesk (March 17, 2026), World blog/whitepaper, TechCrunch, Vitalik Buterin blog (July 2023), Pantera Capital analysis, The Register.
**eIDAS 2.0:** EU Commission regulation text, Digdir.no (Program eIDAS 2026), EUDI ARF GitHub, Biometric Update, Signicat, NOBID Consortium reports, DC4EU/POTENTIAL pilot reports.
**BankID:** BankID developer docs, Finans Norge fraud report 2025, Biometric Update (NFC zero fraud), Tietoevry survey.
**Composite Identity:** Gitcoin Grants fraud reports (GR9-GR23), Holonym/Human.tech blog, Upala whitepaper, CanDID (IEEE S&P 2021), Hades (ACM ACSAC 2023).
**Agent Identity:** EIP-8004 specification, IETF draft-klrc-aiagent-auth (March 2026), Agentic AI Foundation (Linux Foundation), Okta/SailPoint announcements, arXiv papers on agent identity delegation.
**Developing World:** World Bank ID4D global dataset, M-Pesa/GCash documentation, Nigeria NIMC, Philippines PhilSys, GSMA mobile money reports.
**Attack Vectors:** CrowdStrike 2026 Global Threat Report, iProov/Entrust deepfake statistics, Flashpoint/Privacy Affairs dark web pricing, Ben Zhao crowdturfing research (MIT Technology Review).
