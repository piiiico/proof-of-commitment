# PageRank 2026: How Outcomes Get Verified — Mechanisms and Attack Surfaces

*Deep research. Created 2026-03-21. Explores how real-world outcomes are currently verified, how those systems are gamed, and what signals remain genuinely hard to fake.*

---

## The Central Tension

When content production is free (LLMs), the only unfakeable ranking signal is verified real-world outcomes. But if outcomes become the ranking signal, they **will** be gamed — just as backlinks were gamed when Google made them the signal. This document maps the verification landscape: what works, what breaks, and what might survive adversarial pressure.

---

## PART 1: VERIFICATION MECHANISMS

### 1.1 Amazon — Verified Purchase Reviews

**The technical flow:**
1. Customer purchases product on Amazon marketplace
2. Amazon's system records the transaction (order ID, price paid, account, timestamp)
3. When customer leaves a review, Amazon checks two conditions:
   - The reviewer bought the **exact item** through Amazon (not from another retailer)
   - They paid a price **available to most Amazon shoppers** (not a heavily discounted/free promotional item — threshold is ≥80% of list price)
4. If both conditions pass, the review gets the "Verified Purchase" badge
5. Verified reviews receive **higher weight** in Amazon's aggregate rating algorithm

**Detection infrastructure:**
- **Pre-publication screening:** 100% of product reviews are evaluated by ML before posting
- **ML stack:** Models trained on 25+ years of review data, analyzing account ties, behavioral patterns, reported abuse, sign-in activity
- **Large language models + NLP:** Detect incentivized reviews (gift cards, free products, coached language)
- **Deep graph neural networks:** Map complex relationships between accounts, sellers, and review patterns to identify coordinated manipulation
- **Scale (2023):** Blocked 250M+ suspected fake reviews. Claims 99%+ of viewed products contain only authentic reviews
- **Legal enforcement:** Sued 150+ bad actors across US, China, Europe. Took down 75 fake review brokers/websites (as of mid-2024)

**What it proves:** That *a transaction occurred* at *a market-rate price*. It does NOT prove the customer actually used the product, was satisfied, or that the review reflects genuine experience.

**Verification gap:** The system verifies **purchase**, not **outcome**. A verified purchase review that says "great product" proves the reviewer paid for it — not that the product worked.

---

### 1.2 Google Maps — "You Visited" / Location Verification

**How Google knows you visited a place:**

1. **GPS + cell tower + Wi-Fi triangulation:** Continuous location tracking when Location History is enabled. GPS provides ~3m accuracy outdoors; Wi-Fi positioning works indoors via Google's database of Wi-Fi network locations (built from Street View cars and Android device crowdsourcing)
2. **Timeline (formerly Location History):** Stores timestamped visit records. Automatically identifies "place visits" when a user dwells at a known location for a threshold duration
3. **Google Pay / wallet transactions:** Payment data at a merchant provides a strong secondary signal
4. **Semantic analysis:** Cross-references time-of-day, dwell time, movement patterns to distinguish "walked past" from "ate dinner at"
5. **Connected accounts:** Calendar entries, reservation confirmations in Gmail, Search queries for the place

**Review contribution verification:**
- Google does NOT explicitly verify that a reviewer visited a business before allowing a review. Anyone with a Google account can review any place
- However, Google's moderation system (now Gemini-powered) uses signals to weight and filter reviews:
  - Account age and activity history
  - Location history consistency
  - Behavioral patterns (bulk reviewing, suspicious timing)
  - Content analysis (generic vs. specific language)
- **Local Guides program:** Provides tiered reputation based on contribution volume, adding implicit trust weight

**Scale of anti-fraud (2024):**
- 240M+ policy-violating reviews blocked or removed
- 70M+ risky edits to Maps listings prevented
- 12M+ fraudulent Business Profiles removed or blocked
- 900K+ accounts had posting restrictions

**Gemini AI integration (2025):**
- Distinguishes legitimate business edits from suspicious changes ("Zoe's Coffee House → Zoe's Cafe" = fine; "cafe → plumber" = suspicious)
- Detects patterns in counterfeit five-star ratings post-publication
- Consumer alerts in US/UK/India when suspicious reviews are removed

**What it proves:** Location proximity (you were physically near the place). Does NOT prove you entered, received a service, or had any particular experience. Location data is also spoofable (see Part 2).

---

### 1.3 Norwegian Health Outcome Registries (NPR, KUHR)

**Norwegian Patient Registry (NPR):**
- Contains information on **everyone referred for or receiving specialized healthcare** at hospitals, outpatient clinics, or contract specialists since 1997
- Data includes: ICD-10 diagnosis codes, procedure codes, referrals, waiting times, patient pathways
- Linked to **fødselsnummer** (national personal ID number) since 2008
- Administered by Norwegian Institute of Public Health (FHI)
- Can be linked to other registries: Norwegian Registry for Primary Health Care (KUHR), Cancer Registry, Cause of Death Registry, Medical Birth Registry

**KUHR (Control and Payment of Health Reimbursements Database):**
- Contains bills from health services reimbursed by the state since 2006
- Covers all contacts with: general practitioners, emergency services, other publicly reimbursed healthcare
- Uses ICPC-2 coding (International Classification of Primary Care)
- Links to NPR for complete patient pathway tracking (primary care → specialist → outcome)

**Verification mechanism:** The data is **generated as a byproduct of the healthcare delivery system itself**. Clinicians enter diagnoses and procedures as part of billing and clinical documentation. The data is not self-reported — it's institutional.

**Outcome verification strength:**
- A patient receiving a knee replacement (procedure code in NPR) who does NOT return for revision surgery in 5 years = objectively good outcome
- A patient referred for depression (KUHR) whose subsequent NPR records show no escalation = treatment worked
- Population-level: compare same procedure across providers → who gets better outcomes?

**Access:** Strictly regulated. Requires ethical approval and application through helsedata.no. Statistics available publicly through Helsedirektoratet. Research use requires de-identification or ethical approval.

**What it proves:** Real clinical encounters, real diagnoses, real procedures, and (through longitudinal linkage) real health outcomes. The strongest outcome verification system identified in this research — because the data is created by the provider delivering the service, not by the consumer receiving it.

---

### 1.4 Blockchain Attestation Systems

#### Ethereum Attestation Service (EAS)
- **Architecture:** Two smart contracts — SchemaRegistry (defines data structures) and EAS (creates/verifies attestations)
- **Schemas:** Define what an attestation contains (e.g., `string outcome, uint8 rating, address business`)
- **On-chain attestations:** Permanently stored, gas cost, fully verifiable
- **Off-chain attestations:** Signed but stored off-chain (IPFS, server), verifiable via signature
- **What it currently attests:** Identity (Coinbase), membership, credentials, votes. No standardized "outcome" schema exists

**Could EAS attest real-world outcomes?** Yes, technically. Anyone can define a schema like:
```
address business, string serviceType, uint8 satisfactionScore,
bytes32 proofHash, uint256 timestamp
```
But EAS itself provides no verification of the underlying claim. It's a signed statement infrastructure — "I claim X happened" — not a truth-verification system. The trust comes from WHO signs the attestation, not from EAS itself.

#### Verax Protocol
- Cross-chain attestation **aggregation** registry (Linea/Consensys)
- Acts as a distribution channel: issuers store attestations, any dApp can compose from multiple sources
- Key use: combining attestations from different providers (e.g., Sumsub KYC + Coinbase verification + community reputation) into composite trust scores
- Recent (July 2025): Sumsub integration for on-chain identity attestations via liveness check + AML screening

#### Coinbase Verifications (Coinbase Attestations)
- Built on EAS, deployed on Base
- **What they actually attest:**
  - `Coinbase Verified Account` — user has a trading account (implies KYC)
  - `Verified Country` — user's country of residence
  - `Coinbase One Membership` — subscription status
- Links a wallet address to a Coinbase account without revealing PII
- **NOT outcome attestations** — they verify identity/membership, not real-world results

#### Critical Assessment

All current blockchain attestation systems verify **claims**, not **outcomes**. They answer "who said X?" not "did X actually happen?" The oracle problem remains: bridging real-world events to on-chain records requires a trusted data source. EAS + Verax provide the plumbing; the verification of real-world facts requires separate infrastructure (IoT, institutional data, zkTLS from authoritative sources).

---

### 1.5 ZK Proofs of Experience

**zkTLS / Reclaim Protocol — The Most Promising Primitive:**
- Enables **zero-knowledge proofs from any HTTPS source** without platform cooperation
- Technical flow: User connects to website (e.g., bank, booking platform) → TLS session data is witnessed by a notary → ZK proof generated that specific data exists without revealing the full dataset
- **What it can prove:** "My bank statement shows 5+ transactions at Restaurant X" without revealing amounts, other transactions, or identity
- **Production status:** Active, 29,000+ universities, 100+ airlines/hotels integrated

**Specific use cases now feasible** (from our ZK feasibility research):
| Proof | Feasible? | Generation Time | Proof Size |
|-------|-----------|-----------------|------------|
| ≥3 visits to a business | Yes | 2-15s mobile | ~192 bytes |
| ≥50 verified transactions | Yes (zkTLS simplifies) | Seconds | ~260 bytes |
| Satisfaction score from ≥20 experiences | Yes (simple functions) | Seconds | ~1KB |
| Aggregate 1000 users | Needs hybrid (ZK + TEE + DP) | N/A | N/A |

**What it proves:** Verifiable claims derived from authoritative data sources (banks, platforms) without revealing underlying data. The strongest ZK use case for outcomes: proving patterns in transaction data (repeat visits, spending levels) from bank APIs.

---

### 1.6 Receipt-Based Verification (Vipps, Bank Transactions)

**Vipps (Norway, ~4.5M users / ~85% of population):**
- Every Vipps payment creates a digital receipt with: merchant name, amount, timestamp, merchant category code
- Vipps API supports receipt data via `receipt.orderLines` (mandatory in Norway for long-living payments)
- Combined with BankID identity verification (same parent company: Vipps MobilePay)
- **PSD2 access:** Transaction data accessible via AISP APIs (Neonomics aggregates 3,500+ banks)

**What transaction data reveals:**
- **Repeat visits:** Same merchant appearing multiple times = genuine customer. Hard to fake at scale
- **Spending patterns:** Amount spent correlates with actual consumption (a 50 NOK coffee vs. 2000 NOK dinner)
- **Timing patterns:** Regular visits (weekly lunch) vs. one-off visits
- **Category consistency:** Transaction categories (MCC codes) match claimed experiences

**What it can't reveal:**
- What specific items were purchased
- Whether items were returned (return data stays with merchant/platform)
- Customer satisfaction (only that money changed hands)
- Quality of experience (a bad dinner still shows as a transaction)

**As proof of experience:** Transaction receipts are the most accessible, hardest-to-fake signal that a real economic exchange occurred. The combination of BankID (identity) + Vipps (transaction) + PSD2 (historical data access) creates a uniquely strong verification stack for Norway specifically.

---

### 1.7 IoT / Sensor / POS Data

**What IoT systems generate as outcome data:**

| System | Data Generated | Outcome Signal | Access |
|--------|---------------|----------------|--------|
| **POS terminals** | Transaction amount, items, timestamp, payment method | Service was purchased | Merchant-controlled; some aggregation via payment processors |
| **Smart locks** (hotels, Airbnb) | Lock/unlock events, duration of stay, occupancy patterns | Physical presence and duration | Platform-controlled; EU Data Act may open access (Sept 2026) |
| **Appointment systems** | Booking, check-in, duration, no-show rate | Service was attended | Highly fragmented across booking platforms |
| **Loyalty card / NFC** | Tap-in events with timestamp and location | Physical presence | Merchant-controlled |
| **Connected vehicles** | Location, duration at destinations, route patterns | Visit patterns with high precision | EU Data Act: access-by-design from Sept 2026 |
| **Wearables** | Heart rate, steps, sleep — during/after experience | Physiological response to experience | User-controlled; Apple/Google Health export APIs |

**EU Data Act impact (Sept 12, 2026):**
- Mandates access-by-design for IoT data
- Users get export rights + third-party sharing rights for data generated by connected devices
- Covers: connected vehicles, smart home, wearables, industrial IoT
- Does NOT cover: pure platform/service data (booking platforms, social media)

**What it proves:** Physical presence, duration, and in some cases physiological response. The strongest IoT outcome signals are temporal patterns — **how long someone stayed** and **whether they came back**.

---

## PART 2: ADVERSARIAL DYNAMICS

### 2.1 The Historical Pattern: Signal → Gaming → Arms Race

When Google made backlinks the signal, link farms appeared within months. When social media made engagement the signal, engagement bots and click farms appeared. **Every time a measurable proxy becomes a ranking signal, an industry emerges to fake that proxy.** The question is not *whether* outcomes will be gamed, but *how quickly* and *at what cost*.

### 2.2 Attack Vectors by Verification Mechanism

#### A. Fake Verified Purchases (Amazon Model)

**Current schemes:**
1. **Buy-and-return:** Purchase product at full price (get Verified badge), leave positive review, return product for refund. Amazon claims to detect this but reports suggest it still works for items returned after review posting
2. **Review swapping:** Two sellers buy each other's products, leave positive reviews. Both get Verified Purchase badges. Cost: only the product price
3. **Refund-after-review:** Third-party broker recruits buyers, reimburses them via PayPal/Venmo after review posts (outside Amazon's visibility)
4. **Incentivized reviews via social media:** Sellers recruit reviewers on Facebook/Telegram groups, offering free products or payment. The purchase IS real, so it gets the Verified badge. Amazon sued 10,000+ Facebook group admins in 2024-2025
5. **Amazon Vine manipulation:** Legitimate program where Amazon provides products for review, but sellers can game selection and reviewer pool

**Scale of the problem:**
- Amazon blocked 250M+ fake reviews in 2023 alone
- Industry analysts estimate 30-40% of reviews on some product categories are fake/manipulated
- Fake review broker services openly advertise (some now operate from outside US/EU jurisdiction)

**Defense gaps:** The fundamental weakness is that a **purchase** can be verified, but **genuine satisfaction** cannot. The badge proves an economic transaction, not an authentic experience.

#### B. Manufactured Location Data (Google Maps Model)

**How easy is GPS spoofing?**
- Numerous commercial apps (Dr.Fone, iToolab, Tenorshare) make GPS spoofing trivially easy on both Android and iOS
- Android: Enable developer mode → set mock location app → any location instantly
- iOS: Slightly harder (requires computer connection or jailbreak) but multiple tools available for $30-60
- No specialized hardware needed; entirely software-based

**Scaling location fraud:**
- Fake review farms can combine spoofed locations with aged Google accounts
- Bot farms can simulate "visits" to hundreds of businesses per day
- Google's Gemini-based detection catches some patterns but can't verify physical presence without hardware signals

**What makes it hard to defend:**
- Civilian GPS lacks encryption — signals are inherently spoofable
- Wi-Fi-based positioning can be fooled by replaying Wi-Fi beacon data
- Cross-referencing signals (GPS + Wi-Fi + cell + Bluetooth) raises the bar but doesn't eliminate spoofing
- **The fundamental gap:** Google verifies location through software signals that are all software-spoofable

#### C. AI-Generated Outcome Stories

**The 2025-2026 threat landscape:**

Research findings from multiple studies converge on a disturbing conclusion:

| Finding | Source | Implication |
|---------|--------|-------------|
| Humans detect AI fake reviews at **50.8% accuracy** (= random chance) | arXiv 2506.13313, 2025 | Human review readers are defenseless |
| Best AI detector (GPT-4o) achieves **50% accuracy** | Same study | AI detection tools are also defenseless |
| LLMs exhibit "veracity bias" — default to classifying reviews as real | Same study | Both humans and machines are biased toward believing |
| GPT-generated reviews are characterized as "Hidden Persuaders" | Same study | The generation-detection asymmetry favors attackers |
| Fraudulent reviews cost UK consumers **£2.2B annually** | UK government data | Economic impact is enormous even pre-LLM |

**The arms race imbalance:** Generating a convincing fake outcome story (e.g., "I visited this dentist and they fixed my crown perfectly, the waiting room was clean, the hygienist was named Sarah...") is trivially cheap with LLMs. Detecting that it's fake requires either:
- Verifying the factual claims (did the dentist have a hygienist named Sarah?) — extremely expensive
- Detecting stylistic tells — already proven ineffective (50% accuracy)
- Requiring verifiable proof of the underlying event — the only real defense

**Singapore case (2025):** A car service company was caught using ChatGPT to generate and post fake reviews at scale, leading to a regulatory crackdown. This is likely the tip of the iceberg.

#### D. Sybil Attacks on Attestation Systems

**The attestation gaming playbook:**
1. **Age identities slowly:** Create multiple wallets/accounts years before use. Farm small genuine transactions. Build legitimate-looking history
2. **Farm reputation incrementally:** Make small genuine contributions to build trust score, then exploit accumulated reputation for large fraudulent attestations
3. **Coordinate behavior across identities:** Multiple sybil identities that interact "naturally" — reviewing different businesses, maintaining different behavior patterns
4. **Game scoring mechanisms:** If the trust algorithm weights recent activity, burst fake positive signals before an important moment (product launch, etc.)

**Cost of Sybil identities by system:**

| System | Cost per fake identity | Scalability |
|--------|----------------------|-------------|
| Google account | ~$0.50-2 (bought in bulk) | Very high |
| Amazon account + verified purchase | ~$15-50 (product cost + time) | Moderate |
| Blockchain wallet + EAS attestation | ~$1-5 (gas fees) | Very high |
| BankID (Norway) | $10,000+ (document fraud + bank KYC) | Very low |
| World ID (Orb-verified) | ~$50-100 (pay someone for iris scan) | Low-moderate |
| eIDAS 2.0 wallet | $10,000+ (government-level fraud) | Very low |

**Critical insight:** Sybil resistance correlates directly with the **real-world cost** of creating a fake identity. Systems anchored in government identity (BankID, eIDAS) are orders of magnitude harder to sybil than systems based on software credentials.

#### E. Outcome Data Manipulation

**Beyond fake reviews — manipulating the underlying data:**
1. **Fake transactions:** Pay someone to make a real purchase at your business (wash trading equivalent). Cost: the transaction fee. Creates real Vipps/bank records
2. **Manufactured return visits:** Pay customers to return repeatedly (loyalty kickback schemes). Creates genuine repeat-visit patterns but at artificial cost
3. **Health outcome gaming:** Clinicians could theoretically code outcomes more favorably (upcoding/optimistic coding). Already a known issue in healthcare (DRG gaming)
4. **Financial statement manipulation:** Creative accounting to show better outcomes on Brønnøysund filings. Prevented partly by auditing requirements but small companies have lighter oversight

### 2.3 Summary: The Attack Surface Spectrum

| Verification Mechanism | Current Gaming | Gaming Cost | Detection Difficulty |
|----------------------|----------------|-------------|---------------------|
| Verified purchase (Amazon) | Widespread | Low ($15-50/review) | Medium |
| Location verification (Google) | Common | Very low ($0-5) | Medium-hard |
| Written reviews (any platform) | Ubiquitous with LLMs | Near-zero | Very hard |
| On-chain attestations (EAS etc.) | Emerging | Low ($1-5) | Hard |
| Bank transaction records (PSD2) | Possible but expensive | Medium-high (real money) | Easy to detect patterns |
| Health registries (NPR/KUHR) | Rare (institutional data) | Very high | Easy (audit trails) |
| IoT/sensor data | Possible (spoofing) | Medium | Medium |
| Financial statements (Brønnøysund) | Possible (accounting fraud) | High (legal risk) | Medium (audit) |

---

## PART 3: THE UNFAKEABLE RESIDUE

After all gaming is accounted for, what outcome signals are genuinely hard to fake?

### 3.1 Repeat Visits Over Time

**Why it's hard to fake:**
- Sustaining artificial repeat visits costs real money, every time
- A pattern of 12+ visits over 12 months to the same restaurant, visible in bank transaction data, is economically irrational to manufacture for each fake identity
- Combined with BankID (1 person = 1 identity), you can't create sybil repeat-visitors cheaply in Norway
- The **temporal dimension** is the key: faking a single visit is cheap, faking a pattern over months is expensive

**Quantitative strength:** Industry data shows average customer retention rates vary by sector (restaurants: ~55%, SaaS: ~80-90%, retail: ~60-70%). A business significantly above its sector average, verified through transaction data, is a strong signal.

**Residual attack:** Pay people to visit repeatedly (wash trading). Defense: statistical anomaly detection (sudden spikes, geographically implausible patterns, correlation with promotional timing).

### 3.2 Actual Health Outcomes (Registered in Official Systems)

**Why it's hard to fake:**
- Data is generated by healthcare providers as part of clinical workflow — not self-reported
- Linked to national personal ID (fødselsnummer) — no sybil identities
- Cross-referenced between registries (NPR + KUHR + Cancer Registry + Cause of Death)
- Auditable: clinician coding is tied to reimbursement claims, creating natural accountability
- Longitudinal: outcomes measured over years (5-year cancer survival, 10-year joint replacement durability)

**The strongest outcome signal:** "Patients treated at Hospital A for condition X have Y% better outcomes than Hospital B, measured by readmission rates, mortality, and functional status — and these numbers come from the healthcare system's own billing and clinical records."

**Residual attack:** Clinician upcoding (reporting better outcomes than actually occurred). Defense: audit mechanisms, cross-registry consistency checks, patient-reported outcome measures (PROMs) as independent validation.

### 3.3 Long-Term Customer Retention (Net Revenue Retention)

**Why it's hard to fake:**
- Revenue is verified through financial statements (Brønnøysund Register of Company Accounts)
- Long-term revenue growth from existing customers requires ongoing value delivery
- Public companies: audited by third parties. Private companies in Norway: required to file annual accounts
- Retention metrics compound: losing 5% of customers monthly = 46% annual churn. Faking high retention for a bad business is unsustainable

**Available Norwegian data:**
- Free annual account downloads via virksomhet.brreg.no
- Revenue, EBITDA, operating result, net result, total assets, equity, total debt
- Linked to organization numbers (consistent entity identification)
- Historical data allows trend analysis (growing revenue = retaining/expanding customers)

**Residual attack:** Creative accounting. Defense: audit requirements for larger companies, trend analysis over multiple years (harder to sustain fiction over long periods), cross-referencing with tax records (Skatteetaten).

### 3.4 Word-of-Mouth in Closed Networks

**Why it's hard to fake:**
- Recommendations from friends/family in private channels (WhatsApp groups, dinner conversations) are invisible to manipulation
- 92% of people trust peer recommendations over advertising
- Network effects: a recommendation from someone you know carries weight proportional to your relationship strength
- Can't be bought at scale because the channels are private and the relationships are real

**Digital proxy:** Messaging-based recommendations (shared links in private groups, Vipps "request" to friends for group dining). But these are inherently private — the trust signal exists but isn't capturable.

**Residual attack:** Astroturfing in semi-private groups (e.g., joining Facebook groups to plant recommendations). Defense: relationship-weighted trust (recommendations from close contacts matter more than from loose acquaintances).

### 3.5 Financial Performance as Public Record (Norway-Specific)

**Why it's hard to fake:**
- **ALL Norwegian companies with accounting obligations** must file annual accounts
- Data freely accessible via Brønnøysund Register Centre (brreg.no)
- Includes: revenue, profits, assets, equity, debt, employee count
- Filed annually with legal penalties for non-compliance
- Compulsory dissolution within 6 months of missing deadline

**The outcome signal:** A restaurant that has been operating profitably for 10 years, with growing revenue and no bankruptcy proceedings, is a fundamentally different proposition than one that's been losing money for 2 years. This data is:
- Government-mandated (not voluntary)
- Legally audited (for larger companies)
- Historically available (trend analysis possible)
- Linked to organization numbers (entity resolution)
- Free to access

**Residual attack:** Creative accounting, shell company structures. Defense: multi-year trend analysis, cross-referencing with employee data (Aa-registeret), and for larger companies, mandatory external audit.

### 3.6 Composite Unfakeability Score

Combining multiple hard-to-fake signals creates a composite that becomes exponentially harder to game:

```
Unfakeable Trust Score = f(
  repeat_transaction_pattern    (PSD2/Vipps),     weight: high
  health_outcome_registry       (NPR/KUHR),        weight: very high (sector-specific)
  financial_longevity           (Brønnøysund),      weight: high
  complaint_absence             (Forbrukerrådet),   weight: medium
  food_safety_grade             (Mattilsynet),      weight: medium (sector-specific)
  employee_retention            (Aa-registeret),    weight: medium
  BankID_verified_identity      (identity layer),   weight: prerequisite
)
```

**The key insight:** No single signal is unfakeable. But the combination of signals across independent systems — where gaming one doesn't help with the others — creates a **composite resistance** that scales multiplicatively with the number of independent signals.

To fake a high trust score, an attacker would need to simultaneously:
1. Generate real repeat transactions (costs real money × number of fake identities)
2. File convincing financial statements over multiple years (accounting fraud risk)
3. Maintain clean food safety inspections (requires actual compliance)
4. Show low complaint rates (requires actual service quality or active suppression)
5. Retain employees over time (requires actual workplace quality)

The cost of faking ALL of these simultaneously makes gaming economically irrational for most businesses — it becomes cheaper to simply provide good service.

---

## SYNTHESIS: Implications for Building the Outcome Layer

### What We've Learned

1. **Purchase verification ≠ outcome verification.** Amazon proves money changed hands. Google proves physical proximity. Neither proves the outcome was good. The gap between "transaction occurred" and "outcome was positive" is the entire whitespace.

2. **Institutional data is the gold standard.** Norwegian health registries (NPR/KUHR) are the best example of genuine outcome verification: data generated by the provider as part of service delivery, linked to verified identity, longitudinally trackable, auditable. The equivalent for other sectors doesn't exist yet.

3. **AI has broken review-based trust.** At 50.8% human detection accuracy for AI-generated fake reviews, written reviews as a trust signal are effectively dead. Any system built on text-based outcome claims is already compromised.

4. **Temporal patterns are the strongest privacy-preserving signal.** Repeat visits over time, visible in bank transaction data, are both hard to fake and privacy-compatible (via ZK proofs of patterns without revealing specifics).

5. **Norway has a uniquely strong verification stack.** BankID (identity) + Vipps/PSD2 (transactions) + Brønnøysund (financials) + Mattilsynet (inspections) + NPR/KUHR (health) = a cold-start bootstrapping stack that exists nowhere else.

6. **Composite signals are exponentially harder to game than single signals.** The cost of simultaneously faking data across independent verification systems makes gaming economically irrational.

### The Design Principle

**Don't verify claims. Verify patterns across independent systems.**

A single claim ("this is a good restaurant") is worthless. A pattern across independent systems (repeat transactions + growing revenue + clean inspections + low complaint rate + employee retention) is extremely expensive to fake.

The "PageRank 2026" system should NOT try to verify individual outcome claims. It should compute trust from **the convergence of independently-sourced signals** — each individually imperfect, but collectively robust.

---

## Sources

### Amazon Verification & Gaming
- Amazon Trustworthy Shopping: trustworthyshopping.aboutamazon.com
- "Can You Buy Amazon Reviews? (2026 Reality Check)": closo.co (Jan 2026)
- "How to Check Fake Amazon Reviews: 5-Step Method 2026": salesduo.com (Feb 2026)
- "Amazon Fights Back Against Fake Reviews": retailwire.com (Jan 2025)

### Google Maps Verification & Gaming
- Google Maps 101: blog.google (Feb 2021)
- Google Fraud Advisory (Nov 2025): blog.google
- "Google Maps Gets An Upgrade To Combat Fake Reviews": searchenginejournal.com (Apr 2025)
- "Suspicious High-Rated Reviews Warning": anddreamsdigital.com (Aug 2025)
- "Google Maps Warning — 10,000 Fakes Confirmed": Forbes (May 2025)
- "Anonymous Reviews Wild West": platform81.com (Dec 2025)

### AI-Generated Reviews
- "Large Language Models as Hidden Persuaders" (arXiv 2506.13313, June 2025)
- "AI-generated fake review detection": ScienceDirect (Jan 2026)
- "When AI Writes Fake Reviews: Singapore Case": fairpatterns.com (Jul 2025)
- "Explainable Deep Learning for ChatGPT-Rephrased Fake Review Detection": MDPI (Aug 2025)

### Norwegian Registries
- NPR: helsedata.no, bbmri.no/health-data
- KUHR: helsedata.no
- Bakken et al. (2020): "NPR and NRPHC: Research potential" (SAGE Journals)
- Brønnøysund Register of Company Accounts: brreg.no
- SSB Accounting Data: ssb.no

### Blockchain Attestations
- EAS: attest.org, docs.attest.org
- Verax: docs.ver.ax, gate.com/learn
- Coinbase Verifications: github.com/coinbase/verifications, help.coinbase.com

### ZK & Privacy
- Reclaim Protocol: reclaimprotocol.org
- Stanford Blockchain Review #74: zkTLS and DECO (Aug 2025)
- GPS Spoofing: guardsquare.com (Dec 2025), qoli.ai

### Sybil Resistance
- Wikipedia: Sybil Attack
- "Understanding Sybil Attacks: Blockchain Security Threats": gate.com (Nov 2025)
- "Sybil Attack Resistance In Blockchain Governance": eagleeyet.net (Mar 2026)

---

*This document feeds into the master PageRank 2026 research at `/workspace/memory/knowledge/pagerank-2026-research.md`. Complements the ZK feasibility study (`pagerank-2026-zk-feasibility.md`) and Proof of Personhood landscape (`pagerank-2026-proof-of-personhood.md`).*
