# PageRank 2026: ZK Proofs and Privacy-Preserving Behavioral Data — Practical Feasibility

*Technical research. Created 2026-03-21. Answers: Can zero-knowledge proofs practically enable the "share everything, reveal nothing" model for behavioral data sharing?*

---

## 1. State of ZK Proofs in 2026

### 1.1 Proof System Benchmarks

| System | Proof Size | Verification Time | Proving Time | Setup | Best For |
|--------|-----------|-------------------|-------------|-------|----------|
| **Groth16** | 128-192 bytes | 1.2-4.4 ms | Fastest SNARK for fixed circuits | Per-circuit trusted | On-chain verification, mobile |
| **PLONK/Halo2** | ~400-868 bytes | Constant, ms-range | 4-9x slower than Groth16 (SHA-256) | Universal/none (IPA) | Flexible circuits, no trusted setup |
| **STARKs** | 40-250+ KB | Polylogarithmic | Often fastest raw | None (transparent) | Post-quantum, large computations |
| **Plonky2/3** | STARK-sized | Similar to STARKs | Plonky2: 50% slower than Halo2 for large inputs | None | Recursive composition |
| **Nova/HyperNova** | Folding-based | Amortized | ~100x faster than Plonky2 for IVC | None | Incremental verification |
| **SP1 (zkVM)** | ~260 bytes (Groth16-wrapped) | ~270k gas on-chain | 10.3s Ethereum block (200 RTX 4090s) | Transparent | General computation |
| **RISC Zero** | Groth16-wrapped | Similar to SP1 | 44s Ethereum block (R0VM 2.0) | Transparent | General computation |

**Key development: STARK-to-SNARK wrapping.** Production systems (SP1, RISC Zero, Polygon zkEVM) now prove in STARKs (fast, transparent, post-quantum) then wrap in Groth16 (~260 bytes) for on-chain verification. Best of both worlds.

### 1.2 Client-Side Proving — Can a Phone Do It?

| Environment | Proving Time | Notes |
|-------------|-------------|-------|
| MacBook Air M3 (browser, Halo2+KZG WASM) | **420 ms** | Aleph Zero benchmark, Poseidon2 hash |
| Laptop i9-12900H (browser) | **790 ms** | Same benchmark |
| Average laptop (browser) | **~1,380 ms** | Before device optimization |
| World App (ZKML iris update, latest iPhone) | **<1 minute** | Complex ML model, hundreds of MB peak RAM |
| Semaphore membership proof (mobile browser) | **~2-15 seconds** | Depends on hardware; was 10+ minutes in 2020 |
| Industry UX ceiling for mobile proofs | **<15 seconds** | Longer = unacceptable UX |

**Bottom line:** Simple membership/attestation proofs (Semaphore-style) now take seconds on mobile browsers and sub-second on modern laptops. Complex proofs (ZKML) take under a minute on flagship phones. The UX is viable.

**Constraints:** WASM blobs can be hundreds of MB (download cost). Trusted setup parameters can be 20+ MB. Battery/memory usage is significant for complex proofs. Rapidsnark (C++/asm native) is 4-10x faster than snarkjs (JS).

### 1.3 ZK Identity/Attestation Projects — Who's Doing What

| Project | Status (2025-2026) | What It Proves | Scale |
|---------|-------------------|----------------|-------|
| **World ID** | Production | Unique humanness (iris scan) | 12-16M registered |
| **Privado ID** (ex-Polygon ID) | Production | Age, KYC, compliance, personhood | Enterprise POCs (Deutsche Bank, HSBC) |
| **Semaphore V4** | Production | Anonymous group membership | Powers World ID, widely used |
| **Zupass/PODs** | Active beta | Arbitrary signed attestation claims | 10K+ users at Devcon |
| **Anon Aadhaar** | Active dev | Indian identity attributes (age, citizenship) | ETHIndia voting; UIDAI sandbox 2025 |
| **zkEmail** | Active | Any text in sent/received email via DKIM | Growing ecosystem |
| **ZKP2P / Reclaim / zkPass** | Active | Fiat payments, HTTPS source data (zkTLS) | ZKP2P V2 launched Feb 2025 |
| **Sismo** | **Dead** | N/A — no commits since March 2024 | Do not build on this |

**The zkTLS ecosystem is the sleeper.** ZKP2P, Reclaim Protocol, vlayer, and Cr3dentials are building "prove anything from any HTTPS source" infrastructure. This is more immediately useful for behavioral data attestation than building custom circuits.

---

## 2. Specific Use Case Feasibility

### Use Case 1: "Prove I visited business X more than 3 times without revealing my identity"

**Feasible: YES.**

- **ZK scheme:** Semaphore V4 for anonymous group membership + Merkle proof of visit records.
- **How:** User maintains a local log of signed visit attestations (from payment data, location check-ins, or merchant POS). A ZK proof demonstrates: (1) I am a verified member of the user group (Semaphore), (2) my Merkle tree of visits contains ≥3 entries for business X. Neither the identity nor the other entries are revealed.
- **Proof size:** ~192 bytes (Groth16).
- **Generation time:** 2-15 seconds on mobile browser; sub-second native.
- **Verification cost:** ~300k gas on-chain; 1-4 ms off-chain.
- **Existing precedent:** ZK Proof-of-Location (ZK-PoL) papers formalize privacy-preserving location verification. Zupass already does attribute proofs from signed data.

### Use Case 2: "Prove I am a real person with 50+ verified transactions without revealing any"

**Feasible: YES.**

- **ZK scheme:** Semaphore for identity + recursive proof composition or zkVM.
- **How:** User imports transaction history (via PSD2/bank API). A ZK circuit proves: (1) user holds a valid BankID-verified identity credential, (2) their transaction set contains ≥50 entries, (3) each transaction has a valid bank signature. The transactions themselves are never revealed.
- **Proof size:** ~260 bytes (via SP1/RISC Zero Groth16 wrap) or ~192 bytes (custom Groth16 circuit).
- **Generation time:** Seconds for a custom circuit; minutes if using a zkVM for general computation.
- **Practical approach:** Use zkTLS (Reclaim Protocol) to prove the bank API returned ≥50 transactions. No custom circuit needed.

### Use Case 3: "Prove my satisfaction score for a category is based on 20+ real experiences"

**Feasible: YES, with design choices.**

- **ZK scheme:** Custom Circom/Halo2 circuit or zkVM.
- **How:** User computes a satisfaction score locally from their experience data. ZK proof demonstrates: (1) the score was computed from ≥20 signed experience records, (2) the computation followed the agreed-upon scoring function, (3) each record has valid provenance (signed by a merchant, bank, or platform).
- **Challenge:** Proving the scoring function was applied correctly requires the function to be expressed as an arithmetic circuit. Simple functions (weighted average) are trivial; complex ML models would need ZKML infrastructure.
- **Proof size:** ~192 bytes to ~1 KB depending on circuit complexity.
- **Generation time:** Seconds for simple scoring functions.

### Use Case 4: "Aggregate 1000 users' behavior into a trust score for a business without anyone revealing individual data"

**Feasible: YES, but ZK alone is NOT the right tool. Hybrid approach needed.**

- **The problem:** ZK proofs prove *statements about data* — they don't *aggregate data across users*. To aggregate 1000 users' data, you need a computation environment that can combine inputs.
- **Recommended approach:**
  1. Each user generates a ZK proof that their contribution is valid (real person, real data, correct format).
  2. Contributions are aggregated using **TEE** (Nitro Enclave) or **secure aggregation** (MPC-lite).
  3. Output released with **differential privacy** noise.
- **Pure ZK approach (theoretical):** Each user proves their contribution, contributions are recursively composed. Axiom's Worldcoin batch aggregation does this. But at 1000 users, the recursive proving overhead is substantial.
- **Practical path:** ZK for input validation + TEE for aggregation + DP for output protection. This is what Google's Privacy Sandbox uses.

### Feasibility Summary

| Use Case | ZK Alone? | Proof Size | Generation Time | Ready Today? |
|----------|-----------|-----------|----------------|-------------|
| Prove ≥3 visits | ✅ Yes | ~192 bytes | 2-15s mobile | Yes |
| Prove ≥50 transactions | ✅ Yes | ~192-260 bytes | Seconds | Yes (zkTLS simplifies) |
| Prove score based on ≥20 experiences | ✅ Yes (simple) | ~192 bytes-1KB | Seconds | Yes for simple functions |
| Aggregate 1000 users | ❌ Hybrid needed | N/A | N/A | Yes (ZK + TEE + DP) |

---

## 3. Alternatives to ZK

### 3.1 Trusted Execution Environments (TEEs)

| TEE Platform | Status (2025-2026) | Performance Overhead | Best For |
|-------------|-------------------|---------------------|----------|
| **Intel SGX** | **Deprecated on consumer CPUs** (since 2021). Server-only (Xeon). | Low | Legacy server enclaves |
| **Intel TDX** | Production. 4th/5th Gen Xeon. GCP, Azure GA. | 3-5% CPU; up to 25% write-heavy I/O | Server-side confidential computing |
| **AWS Nitro Enclaves** | Production. All AWS regions (Oct 2025). No extra charge. | Near-native | AWS-native aggregation |
| **ARM CCA** | **No commercial silicon yet** (mid-2025). 1-2 years out. | TBD | Future mobile/edge TEE |
| **AMD SEV-SNP** | Production. GCP, Azure, Cisco, Lenovo. | Low | Alternative to TDX |

**TEE for behavioral data aggregation:** Trivially feasible. Near-native performance. 1000 users aggregated in milliseconds. This is what Google's Privacy Sandbox uses. Limitation: trust in hardware vendor. 43+ published TEE attacks exist, but most require physical access or host root.

### 3.2 Secure Multi-Party Computation (MPC)

- **Production deployments:** Partisia (healthcare, banking), Sharemind (government, finance), J.P. Morgan Kinexys PoC.
- **Showstopper for mobile users:** All parties must be online simultaneously. Communication overhead is prohibitive for 1000 mobile clients.
- **Works for:** 3-10 institutional parties (server-to-server). Cross-organization data pooling.
- **Not practical for:** Direct consumer participation from mobile devices.

### 3.3 Federated Learning (FL)

- **Google Gboard:** 30+ on-device language models, 7+ languages, 15+ countries. DP with ε = 0.994–13.69. First deployment of ε < 1 on user data.
- **Apple:** ~3B parameter on-device model. Private FL for app selection, news, emoji, health data.
- **For behavioral data:** Cross-device FL is the natural fit. Federated analytics (without ML) is simpler and directly applicable to "compute sum/average/histogram of behavioral data."
- **Libraries:** Flower (best general-purpose, framework-agnostic), TFF (TensorFlow), PySyft (PyTorch), FATE (enterprise).
- **Engineering cost:** 3-6 months for a 3-person team. Overkill for simple aggregation.

### 3.4 Differential Privacy (DP)

| Deployer | Epsilon Values | Scale | Architecture |
|----------|---------------|-------|-------------|
| **Apple** | 2-16/day (per-datum: ε=1-2; daily budget: ε=16) | Hundreds of millions | Local DP (on-device noise) |
| **Google** | Varies by application | ~3 billion devices | Local + shuffler model |

- **Key insight:** At ε≈2, deep learning models lose only ~4.7% accuracy. Pre-training on public data nearly eliminates the accuracy gap.
- **Local DP vs Central DP:** Local DP needs 100K+ users for useful signal. Central DP (trusted server) works with fewer users. Google's shuffler model is the hybrid.
- **For 1000 users:** Central DP is more practical. Local DP alone would be too noisy.

### 3.5 Fully Homomorphic Encryption (FHE)

| Operation | Overhead vs Plaintext | Source |
|-----------|----------------------|--------|
| Addition (SEAL) | 60,000-100,000x slower | Scientific Reports 2025 |
| Addition (HElib) | 1,600,000x slower | Scientific Reports 2025 |
| Multiplication (SEAL) | 15,000,000x slower | Scientific Reports 2025 |

- **GPU acceleration:** 100-2000x improvement (FIDESlib: 70x for bootstrapping on RTX 4090). Intel Heracles ASIC: 1,074-5,547x over Xeon.
- **SIMD batching saves FHE:** Pack 65,536 values per ciphertext. Summing 1000 encrypted integers = 1 operation = milliseconds. Practical for simple aggregation.
- **Not practical for:** Complex computation (sorting, comparisons, ML inference) on commodity hardware.
- **Trajectory:** Performance improving 8x/year. Commercially viable FHE accelerator expected Feb 2026 (Niobium + Samsung Foundry).
- **Bottom line:** FHE is viable for simple aggregation with SIMD batching. Not viable for general computation for 3-5 more years.

### 3.6 Honest Assessment: Best Approach for v1

| Approach | Privacy | Performance | Complexity | v1 Viable? |
|----------|---------|------------|-----------|-----------|
| **TEE (Nitro/TDX) + DP** | Good (hardware trust + mathematical noise) | Excellent (near-native) | Low | **✅ YES — Recommended** |
| **ZK proofs** | Excellent (cryptographic) | Moderate | High | ✅ For attestation, ❌ for aggregation |
| **Federated Analytics** | Good (data stays local) | Good | Medium-High | ⚠️ Maybe (needs client SDK) |
| **MPC** | Excellent (cryptographic) | Poor for mobile | Very High | ❌ Not for 1000 mobile users |
| **FHE** | Excellent (cryptographic) | Terrible on commodity HW | High | ❌ Not for v1 |

**Recommendation for a 3-engineer team building v1:**

```
Phase 1 (Months 1-3):  TEE (Nitro Enclave) + Central DP + Local DP on client
                        → This is what Google Privacy Sandbox uses
                        → Near-native performance, ~200 lines of crypto code
                        → No extra AWS cost beyond EC2

Phase 2 (Months 3-6):  Add ZK attestation for input validation
                        → Each user proves "I am real, my data is valid"
                        → Semaphore for identity, Circom for data proofs
                        → ZK validates; TEE aggregates

Phase 3 (Months 6-12): Add secure aggregation (MPC-lite)
                        → TEE sees only encrypted partial sums
                        → Removes need to trust TEE with individual data

Phase 4 (Year 2):      Federated analytics / learning
                        → On-device computation for complex analysis
                        → Flower framework
```

---

## 4. The Hybrid Architecture: "Crypto Under the Hood, Vipps-Feeling on the Surface"

### 4.1 Is This Architecturally Sound? YES.

Each component has proven precedents and they compose naturally:

```
User Device                        Server (AWS)
+----------------------------+    +---------------------------+
| 1. BankID login (identity) |    |   Nitro Enclave           |
| 2. Behavioral data on      |    | +-------------------------+|
|    device (transactions,   |    | | Attestable aggregation  ||
|    visits, ratings)        |    | | code (verifiable)       ||
| 3. ZK proof generation     |    | |                         ||
|    (proves validity)       | →  | | Input: ZK proofs +      ||
| 4. Local DP noise          |    | | noised contributions    ||
|    (defense in depth)      |    | |                         ||
| 5. Simple UI:              |    | | Output: aggregate stats ||
|    "Share your dining      |    | | + central DP noise      ||
|     history summary"       |    | +-------------------------+|
+----------------------------+    +---------------------------+
                                              ↓
                                  MCP Server / API
                                  "How trustworthy is
                                   restaurant X?"
```

### 4.2 Projects That Hide Crypto From Users Successfully

| Project | What Users See | What's Under the Hood | Scale |
|---------|---------------|----------------------|-------|
| **Zupass** | "Stamps" and "tickets" | ZK-SNARKs, Semaphore, PCDs | 10K+ users at Devcon |
| **ERC-4337 wallets** | Email login, no seed phrases | Account abstraction, smart contracts | 40M+ accounts |
| **World App** | "Verify your identity" button | ZKML, Semaphore, Groth16 | 12-16M users |
| **Privado ID** | "Share your age" | Iden3, Circom, W3C VCs with ZK | Enterprise POCs |
| **Apple Privacy** | Toggle "Share analytics" | Local DP, on-device ML | Billions of devices |

**UX principle:** Progressive disclosure. Users see "Share your purchase history summary." Power users can inspect "Generated zk-SNARK proof, ε=4 local DP applied."

### 4.3 Minimum Infrastructure for v1

1. **Identity:** BankID for auth (existing, trusted, 4.7M Norwegian users).
2. **Proof system:** Circom + snarkjs for ZK proofs. Semaphore V4 for anonymous group membership.
3. **Credential format:** W3C Verifiable Credentials with selective disclosure.
4. **Server:** AWS EC2 with Nitro Enclaves enabled. No extra cost.
5. **No wallet needed:** Users authenticate with BankID; if on-chain anchoring needed, use ERC-4337 account abstraction behind the scenes.
6. **No tokens, no gas fees visible to users.**

### 4.4 Failure Modes

| Failure Mode | Severity | Mitigation |
|-------------|---------|-----------|
| ZK proof too slow on mobile | High | Groth16 proofs take ~2-15s. Pre-compute. Server-side proving in TEE as fallback. |
| BankID integration limitations | Medium | Use BankID for auth only; ZK for data sharing. Stø AS (BankID) is innovation-friendly (sandbox participant). |
| TEE hardware vulnerabilities | Medium | Defense in depth: TEE + ZK + DP. No single point of failure. |
| User confusion about what they're sharing | High | UX problem, not crypto. Clear consent UI. Zupass proved it can work. |
| Key management for erasure | Medium | Functional erasure via key deletion (CNIL-endorsed approach). Need recovery mechanism. |

---

## 5. Regulatory Fit: GDPR + ZK

### 5.1 The Legal Opening (2025)

**CJEU ruling C-413/23 P (September 2025):** Pseudonymised data is NOT always personal data. If re-identification risk is "insignificant" (prohibited by law or impossible in practice), pseudonymised data may qualify as **anonymous**. For a ZK system where verifiers never access underlying data, this is exactly the right test.

**eIDAS 2.0 (Regulation EU 2024/1183):** Recital 14 explicitly mandates ZK proofs: "Member States should integrate different privacy-preserving technologies, such as zero knowledge proof, into the European Digital Identity Wallet." All Member States must issue compliant wallets by December 2026.

**INATBA Position Paper (updated August 2025):** ZKPs allow GDPR compliance through functional erasure (delete encryption keys = right to be forgotten), data minimization by mathematical guarantee, and on-chain verification without personal data exposure.

### 5.2 Classification for a ZK Behavioral Data System

| Component | GDPR Classification | Implication |
|-----------|-------------------|------------|
| ZK proof output (verified by third party) | Likely **anonymous** for the verifier (CJEU 2025 test) | GDPR may not apply to verifiers |
| Underlying behavioral data on user's device | **Personal data** | User is data controller of own data |
| On-chain anchors (hashes, commitments) | **Possibly personal data** (EDPB 02/2025) | Use salted/keyed hashes; enable key deletion |
| Aggregated statistics with DP | Likely **anonymous** (if ε is sufficiently small) | GDPR may not apply to aggregate outputs |

**Can this system EXCEED GDPR?** Yes. If data never leaves the user's device and only ZK proofs are shared:
- User = data subject AND data controller.
- Platform = at most a processor, arguably not even that if only verifying proofs.
- ZK proofs = the mathematical maximum of data minimization (Article 5(1)(c)).
- This is not just compliance; it's a structurally stronger privacy position than GDPR requires.

### 5.3 Norwegian Regulatory Context

**Datatilsynet Sandbox:** Operates joint sandbox with Finanstilsynet. The **SALT project** (2023-2025, exit report January 2025) with Stø/BankID explored homomorphic encryption for biometric data. Datatilsynet concluded encrypted biometric data is still likely special-category, but the tech could enable previously unacceptable architectures. **Applying to this sandbox with a ZK behavioral data sharing concept would be the natural next step.**

**BankID + GDPR:** BankID (Stø AS) applies data minimization. User holds encryption key. 901M transactions/year, 4.7M users. Uses TEE (Secure Enclave) for passkey auth. Innovation-friendly (sandbox participant).

**Nordic-Baltic eID Project:** Led by DigDir (Norway). Developing cross-border digital wallet certification. Goal: most digitally integrated region by 2030.

### 5.4 The Regulatory Strategy

1. **Apply to Datatilsynet's regulatory sandbox** — SALT project is direct precedent.
2. **Align with eIDAS 2.0 ARF specifications** — regulatory legitimacy + cross-border interoperability.
3. **Position as exceeding GDPR** — not "how do we comply?" but "we've made compliance architecturally inevitable."
4. **Use the CJEU ruling** — argue ZK proofs are anonymous data for verifiers (test: re-identification is "insignificant").

---

## 6. Synthesis: What's Practical vs Theoretical

### The "Could 3 Engineers Build This in 6 Months?" Test

| Component | Answer | Notes |
|-----------|--------|-------|
| ZK proof of visit/transaction validity | **YES** | Circom + snarkjs, well-documented. Or use zkTLS (Reclaim Protocol) for instant proofs from any HTTPS source. |
| Anonymous group membership | **YES** | Semaphore V4, production-ready. 192-byte proofs, seconds on mobile. |
| TEE-based aggregation | **YES** | AWS Nitro Enclave, no extra cost. 2-4 weeks of engineering. |
| Differential privacy layer | **YES** | Google's open-source libraries. ~50 lines of code per layer. |
| BankID integration | **YES** | Mature API. Standard OAuth/OIDC flow. |
| User-facing mobile app | **YES** | Standard mobile development. The ZK/TEE complexity is invisible to users. |
| Recursive proof aggregation at scale | **NO (v1)** | Axiom has done it for Worldcoin, but building custom recursive composition is not a 6-month task. |
| On-device federated learning | **NO (v1)** | 3-6 month investment. Not needed for simple aggregation. |
| FHE-based aggregation | **NO** | 60,000x+ overhead on commodity hardware. |

### What to Build (Honest Recommendation)

**v1 (6 months, 3 engineers):**
- TEE (Nitro Enclave) for aggregation + central DP
- Local DP on client devices
- Semaphore V4 for anonymous identity
- Simple ZK proofs for input validation (or zkTLS for instant proofs from bank APIs)
- BankID for authentication
- MCP server exposing aggregate trust data to AI
- Total privacy budget: ε ≈ 6 (Apple uses 2-16). With 1000 users and ε=6, aggregate trends are clear; per-category breakdowns will have meaningful noise.

**v2 (Year 2):**
- Custom ZK circuits for richer attestations
- Secure aggregation (TEE sees only encrypted partial sums)
- Federated analytics for on-device computation
- eIDAS 2.0 wallet integration
- Cross-border expansion (Denmark/Sweden via equivalent payment infrastructure)

**Never (until the field advances):**
- FHE for general computation (wait for hardware acceleration)
- MPC with 1000+ mobile clients (communication overhead)
- Rolling your own crypto primitives

---

*Sources: Groth16 benchmarks (alinush.github.io), ICICLE-Snark (Ingonyama), SP1 Hypercube (Succinct/The Block), RISC Zero R0VM 2.0, Semaphore V4 (semaphore.pse.dev), World ID (world.org), Privado ID, Zupass/PCD (pcd.team, pod.org), Anon Aadhaar (PSE/ETH Foundation), zkEmail (zk.email), ZKP2P/Reclaim Protocol, Aleph Zero WASM benchmarks, StarkWare S-two, AWS Nitro Enclaves, Google Privacy Sandbox TEE, Intel TDX (Azure/GCP), ARM CCA, MP-SPDZ, Sharemind, Google Federated Learning (Gboard DP-FL), Apple PFL 2025, Flower framework, Google Differential Privacy libraries, NIST SP 800-226, Zama TFHE-rs v1.1, Intel Heracles, FIDESlib, CJEU C-413/23 P (Sept 2025), INATBA ZKP Position Paper (Aug 2025), EDPB Guidelines 02/2025, eIDAS 2.0 (EU 2024/1183), Spain AEPD ZKP guidance, France CNIL functional erasure, Datatilsynet SALT project report (Jan 2025), BankID Norway, Nordic-Baltic eID Project, Harvard Data Cooperatives paper.*
