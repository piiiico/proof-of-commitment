# PageRank 2026: Incentive Mechanism Design

*Deep research on earn/lose mechanisms for staked commitment data. Produced 2026-03-21.*

---

## Executive Summary

This document analyzes how a behavioral trust network could incentivize genuine data contribution and penalize gaming. After studying 15+ precedent systems — from Numerai's prediction tournaments to Filecoin's storage collateral to Reddit's karma — three candidate mechanism designs emerge, each with distinct tradeoff profiles.

**The central finding:** Every tokenized data marketplace has failed (Ocean -95%, Streamr -99.7%, Swash -99.8%, Datum -100%). Every successful behavioral data project (Brave, 101M users) succeeded by building a product people wanted first and adding incentives second. The mechanism must serve the product, not be the product.

---

## Part 1: Precedent Analysis

### 1.1 Numerai — The Closest Analogy

Numerai is the most instructive precedent because it rewards *signal quality*, not just data volume.

**How it works:**
- Data scientists build ML models on obfuscated financial data and stake NMR tokens ($7.82/NMR, March 2026) on their predictions.
- Staked predictions are combined into a Stake-Weighted Meta Model (SWMM) that controls the hedge fund's trades.
- Payout formula: `stake_value * clip(payout_factor * score, -0.05, +0.05)`
- Payout factor = `min(1, threshold / total_staked)` — currently ~0.072 (7.2% efficiency) with ~1M NMR staked against a 72K threshold.
- Burns are irreversible — NMR sent to null address, on-chain verifiable.
- The meta model consistently outperforms every individual model — the mechanism genuinely aggregates wisdom.

**What works:**
- Skin-in-the-game creates credible signaling. Burns are permanent and verifiable.
- The payout factor creates automatic equilibrium — overcrowding self-corrects.
- Progressive scoring evolution (CORR → TC → MMC → MPC) iterates toward rewarding unique contribution.
- Sustained operation since 2017: 1,000+ rounds, $40M+ payouts, AUM growing ($60M → $550M in 3 years).

**What fails:**
- **NMR price volatility dominates returns** — >80% of ROI variance is token price, not model quality. The single biggest churn driver.
- **Treasury depletion is structural** — ~355K NMR burned lifetime vs $40M+ paid out. System depends on external revenue (fund fees → buybacks).
- **Feedback loop is 1-3 months** — extremely slow iteration. A researcher testing 12 approaches needs 12-36 months of live testing at financial risk.
- **Payout factor deflation** — early participants captured disproportionate value. Late entrants face structurally diminished returns.
- **Asymmetric risk** — payouts reduced by payout factor, burns are NOT proportionally reduced. Can create negative expected value.

**Key numbers:** 30,000 registered, ~1,200 staked models weekly (4% active rate). Monthly payouts: $180K-$530K. USDC staking option coming July 2026 to address volatility.

**Relevance:** Numerai proves that staking on signal quality can produce genuine wisdom-of-crowds effects. But the volatile token denomination and slow feedback loops are existential problems for retention.

### 1.2 DePIN Networks (Filecoin, Hivemapper, Helium)

Three hardware-dependent networks that each reveal different failure modes.

#### Filecoin — Collateral + Slashing

- Storage providers lock ~6.4 FIL/TiB (CC sectors) or ~64 FIL/TiB (verified deals, 10x multiplier).
- Fault fees: 3.51 days of expected block rewards per day offline. Accumulated unpaid fees ("Fee Debt") block future rewards.
- **What worked:** The collateral/slashing model keeps the storage network relatively honest. Genuine economic skin-in-the-game.
- **What failed:** The 10x reward multiplier for "verified deals" was the single biggest gaming vector. The notary system meant to verify data quality devolved into self-dealing, collusion, and fraudulent verification. Encrypted data made verification "extremely difficult (impossible)."
- **Current state:** FIL at $0.90 (down 99.6% from ATH). Network shrank 82% (17 EiB → 3 EiB) but utilization improved to 36%.

**Lesson:** Reward multipliers create gaming proportional to their size. Human verification layers are systematically vulnerable to social engineering.

#### Hivemapper — Visual Consensus

- Dashcam contributors earn ~2 HONEY/km. At current price ($0.003): ~$0.006/km or ~$10-24/month for average drivers.
- Quality measured via multi-device visual consensus: multiple independent devices observing the same location must agree on detected features. Device diversity weighting, trust ramp for new devices, confidence scoring.
- Burn-and-mint: customers burn HONEY for Map Credits. 25% re-minted to contributors, 75% permanently destroyed.
- **What worked:** Visual consensus across independent devices is structurally harder to spoof than self-attestation. Enterprise customers (HERE, TomTom, Mapbox, Lyft) provide real demand.
- **What failed:** HONEY down 99.7% from ATH. At current prices, a frequent driver nets ~$5/month after $19/month subscription cost. Hardware delivery delays of 6-14+ months documented.

**Lesson:** Multi-source consensus (independent devices agreeing) is the strongest verification mechanism among DePINs. Real enterprise revenue from data buyers is the only sustainable foundation.

#### Helium — The Cautionary Tale

- Hotspot operators earned HNT through Proof of Coverage (beaconing, witnessing).
- **Spoofing was catastrophic:** 5% of hotspots network-wide confirmed fake; 37% in Hong Kong/Shenzhen. Spoofers placed 5-20 miners in a single room but asserted locations kilometers apart. They formed closed validation loops.
- The reward for proving coverage vastly exceeded the reward for actual data transfer. At one point: $5B+ market cap sitting on $6,561/month in genuine data usage.
- HNT crashed 96% from ATH. 60% of hotspots shut down. Operators went from $3,000/month (2021) to $0.20/day.
- **Recovery:** Now $22M annualized revenue from carrier offloading (T-Mobile, AT&T). DC burns exceeded HNT emissions for the first time. But token still fell 80% during this recovery.

**Lesson:** When the reward for proving contribution (coverage) exceeds the reward for actual utility (data transfer), gaming dominates. Self-attestation plus mutual witness validation = closed fraud loop. Token price collapse destroys contributor retention regardless of fundamental improvement.

### 1.3 Data Marketplaces (Ocean, Streamr, Swash, Datum)

**Universal outcome: failure.**

| Project | Peak Price | Current | Decline | Status |
|---------|-----------|---------|---------|--------|
| Ocean (OCEAN) | $1.94 | ~$0.34 | -82% | Left ASI Alliance. Unverifiable adoption. |
| Streamr (DATA) | $0.346 | ~$0.001 | -99.7% | 187 nodes. $490K cash. Pivoted to video. |
| Swash (SWASH) | $0.95 | ~$0.002 | -99.8% | Pivoted to generic earning portal. |
| Datum (DAT) | ~$0.10 | Dead | -100% | Dead since 2021. |

**Common failure pattern:**
1. Token emissions simulate marketplace activity
2. Emissions mask absence of organic demand
3. When emissions slow, the facade collapses
4. Individual data has near-zero marginal value — users report earnings don't justify sharing
5. Crypto-native users (who understand datatokens) ≠ enterprise data buyers (who use Snowflake)

**Ocean's specific mechanism:** Data NFTs (ERC-721) + datatokens (ERC-20) + veOCEAN lockups + Data Farming rewards. Compute-to-Data was genuinely novel (run ML on data without seeing it). But TVL was untrackable on standard dashboards, fee generation was flat, and the complexity (five-layer token system) alienated both data producers and consumers.

### 1.4 Brave/BAT — The Exception That Proves the Rule

- 101M monthly active users (September 2025). 42M daily.
- Users opt into privacy-respecting ads, earn 70% of ad revenue in BAT tokens.
- BAT price: $0.17 (down 91% from ATH). But Brave has $26M revenue and $980M valuation.
- **Why it works:** Brave built something 101M people wanted (fast, privacy-respecting browser with built-in ad blocking) **before** adding BAT. The token is additive, not foundational. If BAT disappeared, Brave would still have 101M users.

**The definitive lesson:** Product-first, token-second is the only pattern that has worked for behavioral data incentives. Every project that led with the token failed.

### 1.5 Non-Financial Reputation (Reddit, Stack Overflow)

**Reddit Karma:**
- Non-linear, deliberately opaque scoring. Vote fuzzing prevents manipulation verification.
- Threshold gating (minimum karma to post in subreddits) is the primary functional use.
- Gaming: AI-powered karma farming, account black market ($50-$200/account), coordinated astroturfing.
- Scale (1.7B MAU) makes manipulation expensive relative to organic activity.

**Stack Overflow Reputation:**
- Clear point values (+10 per answer upvote, +15 accepted, -2 downvote received).
- Ascending privilege thresholds unlock real capabilities (edit at 2K, close at 3K, moderate at 10K).
- 200/day cap limits gaming velocity. Downvoting costs -1 rep (asymmetric friction).
- Question volume dropped 78% (Dec 2024 → Dec 2025) as developers use LLMs instead.

**Key lessons:**
- **Threshold gating** — reputation unlocking capabilities — is the most defensible function. It creates real utility.
- **Opacity** (vote fuzzing, silent deletion) is a deliberate defense: reduces attacker's ability to verify manipulation success.
- **Asymmetric costs** (downvoting costs the downvoter) shape behavior more effectively than rewards alone.
- **Domain specificity** matters: SO rep is meaningful within context because privileges map to real capabilities.

---

## Part 2: Earning Models

### 2A. Informational Earning — "Better AI for Contributors"

**How it works:** Contributors share behavioral data and receive higher-quality AI recommendations in return. Non-contributors get a degraded experience. Classic club goods model.

**Precedents:** Wikipedia (contributors get editing privileges), Waze (contributors get better traffic data), loyalty programs (data-for-discounts exchange).

**Advantages:**
- Solves the free-rider problem structurally through excludability.
- No token/financial complexity. No regulatory crypto overhead.
- Aligns incentives perfectly: the more you contribute, the better *your* AI works.
- Creates a network effect: each additional contributor makes the AI better for everyone, which attracts more contributors.

**Problems:**
- **Marginal value of one person's data approaches zero in a large network.** If 100,000 people contribute, person 100,001's data barely moves the needle on AI quality. The contributor can't perceive the improvement.
- **Hard to demonstrate causation.** "Your AI recommendation was better because you shared your purchase history" is hard to prove to the user.
- **Cold start problem.** Early contributors share data but get little back because the network is too small. Must seed with public data (Google Reviews, Mattilsynet, Brønnøysund) to provide immediate value.

**Empirical evidence:** 85% of US adults belong to loyalty programs, but 43% quit because rewards felt meaningless. The club-goods model works *only if* the quality difference between contributor and non-contributor experience is perceivable and immediate.

### 2B. Financial Earning — Tokens, Fee Sharing, or Direct Payment

**How it works:** Contributors earn monetary rewards — whether tokens, cashback, or direct payment — proportional to the quality and volume of their data contributions.

**Precedents:** Numerai ($40M+ paid to data scientists), Hivemapper (HONEY tokens), Brave/BAT (70% ad revenue share), loyalty program cashback.

**Advantages:**
- **Clear, immediate, measurable incentive.** Empirical research: $0.25-$1.75 per data point gets 64%+ participation in lab settings.
- **Cashback is the #1 preferred reward** (64% of users in loyalty research).
- **Small, frequent, immediate rewards** outperform large delayed ones. Instant gratification increases engagement by 36%.

**Problems:**
- **Token denomination introduces volatility risk.** Numerai's biggest churn driver: >80% of ROI variance is token price, not model quality.
- **Token emissions mask absence of demand.** Every tokenized data marketplace failed when emissions slowed (Ocean, Streamr, Swash).
- **Regulatory complexity.** Securities classification, KYC/AML requirements, cross-border tax implications.
- **Attract mercenaries, not contributors.** Financial incentives draw people optimizing for reward extraction, not data quality. The Filecoin verified deal gaming, Helium spoofing, and Reddit account farming all demonstrate this.
- **Who pays?** The buyer side is the consistent failure across all data marketplace projects. Without real revenue from data consumers, financial rewards are unsustainable subsidy.

**Key finding from loyalty research:** 77% of transactional loyalty programs fail within 2 years (McKinsey). The mechanism must create emotional/functional loyalty, not just transactional exchange.

### 2C. Reputational Earning — Influence Scales with Contribution

**How it works:** High-quality contributors gain influence in the network — their data carries more weight in recommendations, they unlock governance privileges, they gain visible status.

**Precedents:** Stack Overflow (privileges at thresholds), Reddit karma (posting access), Numerai leaderboard, Wikipedia admin privileges.

**Advantages:**
- Robust against direct financial manipulation (no arbitrage opportunity).
- Creates a power hierarchy that incentivizes long-term engagement.
- Self-reinforcing: high-reputation users have more to lose, making them more trustworthy.

**Problems:**
- **May not be tangible enough** to drive initial adoption. "Your data carries more weight" is abstract.
- **Vulnerable to indirect manipulation** when the platform has strategic value (Reddit's karma farming industry).
- **AI-generated content** has escalated gaming faster than detection can respond.
- **Power concentration:** SO's reputation distribution is extremely heavy-tailed (0.46% of users have >5,000 rep).

### 2D. Hybrid — The Only Viable Path

No single model works alone. The research uniformly points to a layered approach:

1. **Base layer: Informational** — better AI quality for contributors (club goods exclusion).
2. **Engagement layer: Small, frequent financial rewards** — cashback or service credits, redeemable immediately.
3. **Governance layer: Reputational** — contribution quality unlocks influence and capabilities.

---

## Part 3: Losing Models

### 3A. How to Detect Noise and Manipulation

**Statistical Anomaly Detection:**
- Z-Score analysis (threshold: 3 standard deviations)
- IQR-based outlier detection (no normality assumption needed)
- Isolation Forest (effective for high-dimensional behavioral data, no labeled training data needed)
- Local Outlier Factor (density-based, good for spatial/behavioral patterns)

**Cross-Validation Against Other Users:**
- Collaborative filtering consistency — if User A's purchases correlate with similar users' purchases, data is likely genuine.
- Geographic plausibility — can the user physically have been at the reported locations given timestamps?
- Temporal consistency — sudden shifts (0 to 100 transactions/day) indicate gaming.
- Category consistency — do purchases form coherent preference clusters or random noise?

**Prediction Accuracy Contribution:**
- The gold standard: does adding this user's data improve predictions for other users?
- Measurable via RMSE, NDCG, Hit Rate, MRR.
- Feedback loop: 1-4 weeks for purchase recommendations, days-weeks for visit recommendations.
- Cold start: ~60% of new users may get irrelevant recommendations until 5-10 interactions accumulate.

**Peer Prediction Mechanisms:**
- **Bayesian Truth Serum** (Prelec, 2004, *Science*): Rewards answers that are "surprisingly common" — more frequent than predicted. Truthful reporting is rewarded because genuinely held beliefs tend to be underestimated by others.
- **Robust Bayesian Truth Serum** (Witkowski & Parkes, 2012): Strictly incentive-compatible for n ≥ 3 without knowing the common prior. Empirically validated: GOV.UK experiment showed farmers reported more truthfully under RBTS monetary incentives.
- **DMI Mechanism** (Kong, 2023-2024, *JACM*): Dominantly truthful with finite tasks and as few as 3 participants. Most deployment-ready mechanism.
- **Critical caveat:** A 2025 meta-review (Lehmann, *Journal of Economic Surveys*) found empirical evidence for these mechanisms is "limited and generally weak." A registered replication of BTS found no significant difference between BTS-incentivized and unincentivized groups. Use as supplementary signal, not sole quality measure.

### 3B. Punishment Options

| Punishment | Mechanism | Severity | Precedent |
|-----------|-----------|----------|-----------|
| **Downweighting** (soft) | Data carries less weight in recommendations | Low | Reddit vote fuzzing |
| **Reduced access** (medium) | Lose privileges, throttled results | Medium | SO privilege revocation |
| **Temporary exclusion** (hard) | Locked out for a period | High | Subreddit bans |
| **Permanent exclusion** (nuclear) | Account terminated | Maximum | Helium denylist |
| **Financial slashing** (crypto) | Staked collateral burned | High | Numerai burns, Filecoin fault fees |
| **Reputation decay** (passive) | Score decreases over time without positive contribution | Low-Medium | veOCEAN linear decay |

**Key insight from Filecoin:** Slashing works when stakes are real. SPs risk 6.4-64 FIL/TiB, and daily fault fees create genuine accountability. Helium had no meaningful slashing — spoofers risked only $500 hardware cost, quickly recouped.

**Key insight from Hivemapper:** Reputation is "fragile — hard to build, easy to damage." This asymmetry is deliberate and effective.

### 3C. Preventing False Positives

The biggest risk in any punishment system: penalizing genuine unusual behavior.

**Approaches:**
- **Graduated sanctions** (Ostrom's commons governance): First offense → warning. Second → temporary downweight. Third → exclusion. Escalation provides correction opportunity.
- **Anomaly ≠ fraud:** Flag anomalies for human review rather than auto-punishing. Hivemapper's approach: automated flagging with human review for complex features.
- **Grace periods:** Filecoin gives no penalty for first-time faults in the current proving period. Only pre-existing faults accumulate penalties.
- **Appeal mechanisms:** Any slashing must have a dispute resolution path. Augur's forking was too extreme (60-day freeze). UMA's optimistic oracle (dispute within 2 hours, 99% undisputed) is more practical.
- **Confidence intervals:** Require statistical significance before penalizing. Don't slash on a single anomalous data point — require a pattern.

---

## Part 4: Measuring Signal Quality for Behavioral Data

### 4.1 The Eskil BMW Parts Problem

*"If Eskil's BMW parts purchasing history leads others to good parts — how is that measured?"*

**Direct measurement:** Track whether users who followed recommendations derived from Eskil's data had positive outcomes.
- Did they purchase the same part? (observable)
- Did they return it? (observable, 2-4 week feedback loop)
- Did they purchase from the same supplier again? (observable, months)
- Did they leave a positive review? (observable, days-weeks)

**Indirect measurement (peer prediction):**
- If Eskil's purchasing patterns are consistent with other experienced BMW owners → higher quality score.
- If Eskil's preferred supplier has high repeat-purchase rates across all customers → Eskil's endorsement is validated.
- Cross-validation: multiple independent users reaching similar conclusions about the same parts/suppliers.

**Temporal measurement:** Quality scores must be time-weighted. A recommendation that was good 3 years ago may not be today. Decay functions (similar to veOCEAN's linear decay) keep freshness relevant.

### 4.2 The Restaurant Visit Problem

*"If someone's restaurant visit data correlates with others' satisfaction — how is that computed?"*

**Repeat-visit signal:** The strongest trust signal. A restaurant someone visits 5+ times is a stronger endorsement than a 5-star review. Provable via ZK proofs ("I visited 5+ times") without revealing identity or specific dates.

**Cross-user correlation:** If people with similar taste profiles (computed from their behavioral patterns) independently visit the same restaurant, that's a consensus signal. This is collaborative filtering applied to behavioral data rather than explicit ratings.

**Outcome tracking:**
- Do visitors return? (weeks-months)
- Do they spend more on subsequent visits? (observable via transaction data)
- Do they bring others? (inferable from group-size transaction data)

**Quality computation:** An EigenTrust-style algorithm (the default trust algorithm for 23 years, now running on Farcaster/Lens via OpenRank with ZK-verifiable computation):
1. Each contributor gets a trust score based on how well their behavioral signals predict others' satisfaction.
2. Trust scores propagate transitively — if A trusts B, and B trusts C, some trust flows to C.
3. The global trust vector converges iteratively, weighted by contribution quality.

### 4.3 Feedback Loop Duration

| Data Type | First Signal | Reliable Quality Score | Full Validation |
|-----------|-------------|----------------------|-----------------|
| Purchase recommendation | Click/purchase (hours-days) | Return rate (2-4 weeks) | Repeat purchase (months) |
| Restaurant recommendation | Visit (days-weeks) | Return visit (weeks-months) | Long-term patronage (6+ months) |
| Service provider recommendation | Booking (days) | Satisfaction/complaint (weeks) | Referrals/repeat use (months) |
| Product quality signal | Purchase (immediate) | Return/complaint (2-4 weeks) | Durability/lifetime (months-years) |

**Implication:** The system needs a multi-stage quality assessment — immediate consistency checks, medium-term outcome tracking, and long-term validation. Quality scores should be provisional (with confidence intervals) until sufficient feedback accumulates.

---

## Part 5: Game Theory

### 5.1 Equilibrium Conditions

**When rational actors contribute genuine data:**
1. **Excludability** — non-contributors are excluded from benefits (club goods). This is the primary structural incentive.
2. **Punishment mechanisms** — free-riders face graduated sanctions (reduced access → exclusion).
3. **Repeated interaction** — contributors build reputation over time that has value (SO model).
4. **Perceived proportional benefit** — the contributor perceives that their contribution improves their own experience.

**When the system collapses into gaming:**
1. **Reward exceeds fabrication cost** — if proving a $50 purchase earns $5, people fabricate purchases.
2. **Reward multipliers** — Filecoin's 10x verified deal multiplier was the biggest gaming vector.
3. **Self-attestation without independent verification** — Helium's location self-assertion allowed 37% fake hotspots in some regions.
4. **Closed validation loops** — when the same actors validate each other (Helium spoofing rings).
5. **Token emissions exceed organic demand** — every tokenized data marketplace collapsed when emissions slowed.

### 5.2 Proof of Personhood Interaction

**BankID solves Sybil for Norway:**
- 4M+ users (near-total adult coverage). 901M transactions in 2025.
- NFC-based biometric verification since mid-2024: **zero fraud cases** on this path.
- Creating a fake BankID requires a real Norwegian passport/ID card + in-person verification = prohibitively expensive.

**Global scaling:**
- EU: eIDAS 2.0 (mandating ZK integration in digital identity wallets)
- India: Aadhaar
- Global: World ID (26M+ verified), Human Passport (aggregated scoring)
- US: No federal ID — composite identity scores (multiple weak signals)

**Game-theoretic implication:** With strong proof-of-personhood (BankID), one person = one stake. The attack vector of paying real humans for fake behavior is expensive ($0.25-$1.75 per data point × many data points = losing proposition vs. the effort). Combined with cross-validation and anomaly detection, the system is structurally resistant to gaming at Norwegian scale.

### 5.3 Minimum Reward That Sustains Contribution

**Empirical findings:**
- $0.25-$1.75 per data point → 64%+ participation (lab settings)
- EUR 1 discount → moves behavior (German field study)
- 10% discount on mobile subscription → increases data sharing willingness in Norway
- Privacy paradox: 75% of students said they value data protection, yet shared income/birthdate for EUR 1

**But the biggest risk is friction, not reward amount:**
- 42% of non-participants cite "too much effort"
- 57% of loyalty program quitters cite "takes too long to earn"
- Near-zero-friction contribution (automatic, one-click) is more important than reward magnitude

**For Norway specifically:** Expect higher privacy awareness than global averages. The combination of direct monetary benefit (cashback/discount) + service quality improvement (better recommendations) is likely needed. A 10% discount on a relevant service is a reasonable starting point.

---

## Part 6: Three Candidate Mechanism Designs

### Design A: "The Club" — Pure Informational, No Token

**Core mechanic:** Share your behavioral data, get access to the network's collective intelligence. Don't share, don't get access.

**Earning:** Better AI recommendations that improve with contribution volume and quality. Free tier gives basic public data. Contributor tier gives the full behavioral trust network. Premium tier (high-quality, long-term contributors) gets priority and governance.

**Losing:** Quality score degrades if data is inconsistent or anomalous. Below a threshold → downweighted (your data counts less). Sustained low quality → demoted to free tier. Fabrication detected → permanent exclusion.

**Quality measurement:** Cross-validation + anomaly detection + prediction accuracy contribution. No peer prediction tokens — quality is measured by how well your data improves the model.

**Sybil resistance:** BankID (Norway) / eIDAS (EU) / pluggable identity.

**Cold start:** Seed with public data (Google Reviews, Mattilsynet, Brønnøysund). Dominant assurance contract: early contributors get guaranteed benefits (priority access, founder status) if the network reaches critical mass, and a refund/bonus if it doesn't.

| Advantage | Disadvantage |
|-----------|-------------|
| No token complexity, no regulatory crypto overhead | Marginal value of one person's data is hard to perceive |
| Aligns incentives perfectly (contribute = better AI) | Cold start is brutal — early contributors get little back |
| No mercenary gaming — no financial reward to extract | Harder to market — "better AI" is abstract |
| Sustainable — no emissions to deplete | No revenue model unless there's a paid tier |
| GDPR-friendly — data sharing for direct service improvement | May not generate enough pull to reach critical mass |

**Revenue model:** Freemium. API access for businesses wanting behavioral trust data (MCP server for AI models). This is where Google captured HTTP value.

**Best for:** A world where the AI recommendation quality difference between contributors and non-contributors is dramatic and demonstrable. Requires the product to be exceptionally good.

---

### Design B: "The Cooperative" — Cashback + Reputation, No Token

**Core mechanic:** A data cooperative (samvirkeforetak — a known Norwegian legal form). Members share behavioral data and receive cashback from businesses that benefit from the trust data. Reputation unlocks governance.

**Earning:**
- **Cashback:** Businesses pay for access to behavioral trust data. Revenue is distributed to members proportional to their contribution quality and volume. Small, frequent, immediately redeemable (the loyalty program research is unanimous: instant gratification + 36% engagement boost).
- **Reputation:** Contribution quality unlocks governance privileges (vote on data policies, approve new data uses, nominate trustees). Modeled on SO's privilege escalation: contribute → earn rep → unlock capabilities.
- **Service quality:** Like Design A, contributors get better AI recommendations.

**Losing:**
- Quality score decay over time without positive contribution (passive punishment).
- Anomaly detection → graduated sanctions: warning → reduced cashback → governance privilege revocation → exclusion.
- Financial penalty for detected fabrication: forfeiture of accumulated unredeemed cashback.

**Quality measurement:** Same as Design A (cross-validation, anomaly detection, prediction accuracy), plus peer prediction (RBTS/DMI) as supplementary signal for subjective quality assessment.

**Cold start:** SkatteFUNN R&D subsidies (19% back on up to NOK 25M). Business partnerships for initial cashback pool. Public data seeding. Target: 2,000-5,000 active users in Stavanger for minimum viable network.

| Advantage | Disadvantage |
|-----------|-------------|
| Tangible, immediate financial reward | Requires real revenue from business buyers — the consistent failure point |
| Cooperative is a familiar Norwegian legal form | Cashback attracts mercenaries optimizing for extraction |
| No token volatility — rewards in NOK | No data cooperative has ever achieved profitability |
| GDPR-compatible (data cooperative has legal basis) | Revenue per user will be small (fractions of a krone per data point) |
| Reputation + governance creates emotional loyalty | Governance complexity scales with member count |

**Revenue model:** B2B data licensing. Businesses pay to access behavioral trust signals via API. The cooperative distributes 70%+ to members, retains remainder for operations. The AI integration layer (MCP server) is the value capture point — like Red Hat to Linux.

**Best for:** A world where there are identifiable business buyers willing to pay for behavioral trust data, and the cooperative structure provides legitimacy and GDPR cover. Requires solving the buyer-side problem that killed every data marketplace.

---

### Design C: "The Staking Network" — Token + Reputation + Slashing

**Core mechanic:** An open protocol with a native token. Contributors stake tokens alongside their behavioral data. Quality contributions earn rewards; noise/manipulation gets slashed.

**Earning:**
- **Token rewards:** Weekly distribution proportional to `quality_score * stake_amount * payout_factor`. Payout factor auto-adjusts like Numerai's: `min(1, threshold / total_staked)`.
- **Data consumption rewards:** When a business or AI model consumes data you contributed, you earn a share of the consumption fee. Modeled on Hivemapper's burn-and-mint: 25% of burned tokens re-minted to contributors.
- **Reputation multiplier:** Long-term, high-quality contributors earn a reputation multiplier (1.0x-2.0x) on their staking rewards. Caps to prevent runaway — maximum 2x.

**Losing:**
- **Quality slashing:** Data flagged as fabricated or inconsistent → stake proportionally burned. Burn rate: 1-5% per offense (inspired by Numerai's clip at -5%).
- **Inactivity decay:** Staked tokens lose quality multiplier over time without fresh contributions (veToken linear decay model). Doesn't burn tokens, but reduces rewards.
- **Exclusion for repeated offenses:** 3 slashing events → permanent exclusion + remaining stake burned.

**Quality measurement:** Full stack — anomaly detection, cross-validation, prediction accuracy, peer prediction (DMI mechanism), and EigenTrust-style transitive trust propagation.

**Key design choices to avoid precedent failures:**
- **Dual denomination:** Stake in either native token OR stablecoin (USDC/NOK equivalent). Addresses Numerai's #1 churn driver.
- **Deflationary burns:** Consumption fees → 75% burned, 25% to contributors. Creates deflationary pressure from real usage, not emissions.
- **No multipliers above 2x.** Filecoin's 10x multiplier was the #1 gaming vector. Cap multipliers tightly.
- **Open protocol, commercial layer on top.** Protocol is open source (Linux model). Commercial company sells the AI integration layer (MCP server, API, identity bridges). Foundation owns spec, company sells intelligence.
- **Payout factor transparency.** Publish the payout factor in real-time so participants can make informed staking decisions.

**Cold start:** Token generation event with dominant assurance mechanism: early stakers get guaranteed returns if network reaches critical mass (funded by protocol treasury), and stake returned + bonus if it doesn't.

| Advantage | Disadvantage |
|-----------|-------------|
| Permissionless — anyone globally can participate | Every tokenized data marketplace has failed |
| Economic skin-in-the-game via slashing | Token price volatility dominates returns |
| Open protocol — composable, extensible | Regulatory complexity (securities classification) |
| Deflationary tokenomics from real consumption | Attracts speculators before genuine contributors |
| Aligns with crypto ecosystem (agents, DeFi) | Late entrants face payout factor deflation |
| Global from day one | Cold start requires treasury funding (emission subsidy) |

**Revenue model:** Protocol fees on consumption (like Ethereum gas). Commercial AI integration layer (MCP server) sold as SaaS. Identity bridge services for connecting BankID, eIDAS, World ID to the protocol.

**Best for:** A world where the protocol needs to be permissionless and global from day one, where the crypto ecosystem provides distribution and composability, and where the team can navigate regulatory complexity. Highest potential ceiling, longest timeline, most risk.

---

## Part 7: Comparative Analysis

### Decision Matrix

| Dimension | A: The Club | B: The Cooperative | C: The Staking Network |
|-----------|------------|-------------------|----------------------|
| **Cold start difficulty** | Very hard (must demo AI quality gap) | Hard (must find business buyers) | Hard (must avoid speculation-only phase) |
| **Regulatory risk** | Low (no token, standard data processing) | Low-Medium (cooperative law, GDPR data sharing) | High (token classification, securities, cross-border) |
| **Gaming resistance** | High (no financial reward to game) | Medium (cashback creates gaming incentive) | Low-Medium (token rewards always attract gaming) |
| **Scalability** | Norway → Nordics → EU (needs identity infra) | Norway → Nordics (cooperative law varies) | Global from day one (permissionless) |
| **Revenue model clarity** | Medium (freemium API) | High (B2B data licensing → member cashback) | Medium (protocol fees + commercial layer) |
| **User comprehensibility** | High ("share data, get better AI") | High ("join the co-op, get cashback") | Low ("stake tokens on your behavioral data") |
| **Precedent success rate** | Medium (Waze, Wikipedia worked) | Zero (no data cooperative has been profitable) | Zero (every tokenized data marketplace failed) |
| **Alignment with PageRank 2026 vision** | Partial (not permissionless/global) | Partial (not permissionless/global) | Full (open protocol, global, trust layer) |
| **Time to market** | 6-12 months | 12-18 months | 18-36 months |
| **Capital required** | Low ($100K-$500K) | Medium ($500K-$2M) | High ($2M-$10M) |

### The Sequencing Question

These designs are not mutually exclusive. They can be **sequential stages:**

1. **Start with A** — Build the product. Prove the AI quality difference. Get 2,000-5,000 users in Stavanger. No token, no cooperative. Just "your AI works better with your data." Prove the product works.

2. **Add B** — Once there's a demonstrable AI quality advantage and identifiable business buyers, formalize as a cooperative. Add cashback. This funds growth and creates a legal entity for data governance.

3. **Evolve to C** — Once the cooperative has proven the data is valuable and the quality scoring works, open-source the protocol and add the token layer for global permissionless participation. The cooperative becomes one node in a larger network.

This sequencing follows the Brave model (product → token) rather than the Ocean model (token → product). It is the only sequencing pattern that has empirical support.

---

## Part 8: Open Questions for Håkon

1. **Which cold-start strategy?** Seeding with public data vs. targeting a specific vertical (restaurants in Stavanger?) vs. partnering with an existing platform (Vipps? a bank?).

2. **Is the cooperative legal form actually viable?** No data cooperative has achieved profitability. Is the Norwegian samvirkeforetak structure flexible enough? What are the governance costs?

3. **Who is the first paying business customer?** The buyer side is the consistent failure. Is it restaurants wanting trust signals? Insurance companies wanting behavioral risk data? AI companies wanting training data? The answer determines the entire economic model.

4. **How much to invest before proving the AI quality gap?** Design A requires the AI to be noticeably better for contributors. That requires a critical mass of data. That requires contributors. The chicken-and-egg problem is the existential question.

5. **Token or no token?** The research is brutally clear that every tokenized data marketplace failed. But the PageRank 2026 vision is explicitly a global, permissionless protocol — which almost requires a token for coordination. Is there a path to a global open protocol without a token? (AT Protocol/Bluesky is attempting this, with mixed results.)

---

## Appendix: Key Sources

### Academic
- Fehr & Schmidt (1999): Inequality aversion in public goods games
- Ostrom (2009): Commons governance principles (Nobel Prize)
- Prelec (2004): Bayesian Truth Serum (*Science*)
- Witkowski & Parkes (2012): Robust BTS for small populations (AAAI)
- Kong (2023-2024): DMI Mechanism — dominantly truthful peer prediction (*JACM*)
- Hartmann & Henkel (2020): Tragedy of the data commons
- Lehmann (2025): Meta-review of peer prediction empirical evidence (*JES*)
- Tabarrok: Dominant assurance contracts

### Systems Analyzed
- Numerai (staking, scoring, SWMM, NMR tokenomics)
- Filecoin (collateral, slashing, verified deals, Fil+ gaming)
- Hivemapper (visual consensus, HONEY tokenomics, burn-and-mint)
- Helium (Proof of Coverage, spoofing, carrier offloading recovery)
- Ocean Protocol (datatokens, veOCEAN, Data Farming, ASI merger)
- Streamr, Swash, Datum (failed data marketplaces)
- Brave/BAT (product-first success pattern)
- Reddit karma, Stack Overflow reputation (non-financial reputation)
- Polymarket/UMA (optimistic oracle, March 2025 manipulation)
- Augur (forking mechanism, 37 DAU failure)

### Key Data Points
- Norwegian BankID: 4M+ users, 901M transactions (2025), zero fraud on NFC path
- Numerai: 1,200 staked models, $40M+ cumulative payouts, 0.072 payout factor
- Brave: 101M MAU, $26M revenue, $980M valuation
- Loyalty programs: 43% quit rate, 77% transactional programs fail within 2 years
- Data sharing willingness: $0.25-$1.75 per data point → 64%+ participation
- Friction: 42% of non-participants cite "too much effort" as #1 barrier
