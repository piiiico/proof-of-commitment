# PageRank 2026: ZK Proofs for Behavioral/Commitment Data at Scale

*Deep research. Created 2026-03-21. Answers: Can zero-knowledge proofs practically enable privacy-preserving behavioral data at scale for a commitment graph?*

---

## 1. ZK Proofs Over Behavioral Data: Current State

### 1.1 The Gap: Identity Proofs Are Mature; Behavioral Proofs Are Not

The ZK ecosystem in 2026 has mature, production-ready infrastructure for **identity** claims (World ID, Semaphore, Privado ID). What it does NOT have is mature infrastructure for **behavioral** claims — proving patterns in time-series data like "I visited this restaurant 5+ times over 6 months" or "I've subscribed to this service for 2+ years."

**Why the gap exists:**
- Identity is a static statement ("I am human," "I am over 18"). One proof, done.
- Behavioral claims require proving properties of **sequences** — timestamps, frequencies, durations, patterns. This means larger circuits, more inputs, and more complex constraint systems.
- Nobody has needed behavioral proofs at scale before. The use case is genuinely novel.

**What exists today:**
- **ZKML** (ZK for machine learning) can verify that a model was correctly applied to data — theoretically applicable to time-series classification, but practical implementations focus on image/text models, not behavioral patterns.
- **zkTLS** (Reclaim, TLSNotary, vlayer) can prove claims about data from any HTTPS source — the most practical near-term path for behavioral proofs.
- **Zupass/PODs** provide a programmable data store with ZK proofs over structured attestations — conceptually closest to what a behavioral commitment system needs.
- **Custom circuits** (Circom, Halo2) can prove arbitrary statements, including behavioral ones, but require per-claim engineering.

### 1.2 What "Behavioral Proof" Actually Means Technically

A behavioral proof combines several cryptographic primitives:

1. **Data provenance** — The behavioral data came from a legitimate source (bank, payment processor, platform). Proven via: zkTLS transcript proofs, DKIM signatures (zkEmail), signed API responses, or TEE attestation.

2. **Data integrity** — The data hasn't been tampered with between source and proof generation. Proven via: Merkle tree commitments over the dataset, then selective disclosure of aggregate properties.

3. **Pattern assertion** — A specific property holds over the data (frequency ≥ N, duration ≥ T, amount in range [A, B]). Proven via: arithmetic circuit (Circom/Halo2) operating on committed data, or a zkVM (SP1/RISC Zero) running general computation.

4. **Anonymity** — The prover doesn't reveal their identity. Proven via: Semaphore V4 anonymous group membership.

**The key insight:** We don't need a single "behavioral proof system." We need to **compose** existing primitives: zkTLS for provenance + Merkle commitments for integrity + custom circuits for pattern assertions + Semaphore for anonymity.

---

## 2. zkTLS: Proving Claims About Bank/Transaction Data

### 2.1 How zkTLS Works

zkTLS creates cryptographic proofs about data received over HTTPS — without the server's cooperation or knowledge. Three architectural approaches exist:

| Approach | Projects | Trust Model | Performance | Production? |
|----------|----------|-------------|-------------|-------------|
| **MPC/2PC** | TLSNotary/Opacity, DECO/Chainlink | Cryptographic (no trust required) | Slower (MPC overhead) | TLSNotary: alpha.14 |
| **Proxy witness** | Reclaim Protocol | Semi-trusted attestor | Fast (~30 seconds) | Yes (3M+ verifications) |
| **TEE-based** | vlayer (optional), zkPass | Hardware trust | Near-native TLS speed | Yes |

### 2.2 Can You Prove Claims About Bank Transaction History via zkTLS Today?

**Yes, with caveats.**

**What works now:**
- **Reclaim Protocol** can prove claims about any data visible in a bank's web interface. Example: "My account balance exceeds $10,000" or "I have 50+ transactions this month." Used in production by ZKP2P (fiat-to-crypto ramps on Base, Arbitrum, Solana), 3Jane (undercollateralized DeFi lending using FICO scores via Plaid), and TransCrypts (background checks).
- **TLSNotary** can create full transcripts of TLS sessions with banks, then selectively disclose claims. More rigorous security model (no trusted attestor) but slower.
- **vlayer** enables server-side web proofs via token-authenticated APIs — good fit for PSD2 AISP endpoints.

**Practical limits:**

| Constraint | Impact | Mitigation |
|------------|--------|------------|
| **Bank session timeouts** | TLS sessions with banks are short-lived; MPC overhead can exceed timeout | Reclaim's proxy model is faster (~30s); TLSNotary preprocessing helps |
| **IP-based blocking** | Banks may detect/block known attestor IPs | Attestor rotation, residential proxies, but arms race |
| **Response size** | TLSNotary: ~5s native / ~10s browser for 10 KB response; scales linearly | Most bank API responses are <10 KB |
| **Data structure variability** | Each bank's web interface/API returns different HTML/JSON | Per-bank proof templates needed; Reclaim uses "providers" |
| **2FA/SCA requirements** | PSD2 mandates Strong Customer Authentication | User must authenticate in real-time; proof is of the authenticated session |

### 2.3 TLSNotary Performance Benchmarks (alpha.14, January 2026)

| Network Scenario | Native Build | Browser Build | Payload |
|-----------------|-------------|--------------|---------|
| Cable (20 Mbps, 20ms) | 14.9s | 17.0s | 1 KB req, 2 KB resp |
| Fiber (100 Mbps, 15ms) | 4.0s | 6.2s | 1 KB req, 2 KB resp |
| Mobile 5G (30 Mbps, 30ms) | 10.8s | 12.9s | 1 KB req, 2 KB resp |
| Typical API response (~10 KB) | ~5s native | ~10s browser | — |

**Note from Security Alliance (Oct 2025):** "TLSNotary is computationally expensive and generates proofs which are an order of magnitude larger than the underlying data. It is not a viable solution for high volume attestations." TLS Attestations (a lighter alternative sacrificing privacy for throughput) were proposed as complement.

### 2.4 Reclaim Protocol Performance

- **Proof generation:** ~30 seconds end-to-end (including user interaction with target website)
- **Verification:** Instant (signed attestation from witness)
- **Proofs completed:** 3M+ with zero fraud
- **Trust trade-off:** Requires semi-trusted attestor node. Reclaim mitigates with random attestor selection from a committee, but collusion between user and attestor remains theoretically possible.
- **IP attestor problem:** Target servers can detect and rate-limit known attestor IPs — limits scale in adversarial environments.

### 2.5 PSD2 + zkTLS: The Specific Opportunity

PSD2 mandates that banks expose Account Information Service Provider (AISP) APIs. This is the ONLY behavioral data type with standardized, legal, API-based access to transaction history across 3,500+ European banks (via intermediaries like Neonomics, Tink, Plaid).

**The zkTLS + PSD2 integration path:**
1. User authenticates with bank via PSD2 consent flow (standard, BankID-based in Norway)
2. AISP API returns transaction history as structured JSON
3. zkTLS proves properties of that JSON without revealing raw transactions
4. Proof: "This user has 15+ transactions at merchant X over 6 months" — verified by bank's TLS certificate, without revealing other transactions, amounts, or identity

**Nobody has built this specific integration yet.** The pieces all exist (PSD2 APIs + zkTLS provers + ZK circuits for range/frequency proofs), but no project has combined them for behavioral attestation. This is a genuine greenfield opportunity.

**Critical caveat:** GDPR Article 20 (data portability) excludes inferred/derived data. The raw transaction data is portable; behavioral patterns computed from it may not be. The system must prove patterns from raw data, not request pre-computed behavioral scores.

---

## 3. Performance Envelope: 1M Users × 100 Claims/Month

### 3.1 Per-Claim Costs

| Component | Time | Size | Compute Cost |
|-----------|------|------|-------------|
| **zkTLS proof generation** (Reclaim) | ~30s user-facing | Attestation: ~1-2 KB | Client-side (user's device) |
| **zkTLS proof generation** (TLSNotary) | 5-15s server-mediated | Transcript: ~10x data size | Server: ~$0.001-0.01/proof |
| **ZK circuit proof** (Groth16, simple range/frequency) | 2-15s mobile, <1s native | ~192 bytes | Client-side or proving service |
| **ZK circuit proof** (zkVM, general computation) | 10-60s | ~260 bytes (wrapped) | GPU cluster: ~$0.01-0.10/proof |
| **Semaphore anonymity layer** | 2-15s mobile | ~192 bytes | Client-side |
| **On-chain verification** (if needed) | — | — | ~300K gas (~$0.30-3.00) |

### 3.2 At Scale: 100M Claims/Month

| Metric | Estimate | Basis |
|--------|----------|-------|
| **Total proof generation compute** | ~1.5M CPU-hours/month | 100M × 30s avg (if server-mediated) |
| **Cloud cost (proving service)** | $50K-500K/month | Depends heavily on circuit complexity and GPU utilization |
| **On-chain verification (if all on-chain)** | $30M-300M/month | Prohibitive — off-chain verification essential |
| **Off-chain verification** | ~0.001 CPU-second each | 1-4ms per Groth16 verification |
| **Storage (proofs only)** | ~50 GB/month | 100M × ~500 bytes avg proof |
| **Storage (Merkle commitments)** | ~3.2 GB/month | 100M × 32 bytes per commitment |

### 3.3 Feasibility Assessment

**Client-side proving (user's device):** The preferred approach. If each user generates their own proofs:
- 100 claims/month = ~3.3 claims/day = trivial for any modern device
- Battery impact: negligible (2-15s of computation per claim)
- No centralized compute cost
- **But:** Limited to simple circuits. Complex behavioral analysis would need more powerful proving.

**Server-assisted proving (TEE or proving service):**
- SP1 Hypercube: 16× RTX 5090 GPUs can prove Ethereum blocks in <12s. A cluster costing ~$100K could handle enormous throughput.
- RISC Zero R0VM 2.0: 5x cost reduction over v1. General computation proving becoming affordable.
- **For behavioral claims specifically:** Most claims are simple (frequency ≥ N, duration ≥ T). These need circuits with <10K constraints — orders of magnitude smaller than Ethereum block proofs. Cost per proof: <$0.001.

**Verdict:** 1M users × 100 claims/month is **absolutely feasible** with client-side proving for simple claims. Even server-mediated proving would cost <$10K/month for simple behavioral circuits. The bottleneck is NOT compute — it's the data provenance step (zkTLS), which requires user interaction with the source website.

### 3.4 The Real Bottleneck: Data Freshness

The hardest scaling problem isn't proof generation — it's data freshness. If users must re-prove their behavioral data monthly:
- 100M zkTLS sessions/month with banking APIs
- Banks see 100M API calls from attestor infrastructure
- PSD2 APIs have rate limits (typically 4 calls/day per consent)
- **Mitigation:** Batch data retrieval (one PSD2 call returns full transaction history), then generate multiple behavioral proofs from a single data snapshot locally.

---

## 4. Aggregating ZK-Proven Data Across Users

### 4.1 The Fundamental Problem

ZK proofs prove statements about **individual** data. A commitment graph needs **aggregate** statistics: "67% of visitors return to restaurant X" or "average satisfaction across 500 users is 4.2/5." ZK alone doesn't aggregate — you need a combining mechanism.

### 4.2 The Hybrid Architecture

The consensus approach across research and industry (Google Privacy Sandbox, Mozilla/ISRG Divvi Up, academic literature) is a three-layer hybrid:

```
Layer 1: ZK Input Validation
  Each user proves: "I am a real person, my data is valid, my contribution is well-formed"
  → Prevents Sybil attacks, data injection, format manipulation

Layer 2: Secure Aggregation
  A trusted/verifiable environment combines validated contributions
  → Options: TEE (Nitro Enclave), secret-sharing (Prio/DAP), or MPC

Layer 3: Output Protection
  Aggregated result is released with differential privacy noise
  → Prevents re-identification from aggregate statistics
```

### 4.3 Concrete Systems for Each Layer

**Layer 1 — ZK Input Validation:**
- Semaphore V4: Anonymous group membership (proving "I'm in the verified user set")
- Custom Circom/Halo2 circuits: Proving data well-formedness (values in range, correct format)
- zkTLS attestations: Proving data came from a legitimate source
- **Whisper's silently verifiable proofs** (UC Berkeley, IEEE S&P 2024): Novel proof system where servers can verify an **entire batch** of proofs by exchanging a single 128-bit string. Sublinear server costs.

**Layer 2 — Secure Aggregation:**

| System | Architecture | Scale | Production? | Best For |
|--------|-------------|-------|-------------|----------|
| **Prio3/DAP** (Mozilla, ISRG) | Secret-sharing + MPC between 2 non-colluding servers | Production (Firefox) | Yes | Simple statistics (sums, histograms) |
| **Whisper** (UC Berkeley) | Secret-sharing + silently verifiable proofs | 100K+ clients benchmarked | Research prototype | Sublinear server costs at scale |
| **AWS Nitro Enclaves** | TEE-based aggregation | Near-native perf | Yes | General computation, low complexity |
| **Drynx** | Homomorphic encryption + ZK for verification | Research | No | Verified aggregate queries |
| **OLIVE** | TEE + differential privacy for federated learning | Research | No | ML model aggregation |

**Layer 3 — Differential Privacy:**
- Apple: ε = 2-16/day, hundreds of millions of devices
- Google: varies by application, ~3 billion devices
- At ε ≈ 2: deep learning loses only ~4.7% accuracy
- For 1000 users: central DP (server adds noise) is practical
- For 100K+ users: local DP (each client adds noise) becomes viable

### 4.4 The Prio/DAP Path (Most Production-Ready)

**Divvi Up** (ISRG) + Mozilla Firefox is the most mature deployment of privacy-preserving aggregate statistics:
- Two non-colluding servers (Mozilla + ISRG)
- Clients secret-share their data, send one share to each server
- Servers jointly compute aggregates without learning individual values
- ZK proofs ensure clients submit well-formed data (no poisoning)
- Standardized as IETF DAP (Distributed Aggregation Protocol)
- **Already collecting real user metrics in Firefox**

**For the commitment graph:** Replace "Firefox telemetry" with "behavioral trust claims." Each user secret-shares their verified behavioral contribution. Two aggregation servers compute trust scores jointly. Neither server sees individual behavior. This is architecturally identical to what Mozilla/ISRG already run.

### 4.5 SNARK Proof Aggregation (Complementary)

For on-chain or public verification of aggregate results:
- **SnarkPack:** Aggregates 8,192 Groth16 proofs in 8.7s, verifies in 163ms. Logarithmic proof size.
- **SnarkFold:** Aggregates 4,096 Plonk proofs into 0.5 KB, verifies in 4.5ms. Constant verification time.
- **Axiom/Worldcoin:** Batch World ID verification — transfer grants to hundreds of users in a single on-chain transaction.
- **Recursive composition (Nova/HyperNova):** Fold proofs incrementally, amortize cost. ~100x faster than Plonky2 for incremental verification.

---

## 5. Closest Existing Implementations

### 5.1 Tier 1: Directly Relevant (components exist, not combined)

| Project | What It Does | Relevance to Behavioral Trust Graph |
|---------|-------------|-------------------------------------|
| **Reclaim Protocol** | zkTLS proofs from any HTTPS source | Data provenance for bank/platform behavioral data |
| **Zupass/PODs** | Programmable cryptographic data store with ZK | User-controlled behavioral attestation storage |
| **Divvi Up/Prio3** | Privacy-preserving aggregate statistics (production) | Aggregation layer for trust scores |
| **Semaphore V4** | Anonymous group membership proofs | Sybil-resistant identity layer |
| **ZKP2P** | Fiat-to-crypto ramps using zkTLS payment proofs | Proves payment behavior (Venmo, Revolut, HDFC) |
| **Worldcoin** | Proof of personhood + batch verification | Scale reference for global identity verification |
| **vlayer** | Web proofs for Ethereum smart contracts | On-chain behavioral attestation integration |

### 5.2 Tier 2: Adjacent (solving related problems)

| Project | What It Does | Gap vs. Behavioral Trust |
|---------|-------------|-------------------------|
| **3Jane** | Undercollateralized DeFi lending using credit scores via zkTLS | Proves one financial attribute, not behavioral patterns |
| **OpenRank (Karma3Labs)** | EigenTrust on Farcaster/Lens social graphs | Trust algorithm exists, but on public social data, not private behavioral |
| **Opacity Network** | zkTLS with proof-of-committee and economic slashing | Robust attestation, but focused on identity/credentials |
| **ARS-Chain** | Anonymous cross-platform reputation sharing | Privacy-preserving reputation, but no behavioral data input |
| **PrivRep** | Homomorphic reputation scoring with ZK range proofs | Closest to aggregate behavioral trust, but academic prototype |
| **Accountable + vlayer** | Real-time proof-of-reserves verification | Verifiable financial state, not behavioral patterns |

### 5.3 Tier 3: Building Blocks

| Project | Role |
|---------|------|
| **SP1 Hypercube / RISC Zero R0VM 2.0** | General-purpose ZK proving (if custom circuits aren't enough) |
| **Circom / Halo2** | Custom circuit design for specific behavioral claims |
| **Binius** (expected 2026) | 10-100x proving speedup for binary computations |
| **eIDAS 2.0 wallets** (Dec 2026 mandate) | Standardized ZK-capable identity across all EU member states |

### 5.4 What Nobody Has Built

The specific intersection of:
1. **PSD2 bank transaction data** (source)
2. **zkTLS provenance** (trust)
3. **Behavioral pattern proofs** (frequency, duration, loyalty)
4. **Prio-style aggregation** (privacy-preserving statistics)
5. **Trust graph computation** (EigenTrust/PageRank on the aggregate)

**This combination does not exist anywhere.** Each component is production-ready or near-ready. The integration is the innovation.

---

## 6. What's Genuinely Impossible vs. Hard vs. Ready

### 6.1 Production-Ready Today (2026)

| Capability | Proof | Notes |
|-----------|-------|-------|
| Prove "I am human" anonymously | Semaphore V4 + World ID/BankID | 12-16M users on World ID |
| Prove "my bank balance > X" | Reclaim Protocol zkTLS | 3M+ verifications, zero fraud |
| Prove "I have N+ transactions" | Reclaim + simple range proof | ZKP2P does this for payments |
| Aggregate statistics without revealing individual data | Prio3/DAP (Divvi Up) | Running in Firefox production |
| Verify batches of ZK proofs efficiently | SnarkPack, recursive composition | SnarkPack: 8,192 proofs in 8.7s |

### 6.2 Hard But Feasible (6-18 months of engineering)

| Capability | Challenge | Path |
|-----------|-----------|------|
| Prove "I visited business X 5+ times in 6 months" | Requires time-series circuit + data provenance | Custom Circom circuit + zkTLS from PSD2 API |
| Prove "my repeat purchase rate for category Y is above Z%" | Behavioral pattern extraction as ZK circuit | zkVM (SP1) for complex logic; simple circuits for threshold checks |
| Aggregate 10K+ users' behavioral proofs into trust scores | Combining ZK input validation + secure aggregation | Prio3/DAP for aggregation + Semaphore for identity |
| Cross-platform behavioral correlation | Proving properties across multiple data sources | Multiple zkTLS proofs composed; Zupass PODs as unified store |
| BankID → Semaphore anonymity bridge | Linking strong identity to anonymous group membership | Technical: straightforward. Legal: needs GDPR analysis |

### 6.3 Genuinely Impossible Today (2-5+ years)

| Capability | Blocker | When Possible |
|-----------|---------|---------------|
| Pure cryptographic aggregation (no TEE, no trusted server) | ZK proofs prove, not compute. MPC at 1M mobile clients infeasible. | Efficient FHE aggregation: 3-5 years (awaiting hardware acceleration) |
| Complex behavioral ML in ZK (time-series classification) | ZKML works for simple models; behavioral time-series models have huge circuits | 2-3 years (zkVM performance improving 8x/year) |
| Real-time behavioral streaming proofs | Continuous proving of behavioral patterns as they happen | Incremental verification (Nova) makes this theoretically possible, but no implementation exists |
| Privacy-preserving graph traversal | Computing PageRank/EigenTrust on an encrypted graph | FHE graph algorithms are research-only; TEE is the practical path |
| Universal behavioral proof standard | No standard for what constitutes a "behavioral claim" | Requires ecosystem coordination; eIDAS 2.0 may catalyze |

---

## 7. The Honest Assessment

### What works:
- **Individual behavioral claims** from banking data: zkTLS makes this practical today. 30 seconds per proof. No custom cryptography needed.
- **Anonymous identity**: Semaphore V4 is production-ready. BankID provides the strongest proof-of-personhood in Europe.
- **Aggregate statistics**: Prio3/DAP is deployed at scale (Firefox). The aggregation problem is solved for simple statistics.
- **Proof efficiency**: Groth16 proofs are 192 bytes. Verification is milliseconds. Storage is negligible.

### What's hard:
- **Behavioral proofs beyond simple thresholds** require custom circuits. "I visited 5+ times" is easy. "My visiting pattern suggests genuine loyalty vs. gaming" is orders of magnitude harder.
- **Data freshness** is the real bottleneck. Users must periodically re-prove from source data. PSD2 API rate limits constrain this.
- **Bank IP detection of attestor infrastructure** is an arms race that gets harder at scale.
- **No standard exists** for behavioral claims. Each data source requires custom proof templates.

### What's impossible right now:
- **Pure ZK aggregation** at the scale needed (millions of users). The hybrid TEE + ZK + DP approach is the only viable path.
- **Complex behavioral pattern analysis** in zero knowledge. Simple frequency/duration checks: yes. ML-based behavioral classification: no (circuits too large).
- **Privacy-preserving graph computation** (PageRank on encrypted data). Must use TEE.

### The strategic conclusion:

The vision of "IndexingReality" doesn't require waiting for impossible technology. The v1 architecture — **zkTLS provenance + simple ZK behavioral proofs + Prio-style aggregation + TEE for graph computation + DP for output protection** — is buildable today with existing components. The innovation is the *combination*, not any individual primitive.

The genuinely novel contribution is: **applying zkTLS to PSD2 banking data for behavioral attestation**. Nobody has done this. The regulatory framework (PSD2 data access), identity infrastructure (BankID), and cryptographic tools (Reclaim/TLSNotary + Circom) all exist. The integration gap is the opportunity.

---

## Sources & References

- [TLSNotary Benchmarks (Aug 2025)](https://tlsnotary.org/blog/2025/08/31/benchmarks/)
- [TLSNotary alpha.14 Performance (Jan 2026)](https://tlsnotary.org/blog/2026/01/19/alpha14-performance/)
- [Reclaim Protocol: The ZK in zkTLS](https://blog.reclaimprotocol.org/posts/zk-in-zktls)
- [Stanford Blockchain Review: zkTLS and DECO](https://review.stanfordblockchain.xyz/p/74-cryptography-research-spotlight)
- [Whisper: Private Analytics via Streaming (IEEE S&P 2024)](https://eprint.iacr.org/2024/666)
- [Scaling ZKPs Through Co-Design (Berkeley 2025)](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2025/EECS-2025-32.pdf)
- [vlayer Web Proofs](https://book.vlayer.xyz/features/web.html)
- [ZKP2P Protocol Docs](https://docs.peer.xyz/protocol/zkp2p-protocol)
- [Divvi Up in Firefox (ISRG)](https://divviup.org/blog/divvi-up-in-firefox/)
- [SnarkPack: Efficient SNARK Aggregation](https://eprint.iacr.org/2021/529.pdf)
- [Axiom Worldcoin Aggregation (GitHub)](https://github.com/axiom-crypto/worldcoin-aggregation)
- [SP1 Hypercube Real-Time Proving](https://blog.succinct.xyz/real-time-proving-16-gpus/)
- [RISC Zero R0VM 2.0 Analysis](https://medium.com/@0xjacobzhao/from-zkvm-to-open-proof-market-an-analysis-of-risc-zero-and-boundless-7bf96d503266)
- [ZK Proofs for Financial Compliance (SSRN, Mar 2025)](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5170068)
- [Open Banking 2.0: ZK Strategic Imperative](https://blog.zk.me/open-banking-2-0-the-strategic-imperative-for-web3-fintech/)
- [Privacy-Preserving Reputation Systems Survey (ACM)](https://dl.acm.org/doi/10.1145/3490236)
- [zkTLS: Verifiable Data Composability (Shoal, Mar 2025)](https://www.shoal.gg/p/zktls-verifiable-data-composability)
- [zkTLS: Bridge Between Web and Blockchain (Jul 2025)](https://blog.impossible.finance/zktls/)
- [Zupass / PODs (pod.org)](https://pod.org/z-api/introduction/)
- [ZK Proof AI in 2026 (Calibraint)](https://www.calibraint.com/blog/zero-knowledge-proof-ai-2026)
- [Security Alliance: TLS Attestations (Oct 2025)](https://radar.securityalliance.org/2025-10-verifiable-phishing-reports/)
