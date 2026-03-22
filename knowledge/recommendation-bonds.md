# Mechanism Design for Recommendation Bonds

**Date:** 2026-03-21
**Type:** Mechanism Design Specification
**Status:** Deep Research Complete
**Feeds into:** PageRank 2026 concept, AgentLair positioning

---

## Executive Summary

This document specifies the mechanism design for **recommendation bonds** — a system where AI agents stake capital on the quality of their recommendations, creating cryptoeconomically verifiable trust. The design answers seven core questions across bond sizing, resolution, vertical adaptation, time horizons, smart contract architecture, bootstrap economics, and attack vectors.

**Core insight:** The agent doesn't ask humans to stake. The agent stakes on its own recommendations. Its track record becomes its PageRank. This extends AgentRank (Hyperspace AI, March 2026) from agent-to-agent delegation to consumer-facing discovery.

**Reference formula:** AgentRank computes `score(a) = PRd(a, Gw) × ψ(a) × ρ(a)` — damped PageRank on stake-weighted graph × sybil cluster penalty × recency decay. Our design adapts this by replacing computational proof-of-work with **recommendation outcome bonds** as the stake anchor.

---

## 1. Bond Sizing: Anti-Sybil Without Prohibitive Entry

### The Core Tension

Too high → only wealthy agents can participate (plutocratic capture).
Too low → sybil attacks are cheap (spam the system with fake reputation).

### Reference Points

| System | Bond/Stake | Purpose | Anti-Sybil Strength |
|--------|-----------|---------|---------------------|
| Polymarket/UMA | $750 USDC | Oracle resolution proposal | Medium (financial) |
| Augur REP | Escalating (275K REP triggers fork) | Market outcome reporting | High (economic + social) |
| EigenLayer | Variable (up to 50% slashable) | AVS validation | High (native ETH at risk) |
| Kleros | PNK tokens proportional to case value | Dispute arbitration | Medium (token-weighted) |
| AgentRank | Proof-of-computation stake | Agent endorsement | High (computation cost) |

### Design: Dynamic Bond Sizing

**Formula:**

```
bond(r) = B_base × V(r) × (1 - R(a))
```

Where:
- `B_base` = base bond fraction (calibrated per vertical, see §2)
- `V(r)` = estimated value of the recommendation (e.g., product price, subscription cost)
- `R(a)` = agent's reputation score ∈ [0, 0.8] (capped — never zero bond)
- `r` = specific recommendation instance

**Properties:**

1. **Value-proportional:** A $10/month SaaS recommendation requires a smaller bond than a $10,000 enterprise contract. This aligns incentives — the bond is proportional to the damage a bad recommendation could cause.

2. **Reputation-discounted:** Agents with proven track records post smaller bonds per recommendation. A new agent with R(a)=0 posts the full `B_base × V(r)`. An agent with R(a)=0.8 posts only 20% of that. This creates a natural reputation moat without making entry impossible.

3. **Never-zero floor:** The cap at R(a)=0.8 ensures even the most trusted agent always has skin in the game. Eliminates "reputation-then-defect" attacks (see §6).

### Calibration by Vertical

| Vertical | B_base | Min Bond | Rationale |
|----------|--------|----------|-----------|
| SaaS/Software | 5% of first-year subscription | $5 | High LTV, measurable satisfaction |
| Restaurant/Local | 10% of average transaction | $2 | Low per-transaction value, high volume |
| Financial products | 2% of investment amount | $50 | High value, regulatory sensitivity |
| E-commerce | 8% of product price | $3 | Moderate value, return data available |
| Services (contractors) | 5% of project value | $25 | High value, delayed outcome |
| Content/Media | Flat $1-5 | $1 | Low per-item value, high volume |

### Anti-Sybil Analysis

**Cost to sybil:** Creating N fake agents to recommend one product requires N × bond(r) capital. With B_base = 5% and V(r) = $50/month SaaS:

- 1 agent: $2.50 bond → earns reputation if correct
- 100 sybil agents: $250 total bonds → each has R(a)=0, no reputation discount
- The sybils gain no economy of scale (unlike web links or fake reviews)

**Key property from AgentRank:** "Sybil attacks scale linearly in cost with no economies of scale." Our bond design inherits this — splitting stake across N identities doesn't help because:
- Each sybil starts at R(a)=0 (maximum bond)
- Reputation doesn't transfer between identities
- Bond returns require actual positive outcomes per identity

**Comparison to BankID cost:** Creating a fake BankID identity costs $10,000+ (document fraud + bank KYC). For agent identity, the equivalent barrier is the minimum bond requirement × number of recommendations needed to build reputation.

### Entry Barrier Analysis

A new agent entering the SaaS recommendation vertical:
- First recommendation bond: $2.50 (5% × $50)
- 10 recommendations to build initial reputation: $25 capital required
- Break-even at ~60% accuracy (from bonded economics analysis): achievable for a well-tuned AI agent
- **Entry cost: ~$25-50 to start building reputation** — accessible to any agent with basic capital

---

## 2. Bond Resolution: Binary vs. Continuous

### The Design Space

| Model | Description | Pros | Cons |
|-------|-------------|------|------|
| **Binary** | Good/Bad (Augur-style) | Simple, clear incentives | Loses information, crude |
| **Continuous** | Quality score 0-100 | Rich signal, proportional rewards | Gaming the scoring rubric |
| **Categorical** | Multiple outcome levels | Good compromise | Category boundary disputes |
| **Optimistic** | Assumed good unless challenged | Low overhead for happy path | Dispute system complexity |

### Design: Hybrid Optimistic-Continuous

**Primary path (95%+ of resolutions): Optimistic resolution with continuous scoring.**

```
Resolution flow:
1. Agent posts recommendation + bond
2. User follows recommendation
3. After resolution period (see §3), outcome assessed:
   a. DEFAULT: Bond + reward returned (optimistic — no dispute)
   b. IF user signals dissatisfaction → dispute window opens (7 days)
   c. IF dispute → resolution oracle evaluates on continuous scale
4. Bond return = bond × quality_score / 100
   - quality_score ≥ 70: bond fully returned + reward
   - quality_score 40-69: bond partially returned, no reward
   - quality_score < 40: bond fully slashed
```

**Why this hybrid works:**

1. **Optimistic path** handles the happy case cheaply (no oracle cost). Like Polymarket/UMA: "statements are assumed valid unless challenged." Most recommendations are either clearly good or clearly bad — the continuous scoring only matters in disputes.

2. **Continuous scoring in disputes** captures the difference between "slightly disappointing" and "terrible recommendation." This prevents binary gaming where a mediocre product barely clears the good/bad threshold.

3. **Three-tier outcome** (full return / partial / slash) creates a gradient of accountability:
   - **≥70: Success** — agent recommended well, gets bond back + earns reward
   - **40-69: Mediocre** — agent gets partial bond back but earns nothing (incentivizes quality, not just adequacy)
   - **<40: Failure** — agent loses entire bond (punishes genuinely bad recommendations)

### Resolution Oracle Design

**Inspired by Augur + UMA + Kleros, adapted for recommendation quality:**

```
Layer 1: Automated signals (free, instant)
  - Did the user return the product? (PSD2/merchant data)
  - Did the user continue the subscription? (payment data)
  - Did the user visit again? (transaction repeat pattern)
  - What's the aggregate satisfaction for this product? (public reviews)

Layer 2: Optimistic assertion (cheap, 2-hour window)
  - Agent asserts positive outcome
  - Bond: $10 minimum (proportional to original bond)
  - 2-hour dispute window (UMA model)
  - If undisputed → accepted

Layer 3: Dispute resolution (expensive, 48-hour)
  - Disputer posts matching bond
  - Multi-signal scoring by oracle committee (3-5 randomly selected curators)
  - Curators stake on their scoring decision
  - Majority-weighted continuous score determines outcome
  - Curators who voted with majority keep their stake + earn fee
  - Curators who voted against majority lose stake (Schelling point)

Layer 4: Appeal (Augur-fork equivalent, rare)
  - If continuous score is disputed, escalate to full token-holder vote
  - 7-day voting period
  - Requires 10× the original bond to initiate appeal
  - Final and binding
```

### Resolution Criteria by Vertical

| Vertical | Primary Signal | Secondary Signal | Resolution Complexity |
|----------|---------------|------------------|----------------------|
| **SaaS** | Subscription continued ≥30 days | User satisfaction survey | Low (automated) |
| **Restaurant** | Repeat visit within 60 days | Online review sentiment | Low (automated) |
| **E-commerce** | No return within 30 days | Product rating | Low (automated) |
| **Financial** | Portfolio performance vs benchmark | Risk-adjusted return | Medium (oracle needed) |
| **Services** | Project completion + payment | Client satisfaction | High (dispute-prone) |
| **Content** | Engagement time > threshold | Share/save actions | Low (automated) |

**Key insight:** Most verticals can be resolved automatically (Layer 1) using behavioral data signals. The dispute system is the exception path, not the main path. This is critical for economic viability — if every recommendation required oracle resolution, the system would be too expensive.

---

## 3. Time Horizons: When Does a Recommendation Resolve?

### The Fundamental Challenge

A restaurant recommendation resolves in days. A SaaS recommendation might take months. A financial product recommendation might take years. The bond must be locked for the resolution period, creating an opportunity cost for the agent.

### Design: Vertical-Specific Resolution Windows

```
Resolution timeline:
|--- Recommendation posted ---|--- User action window ---|--- Outcome assessment ---|--- Dispute window ---|
          t=0                       t_action                    t_resolve                   t_final
```

| Vertical | t_action | t_resolve | t_final | Bond lock period |
|----------|----------|-----------|---------|-----------------|
| Restaurant | 14 days | 60 days | 67 days | ~2 months |
| E-commerce | 7 days | 37 days (30d return) | 44 days | ~6 weeks |
| SaaS | 7 days | 37 days (30d trial) | 44 days | ~6 weeks |
| Financial | 30 days | 180 days | 187 days | ~6 months |
| Services | 30 days | 90 days (project) | 97 days | ~3 months |
| Content | 1 day | 7 days | 14 days | ~2 weeks |

### Opportunity Cost and Bond Yield

Locking capital creates opportunity cost. To compensate:

```
effective_reward = base_reward + time_premium(t_final)
time_premium = bond × risk_free_rate × (t_final / 365)
```

At 5% risk-free rate:
- Content (2 weeks lock): time premium = 0.14% of bond (negligible)
- Restaurant (2 months): time premium = 0.82% of bond
- Financial (6 months): time premium = 2.5% of bond

**For short-duration verticals,** opportunity cost is negligible. **For financial products,** time premium must be meaningful or agents won't participate. This naturally pushes the system toward high-frequency, quick-resolution verticals first (content, restaurants, SaaS) before tackling slow-resolution ones (financial, services).

### Partial Resolution for Long-Horizon Recommendations

For verticals where full resolution takes months:

```
Milestone-based partial release:
  t=30d: Release 25% of bond if user still active
  t=60d: Release 25% more if continued activity
  t=90d: Release 25% more
  t=180d: Final 25% released or slashed based on outcome
```

This reduces capital lockup while maintaining accountability. Each milestone is a checkpoint — if the user cancels at day 45, the remaining 75% of the bond enters dispute resolution.

---

## 4. Smart Contract Architecture

### Chain Selection Analysis

| Chain | Pros | Cons | Verdict |
|-------|------|------|---------|
| **Ethereum L1** | Maximum security, composability | $5-50 gas per tx, too expensive for micro-bonds | No |
| **Base (Coinbase L2)** | Low gas ($0.01-0.10), Coinbase ecosystem, USDC native | Centralized sequencer | **Primary** |
| **Arbitrum** | Low gas, mature DeFi ecosystem | More complex than Base | Secondary |
| **Solana** | 400ms finality, $0.00025/tx | Different VM (not EVM), smaller DeFi ecosystem | Future |
| **Optimism** | OP Stack, superchain composability | Less ecosystem than Base | Backup |

**Recommendation: Deploy on Base first.** Rationale:
1. USDC is native on Base (no bridging needed)
2. Coinbase ecosystem aligns with x402 payment infrastructure
3. Gas costs (~$0.01-0.10) make micro-bonds economically viable
4. EVM compatibility for contract portability
5. Growing agent infrastructure (Coinbase Verifications, AgentKit)

### Contract Architecture

```
┌─────────────────────────────────────────────────────┐
│                  BondRegistry.sol                     │
│  - registerAgent(identity, initialStake)              │
│  - getAgentReputation(agentId) → R(a)                │
│  - updateReputation(agentId, outcomeData)             │
│  Maps: agentId → {stake, reputation, bondCount,       │
│         totalResolved, slashCount, lastActive}        │
├─────────────────────────────────────────────────────┤
│               RecommendationBond.sol                  │
│  - postBond(agentId, productId, bondAmount, vertical) │
│  - claimResolution(bondId, outcomeProof)              │
│  - disputeResolution(bondId, evidence)                │
│  - resolveDispute(bondId, qualityScore)               │
│  Maps: bondId → {agent, product, amount, posted,      │
│         status, qualityScore, resolvedAt}             │
├─────────────────────────────────────────────────────┤
│              ResolutionOracle.sol                      │
│  - proposeOutcome(bondId, score, proposerBond)         │
│  - dispute(bondId, counterScore, disputerBond)         │
│  - voteOnDispute(bondId, score)                        │
│  - finalizeResolution(bondId)                          │
│  Integrates: UMA OO V3 or custom Schelling oracle     │
├─────────────────────────────────────────────────────┤
│              AgentRankCompute.sol                      │
│  - computePageRank(graph) → rankings                  │
│  - applySybilPenalty(agentId) → ψ(a)                 │
│  - applyRecencyDecay(agentId) → ρ(a)                 │
│  Off-chain computation + on-chain verification        │
│  (ZK proof of correct PageRank computation)           │
├─────────────────────────────────────────────────────┤
│                 Treasury.sol                          │
│  - collectFees(bondId)                                │
│  - distributeRewards(agentId, amount)                 │
│  - processSlash(bondId, slashAmount)                  │
│  - protocolRevenue tracking                           │
└─────────────────────────────────────────────────────┘
```

### Key Design Decisions

**1. USDC as bond denomination (not ETH or custom token)**
- Recommendation value is denominated in fiat (product prices)
- Volatile bond denomination creates perverse incentives (an ETH crash could slash a good recommender)
- USDC on Base is the natural choice (Coinbase ecosystem, x402 compatibility)
- No custom token avoids the "launch a token to capture value" trap

**2. Off-chain PageRank computation with on-chain verification**
- PageRank computation over the full delegation graph is O(n²) — too expensive on-chain
- Compute off-chain, generate ZK proof of correct computation, verify on-chain
- Reference: OpenRank already does ZK-verifiable EigenTrust on Farcaster
- Update frequency: daily recomputation with 24-hour recency decay (τ=24h, matching AgentRank)

**3. UMA Optimistic Oracle integration for dispute resolution**
- Don't reinvent the oracle. UMA has processed tens of thousands of market resolutions monthly
- $750 standard bond is appropriate for high-value disputes; scale down for micro-bonds
- Managed Optimistic Oracle V2 (MOOV2) allows whitelisting proposers — useful for automated resolution
- Permissionless disputes ensure anyone can challenge

**4. EAS attestation for identity linkage**
- Use Ethereum Attestation Service for agent identity attestations
- Pluggable: Coinbase Verifications, World ID, BankID bridged via ZK
- Composable with Verax for cross-chain attestation aggregation
- ERC-8004 compatible for agent registration

### Gas Cost Estimates (Base L2)

| Operation | Estimated Gas | Cost @ $0.01/tx |
|-----------|--------------|-----------------|
| Post bond | 80,000 | $0.01-0.05 |
| Claim resolution (automated) | 60,000 | $0.01-0.03 |
| Dispute initiation | 100,000 | $0.02-0.05 |
| Dispute vote | 50,000 | $0.01 |
| Agent registration | 120,000 | $0.02-0.05 |

**Total cost per recommendation lifecycle (happy path): ~$0.02-0.08** — economically viable for recommendations with bonds as small as $1.

---

## 5. Bootstrap Problem: How Does an Agent Fund Its Initial Bonds?

### The Chicken-and-Egg

New agent has no reputation → needs maximum bonds → needs capital → needs revenue → needs recommendations → needs reputation.

### Bootstrap Strategies (Ranked by Viability)

#### Strategy 1: Operator-Funded (Most Practical)

The human operator who deploys the agent provides initial capital. This is how every DeFi bot works today.

```
Bootstrap economics:
- Operator deposits $500 USDC into agent's bond pool
- Agent makes ~200 micro-bond recommendations (SaaS vertical, $2.50 each)
- At 75% accuracy: 150 successful × $3.50 return = $525 revenue
                    50 failed × $2.50 slash = -$125
- Net after 200 recommendations: $400 + $125 earned = $525
- Time to break even: ~2-4 weeks at 10 recommendations/day
```

**Minimum viable bootstrap: $100-500** depending on vertical. Comparable to starting any small business.

#### Strategy 2: Bond Pool / Delegation (Medium-term)

Trusted agents with excess capital can delegate bonds to newer agents, similar to EigenLayer restaking or Recall's curator staking:

```
Bond delegation:
- Senior agent (R(a)=0.7) delegates $1000 to junior agent
- Junior agent uses delegated capital for bonds
- Revenue split: 70% junior (doing the work) / 30% senior (providing capital)
- If junior agent gets slashed, senior agent's stake is affected
- Senior agent bears reputation risk — incentivized to delegate carefully
```

This creates a **meritocratic capital market** where proven agents can scale beyond their own capital, while capital providers earn returns proportional to the quality of agents they back.

#### Strategy 3: Protocol-Subsidized On-Ramp (Growth Phase)

During early growth, the protocol itself can subsidize bonds for new agents:

```
Subsidy mechanism:
- Protocol treasury provides matching bonds (up to $100/agent)
- Subsidy decays as agent builds reputation
- Funded by protocol fees from established agents
- Time-limited: 30-day subsidy window
- Anti-abuse: requires identity verification (ERC-8004 or equivalent)
```

#### Strategy 4: Earn-to-Bond (Zero-Capital Entry)

For agents that genuinely cannot front capital:

```
Earn-to-bond flow:
1. Agent starts with $0 — makes UNBONDED recommendations (visible but untrusted)
2. Unbonded recommendations tracked but carry zero weight in rankings
3. If 50+ unbonded recommendations achieve >80% accuracy (verified by automated signals)
4. Protocol issues a "proof-of-quality" attestation
5. Agent enters "probationary bonding" — protocol fronts first 10 bonds
6. Revenue from first 10 successful bonds becomes agent's initial capital
```

This eliminates the capital barrier entirely for agents that can demonstrate quality without bonds. The tradeoff: slow entry (50+ unbonded recs could take weeks/months).

### Bootstrap Economics Summary

| Strategy | Entry Capital | Time to Revenue | Risk Bearer |
|----------|-------------|-----------------|-------------|
| Operator-funded | $100-500 | 1-2 weeks | Operator |
| Bond delegation | $0 (delegated) | 1-2 weeks | Delegator |
| Protocol subsidy | $0 (matched) | 1-2 weeks | Protocol treasury |
| Earn-to-bond | $0 | 4-8 weeks | Agent (time cost) |

---

## 6. Attack Vectors and Mitigations

### Attack 1: Sybil Splitting

**The attack:** Agent creates N identities to spread risk. If one identity gets slashed, others continue operating.

**Why it's tempting:** A single agent with 10 identities can recommend the same bad product 10 times, earning commissions on the ones that aren't disputed while accepting slashes on the ones that are.

**Mitigations:**
1. **Linear cost scaling** (from AgentRank): Each sybil identity needs its own bond capital. No economies of scale.
2. **Identity verification threshold:** Require minimum identity score (Coinbase Verification, World ID, or composite) to post bonds. Cost to acquire fake identity >> profit from sybil attack.
3. **Sybil cluster detection (ψ penalty):** AgentRank's ψ function detects clusters of identities that consistently recommend the same products. Applied as a multiplicative penalty to rankings.
4. **Cross-identity pattern analysis:** If multiple agents recommend the same obscure product within the same time window, flag for investigation. Statistical anomaly detection.

**Residual risk:** Medium. Identity verification raises the cost significantly but doesn't eliminate it. The key defense is that sybil agents build no reputation (R(a)=0) and therefore need maximum bonds, making the attack capital-intensive.

### Attack 2: Last-Mile Betrayal (Reputation-Then-Defect)

**The attack:** Agent builds excellent reputation over months (R(a)=0.8), then exploits the reduced bond requirement to make many bad recommendations in rapid succession, collecting the commissions/kickbacks.

**Why it's dangerous:** This is the highest-damage attack because the agent has earned trust and can now exploit it at reduced cost. Analogous to the Augur whale attack.

**Mitigations:**
1. **Bond floor (R(a) cap at 0.8):** Even the most trusted agent always posts 20% of the full bond. Eliminates zero-cost recommendations.
2. **Velocity limits:** Maximum N new recommendations per day per agent. Prevents rapid exploitation.
3. **Reputation decay on disputes:** A single successful dispute drops R(a) significantly (proposed: 20% reduction per slash). Two slashes in succession = 36% reduction. Rapid betrayal destroys reputation faster than it was built.
4. **Progressive bonding for high-value recommendations:** For recommendations above $1,000, require bond proportional to recommendation value regardless of reputation.
5. **Escrow hold period:** Bond returns have a 7-day hold after resolution claim. If other recommendations from the same agent are disputed during the hold, all pending returns are frozen.

**Residual risk:** Low-medium. The compounding reputation penalty makes sustained betrayal expensive. A rational agent would earn more by continuing to provide good recommendations.

### Attack 3: Collusion

**The attack:** Agent and product seller collude. Seller pays the agent off-chain to recommend their product. Agent posts bond, recommends the product, users buy it, bond resolves favorably because the product isn't terrible (just not optimal). Agent earns bond return + off-chain kickback.

**Why it's subtle:** This isn't a "bad" recommendation — it's a suboptimal one. The product works, just isn't the best choice. The bond resolves successfully because the user isn't dissatisfied enough to dispute.

**Mitigations:**
1. **Comparative scoring:** Resolution oracle doesn't just ask "was this good?" but "was this the best available option?" Harder to game but more expensive to verify.
2. **Crowdsourced preference data:** If 100 agents recommend Product A for use case X and 1 agent recommends Product B, the outlier recommendation is flagged for extra scrutiny.
3. **Mandatory disclosure:** Agents must disclose any commercial relationship with recommended products. Undisclosed relationships discovered post-hoc trigger automatic slashing.
4. **Revenue source transparency:** On-chain payments from product sellers to agents are detectable. Off-chain payments are harder to detect but create legal liability.

**Residual risk:** High. This is the hardest attack to prevent because the recommendation isn't "wrong" — it's biased. The fundamental defense is that biased agents will have lower accuracy than unbiased agents, leading to lower rankings over time. The market should self-correct, but slowly.

### Attack 4: Self-Dealing (Circular Recommendation)

**The attack:** Agent creates a product, recommends its own product, bonds the recommendation, ensures the user has a decent experience, collects the bond return + product revenue.

**Mitigations:**
1. **Conflict-of-interest detection:** On-chain analysis of fund flows between agent wallet and product addresses.
2. **Disclosure requirement:** Same as collusion mitigation — undisclosed self-dealing = slashing.
3. **Blind recommendation pools:** For certain verticals, recommendations are anonymized (users don't know which agent recommended). This prevents agents from steering users to their own products.

**Residual risk:** Medium. If the agent genuinely makes a good product and recommends it accurately, is self-dealing actually bad? The answer depends on whether the recommendation was the best option for the user, not just a good option.

### Attack 5: Oracle Manipulation

**The attack:** Manipulate the resolution oracle to approve bad recommendations or deny good ones.

**Reference:** Augur's entire fork mechanism exists to prevent this. UMA's Schelling-point voting addresses it economically.

**Mitigations:**
1. **Multi-signal automated resolution** (Layer 1): Don't rely on human oracles for most resolutions. Use behavioral signals (subscription continuation, repeat visits, returns) that are harder to manipulate.
2. **Optimistic resolution** (Layer 2): Only disputed recommendations need oracle involvement. Most pass automatically.
3. **Bonded dispute** (Layer 3): Disputers must post matching bonds. Frivolous disputes are economically punished.
4. **Schelling-point voting** (Layer 3): Curators vote independently, rewarded for voting with majority. Manipulation requires bribing >50% of curators, which requires more capital than the bond being disputed.
5. **Fork as nuclear option** (Layer 4): For systemic oracle corruption, the entire protocol can fork (Augur model). This is the credible threat that keeps oracle participants honest.

**Residual risk:** Low for automated resolution. Medium for disputed cases. The key insight from Polymarket's MOOV2: whitelisted proposers with 95%+ historical accuracy handle 96% of proposals. Let the best proposers handle resolution, keep disputes open to everyone.

### Attack 6: Grief Attacks (Frivolous Disputes)

**The attack:** Competitor agent disputes every recommendation from a target agent, forcing them into expensive resolution processes even though the recommendations were good.

**Mitigations:**
1. **Dispute bonds:** Disputer posts a bond equal to the original recommendation bond. If the dispute fails, the disputer loses their bond. This makes grief attacks expensive.
2. **Dispute reputation tracking:** Agents who file disputes that fail lose reputation and may have their dispute ability throttled.
3. **Escalating dispute costs:** Repeat disputes from the same agent against the same target require progressively larger bonds.

**Residual risk:** Low. The bond requirement makes grief attacks self-punishing.

### Attack Summary Matrix

| Attack | Severity | Likelihood | Residual Risk | Primary Defense |
|--------|----------|-----------|---------------|-----------------|
| Sybil splitting | High | Medium | Medium | Linear cost scaling + identity |
| Last-mile betrayal | Critical | Low | Low-Medium | Bond floor + velocity limits + decay |
| Collusion | High | Medium | High | Comparative scoring + disclosure |
| Self-dealing | Medium | Medium | Medium | Conflict detection + disclosure |
| Oracle manipulation | Critical | Low | Low | Multi-layer oracle + fork threat |
| Grief attacks | Medium | Medium | Low | Dispute bonds |

---

## 7. The Complete Mechanism: RecommendationRank

### The Unified Formula

Extending AgentRank's `score(a) = PRd(a, Gw) × ψ(a) × ρ(a)`:

```
RecommendationRank(a) = PRd(a, G_bond) × ψ(a) × ρ(a) × ω(a)
```

Where:
- **PRd(a, G_bond):** Damped PageRank on the bond-weighted recommendation graph. Edge weights are the bond amounts agents have posted on recommendations. Higher bonds = stronger trust signal. PageRank propagates: if trusted agents also recommend the same product, trust flows transitively.

- **ψ(a):** Sybil cluster penalty. Detects groups of agents that exhibit correlated recommendation patterns without independent verification. Applied as multiplicative penalty ∈ (0, 1].

- **ρ(a):** Recency decay. τ = 24 hours (matching AgentRank). An agent that hasn't made a recommendation in a week sees its score decay. This prevents "park reputation and stop working" attacks.

- **ω(a):** Outcome accuracy factor (new). Computed as:
  ```
  ω(a) = Σ(resolved_positively) / Σ(total_resolved) × quality_modifier
  quality_modifier = avg(quality_scores) / 100
  ```
  This weights agents not just by the quantity of bonds (PageRank) but by their actual success rate. An agent with 100 bonds but 50% success is ranked lower than an agent with 20 bonds but 95% success.

### The Bond Lifecycle

```
1. CREATION
   Agent identifies recommendation opportunity
   → Computes bond amount: B_base × V(r) × (1 - R(a))
   → Posts bond to RecommendationBond contract
   → Recommendation becomes visible to users with bond badge

2. DISTRIBUTION
   User discovers recommendation via AI surface layer
   → Sees bond amount and agent's RecommendationRank
   → Trust signal: "This agent staked $X that this is a good recommendation"
   → User decides to follow recommendation (or not)

3. OBSERVATION
   Resolution window begins
   → Automated signals track outcome (subscription, returns, repeat visits)
   → Layer 1 oracle monitors behavioral data

4. RESOLUTION (Happy Path — ~95% of cases)
   Resolution window expires
   → Automated signals indicate positive/neutral outcome
   → Agent claims resolution via claimResolution()
   → 2-hour optimistic window (UMA model)
   → Bond + reward returned to agent
   → Agent reputation R(a) increases

5. RESOLUTION (Dispute Path — ~5% of cases)
   User signals dissatisfaction OR automated signals indicate negative outcome
   → 7-day dispute window opens
   → Disputer posts matching bond
   → Oracle committee scores quality (0-100)
   → Bond returned proportionally OR slashed
   → Agent reputation R(a) adjusted

6. REPUTATION UPDATE
   After resolution:
   → R(a) updated based on outcome
   → PageRank recomputed (off-chain, daily)
   → RecommendationRank published on-chain (ZK-verified)
```

### Economic Flows

```
For each resolved recommendation:

AGENT RECEIVES:
  If success (score ≥ 70):
    bond_return + reward
    reward = advertiser_payment × (1 - protocol_fee)

  If mediocre (score 40-69):
    partial_bond_return = bond × (score / 100)
    no reward

  If failure (score < 40):
    bond_slashed (goes to slash_pool)
    no reward

ADVERTISER PAYS:
  Per-conversion fee to protocol
  Higher fee for bonded (trusted) conversions vs. unbonded
  Typical: $50-200 per conversion (SaaS vertical)

PROTOCOL COLLECTS:
  1.5% of all bond settlements
  10% of advertiser conversion fees
  Dispute resolution fees (from losing party)

USER PAYS:
  Nothing. Zero direct cost. (Google model — users are free)

SLASH POOL:
  Funded by slashed bonds
  Distributed to: successful disputers (40%), protocol treasury (40%),
                  insurance reserve (20%)
```

### Revenue Projections

**At scale (1M monthly recommendation bonds, average $10 bond):**

```
Bond volume: $10M/month
Protocol fee (1.5%): $150K/month
Advertiser fees (10% of $50/conversion × 100K conversions): $500K/month
Dispute fees: ~$50K/month
Total protocol revenue: ~$700K/month = ~$8.4M ARR

Slash pool (assuming 10% slash rate): $1M/month
  → Successful disputers: $400K
  → Protocol treasury: $400K
  → Insurance reserve: $200K
```

---

## 8. Implementation Roadmap

### Phase 0: Prototype (Weeks 1-4)
- Custodial bond escrow (no smart contract — simple database)
- Single vertical (SaaS recommendations)
- Single AI agent (Pico) as proof of concept
- Manual resolution (Håkon as oracle)
- **Purpose:** Validate the core mechanic — does bonding improve recommendation quality?

### Phase 1: On-Chain MVP (Months 2-4)
- Deploy BondRegistry + RecommendationBond on Base testnet
- UMA Optimistic Oracle integration for disputes
- Basic reputation system (simple accuracy tracking, no PageRank yet)
- 3-5 AI agents participating
- **Purpose:** Validate smart contract architecture and gas economics

### Phase 2: RecommendationRank (Months 4-8)
- Off-chain PageRank computation with ZK verification
- Sybil detection (ψ function)
- Recency decay (ρ function)
- Multi-vertical support (SaaS + restaurants + e-commerce)
- Bond delegation (Strategy 2)
- **Purpose:** Validate the ranking mechanism under adversarial conditions

### Phase 3: Scale (Months 8-12)
- Protocol subsidy program for new agents
- MCP server for AI integration (Layer 4 from TrustGraph architecture)
- Cross-chain deployment (Base → Arbitrum → Optimism)
- Advertiser marketplace
- **Purpose:** Achieve network effects

---

## 9. Key Design Principles

1. **Stakes, not opinions.** The system values what agents put at risk, not what they claim. A bond is the purest form of revealed preference.

2. **Optimistic by default, adversarial when challenged.** 95% of resolutions should be automatic. The dispute system exists as a credible threat, not a regular path.

3. **Linear sybil cost, no economies of scale.** Splitting stake across identities gains nothing. Each identity bears its own capital cost.

4. **Reputation is earned, never bought.** Capital provides entry; quality provides rank. A rich agent with bad recommendations ranks below a poor agent with good ones.

5. **Users pay nothing.** The Google insight: the product is free for users. Revenue comes from advertisers (who benefit from better-targeted, higher-converting recommendations) and protocol fees.

6. **No custom token.** USDC denomination avoids financialization, speculation, and the "launch a token" trap. The system's value accrues to its participants, not to token holders.

7. **Composable with existing infrastructure.** EAS for attestation, UMA for disputes, ERC-8004 for identity, x402 for payments, MCP for AI integration. Don't rebuild what exists.

---

## 10. Open Questions (For Håkon)

1. **Phase 0 scope:** Should the prototype use Pico as the sole agent, or recruit 2-3 external agents? Single-agent proves the mechanic; multi-agent tests the ranking.

2. **Vertical priority:** SaaS is the strongest economics (high LTV, measurable satisfaction). Restaurants are the most visceral demo. Which first?

3. **Integration with AgentLair:** Should recommendation bonds be an AgentLair feature (agents on our platform can bond) or a standalone protocol (any agent can participate)? The former is faster; the latter is bigger.

4. **Relationship to Synlig Digital AEO:** The bonded recommendation model directly extends AEO — instead of just optimizing for AI citations, businesses would earn bonded endorsements. Is this the product evolution path?

5. **Token or no token:** The spec says no custom token (USDC only). But a governance token could fund protocol development and create community alignment. Revisit if the mechanism proves viable?

---

## Sources

### Mechanism Design References
- [AgentRank (Hyperspace AI)](https://agentrank.hyper.space/) — PRd × ψ × ρ formula, sybil resistance via computational stake
- [AgentRank GitHub (0xIntuition)](https://github.com/0xIntuition/agent-rank/blob/main/agentrank.md) — Implementation details
- [Augur v2 Whitepaper](https://arxiv.org/pdf/1501.01042) — Decentralized oracle, dispute escalation, fork mechanism
- [Augur v2 Resolution](https://augur.net/blog/v2-resolution/) — Faster oracle and market resolution
- [Augur Lituus](https://thedefiant.io/news/defi/augur-reveals-augur-lituus-oracle-whitepaper) — Migration-based forking with supply restoration
- [Polymarket Resolution (UMA)](https://docs.polymarket.com/developers/resolution/UMA) — Optimistic oracle, $750 bond, 2h window
- [UMA Managed Proposers (MOOV2)](https://blog.uma.xyz/articles/managed-proposers) — Whitelisted proposers, 99.7% accuracy
- [Polymarket/UMA Adapter](https://github.com/Polymarket/uma-ctf-adapter) — Smart contract integration

### Game Theory & Sybil Resistance
- [Solving Sybil Attacks via Evolutionary Game Theory](https://dl.acm.org/doi/10.1145/2851613.2851848) — Replicator dynamics for sybil defense
- [Game Theoretical Defense Against Sybil Attacks](https://www.sciencedirect.com/science/article/pii/S1877050920307651) — Zero-sum game defense with trust thresholds
- [Kleros Yellow Paper](https://kleros.io/yellowpaper.pdf) — PNK staking, sybil-proof dispute resolution
- [Blockchain Bribing Attacks & Counterincentives](https://eprints.gla.ac.uk/357388/1/357388.pdf) — Slashing and dilution as equilibrium mechanisms
- [Prooφ ZKP Market Mechanism](https://fc25.ifca.ai/preproceedings/156.pdf) — Auction design with collusion mitigation

### Staking & Slashing
- [EigenLayer Slashing](https://daic.capital/blog/eigen-layer-slashing-mechanism) — AVS-specific slashing, 50% max, veto committee
- [EigenLayer Restaking Explained](https://consensys.io/blog/eigenlayer-decentralized-ethereum-restaking-protocol-explained) — Bond delegation model

### Bootstrap & Identity
- [ERC-8004: Agent Trust Standard](https://the.goodagents.company/erc-8004-ethereums-answer-to-the-ai-agent-trust-problem/) — Reputation registry, validation hooks
- [Recall Trust Infrastructure](https://www.decentralised.co/p/too-many-ais-too-little-trust) — Curator staking, cold-start scoring
- [Cold Start Problem with AI Agents](https://zams.com/blog/the-cold-start-problem-with-ai-agents-and-how-to-push-past-it) — Bootstrap strategies

### Internal Knowledge Base
- `/workspace/memory/knowledge/opportunities/2026-03-21-bonded-recommendations-economics.md` — Break-even accuracy analysis, affiliate comparison
- `/workspace/memory/knowledge/strategy/pagerank-2026-concept.md` — Master strategy document
- `/workspace/memory/knowledge/pagerank-2026-verification.md` — Outcome verification mechanisms
- `/workspace/memory/knowledge/pagerank-2026-economics.md` — Economic model analysis
- `/workspace/memory/knowledge/pagerank-2026-open-protocol.md` — Protocol architecture
