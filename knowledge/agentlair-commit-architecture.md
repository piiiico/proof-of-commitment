# AgentLair vs Commit — Architecture & Boundaries

_Established: 2026-04-02 (conversation with Håkon)_
_Status: Authoritative — this is the agreed architecture_
_Gist: https://gist.github.com/piiiico/c893fd4fb252b3dee37c25cab7839d43_

---

## Core Principle

AgentLair and Commit are **two separate products** with a narrow, well-defined integration point.

- **AgentLair** = agent infrastructure (identity, email, vault, pods, audit trail)
- **Commit** = trust protocol (commitment graph, trust computation, attestation format)

They are NOT the same product. They are NOT deeply coupled.

---

## 1. Identity — What lives where?

### AgentLair (owns agent identity)
- Agent registration
- Key management (Ed25519 keypairs)
- JWKS endpoint
- AAT issuance (JWT tokens)
- Pods (sub-identities)
- Agent metadata (name, capabilities)

**Questions AgentLair answers:**
- "Who is this agent?"
- "Is this token valid?"

### Commit (owns human/business identity + entity linking)
- BankID integration
- World ID integration
- Brønnøysund lookup
- eIDAS
- Entity linking: agent ↔ human, human ↔ business

**Questions Commit answers:**
- "Who is behind this agent?"
- "Is this a real person?"
- "Which business do they belong to?"

---

## 2. Trust — What lives where?

### AgentLair (produces raw data)
- Audit trail (Ed25519-signed, hash-chained)
- Stores what agents DO
- Exposes data via API
- **Does NOT compute trust. Does NOT say "this agent is trustworthy."**

### Commit (computes trust)
- Receives raw data from multiple sources:
  - AgentLair (agent behavior)
  - VWM (verified work)
  - Browser extension (visit/purchase patterns)
  - Public registries (Mattilsynet, Brønnøysund)
  - Payment data
- Weights by type:
  - Human action with skin in the game → heaviest
  - Agent linked to verified human → medium
  - Standalone agent → lightest
- Computes trust scores per entity
- Exposes Trust API: "What is the trust score of X?"

**Questions AgentLair answers:** "What has this agent done?"
**Questions Commit answers:** "Can I trust this entity?"

---

## 3. Integration Point

AgentLair is ONE data source into Commit — on par with VWM, browser extension, and public registries. Not more, not less.

The integration is:
1. AgentLair exposes audit data via API (already exists: `/v1/audit/attestations`)
2. A CAF adapter converts raw audit entries to Commit attestation format (designed, not built)
3. Commit ingests these alongside all other data sources
4. Commit computes trust — AgentLair has no role in this computation

---

## 4. What this means for adjacent projects

### VWM (Verified Work Market)
- VWM has its own internal trust score (5-axis, geometric mean) for marketplace operations. This is fine — it's operational scoring, not protocol trust.
- VWM emits raw attestations to Commit via CAF adapter. Commit computes cross-platform trust independently.
- VWM uses AgentLair AAT for agent identity. This is correct usage.

### PicoClaw
- PicoClaw audit trail logs to AgentLair (data producer). Correct.
- Agent is write-only to audit trail. Operator has read access. Agent gets read access only if operator grants it.
- Commit integration is a separate, later step.

### Entity Linking (agent ↔ human)
- Lives in Commit, not AgentLair.
- Not yet built. Phase 2/3.

---

## 5. Anti-patterns to avoid

- ❌ Building trust computation into AgentLair
- ❌ Treating AgentLair audit data as more important than other Commit data sources
- ❌ Blurring AgentLair's value prop with trust/commitment language
- ❌ Making Commit dependent on AgentLair (Commit should work with zero agent data)
