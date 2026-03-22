# PageRank 2026: The User's Trust Journey in AI-First Discovery

*Deep research from the END USER's perspective. Created 2026-03-21. Not infrastructure, not business — a human with a need.*

---

## The Setup

A person needs a dentist. A restaurant for tonight. Headphones. An emergency plumber. A therapist. These are not edge cases — they are the five most common categories of "I need something and I'm going to ask the internet."

In 2026, 45% of consumers use AI for local recommendations (up from 6% in 2025). The shift is happening faster than anyone expected. But what does the human actually experience? What do they see, what do they trust, and what goes wrong?

This document traces five real user journeys through AI, documents the trust deficit, maps the adversarial dynamics, identifies non-obvious trust mechanisms, and proposes the smallest useful thing someone could build.

---

## 1. FIVE USER JOURNEYS: WHAT AI ACTUALLY SHOWS YOU

### Journey 1: "I need a dentist"

**What you see on ChatGPT:** You type "best dentist near me." ChatGPT asks your city, then returns a paragraph naming 3-5 practices. Each gets a brief description: "known for cosmetic dentistry and sedation options." No map. No phone numbers. No hours. No insurance information. No appointment booking. The tone is confident regardless of accuracy.

70%+ of ChatGPT's local results come from Foursquare — a consumer app that shut down in 2025. Yelp, Facebook, and Google Maps are absent as sources. "Three Best Rated" (a paid directory) is the most prevalent directory source at 24%.

**What you see on Perplexity:** Richer — embedded map, Yelp photos, star ratings, review excerpts, source citations. This is closer to useful.

**What you see on Google AI Overviews:** Nothing. Google has *removed* AI Overviews entirely from healthcare provider queries ("dentist near me") as of December 2025. You get the traditional local 3-pack with verified ratings, hours, phone. Google decided AI summaries were inappropriate for these queries.

**What's missing everywhere:**
- No platform checks whether the dentist is actually **licensed**
- No platform knows your **insurance**
- No platform shows **real-time availability**
- No verification the practice is **still open**
- Business profile accuracy on ChatGPT/Perplexity is **~68%** (SOCi 2026, 350K locations). 1 in 3 recommended businesses may have incorrect addresses, phone numbers, or hours.

**The user's actual behavior:** 59% of AI users still check review profiles afterward. Only 23% rely solely on the AI summary.

### Journey 2: "Where should I eat tonight?"

**What you see on ChatGPT:** A list of 5-8 restaurants with names, cuisine, neighborhood, price range, and a brief pitch. No map. No photos. No live hours. No booking. Fluent and confident text regardless of accuracy.

**What you see on Perplexity:** The best restaurant experience of any AI — embedded map, Yelp photos, star ratings, review excerpts with quoted text, and OpenTable reservation slots with a "Reserve" button. Users can book without leaving Perplexity. Works across 60,000+ restaurants.

**What goes wrong — specific documented cases:**

Ryan Sutton (The Lo Times, October 2024) tested ChatGPT on NYC restaurant recommendations. Results:

| Failure | Example |
|---|---|
| Recommended closed restaurants | Momofuku Ko, Del Posto, The NoMad Bar, original Contra |
| Fabricated entire restaurants | "Carla's Cuban Kitchen" — does not exist |
| Invented menu items | Atla: "fluffy egg tacos, horchata soft serve" — confirmed never served |
| Wrong Michelin stars | Brooklyn Fare: ChatGPT said 3 stars — it has none |
| Wrong location | Rezdora: listed as Brooklyn — it's in Flatiron |
| False chef associations | Said Mario Batali runs Esca — he departed years ago |
| When pressed | ChatGPT admitted: "my recommendations are a reflection of typical Cuban dishes that would be found at a restaurant like Guantanamera" — i.e., it made things up |

**The Stefanina's disaster (August 2025):** Google AI Overviews fabricated specific deals for a Wentzville, Missouri pizza restaurant: "buy one get one free pizza," "half-off pasta nights." None existed. Angry customers yelled at staff demanding the fake specials. The restaurant posted on Facebook: "Please do not use Google AI to find out our specials... Google AI is not accurate."

**83% of restaurants are invisible on ChatGPT** vs. 14% on Google (Local Falcon, 189K results). Only 1.2% of locations are recommended by ChatGPT vs. 35.9% in Google's local 3-pack. ChatGPT favors businesses with 4.5+ stars and high review volume — a good local restaurant with a 4.0 and 50 reviews is likely invisible.

### Journey 3: "Best noise-canceling headphones under $400"

**What you see on ChatGPT Shopping (launched Nov 2025, 50M daily shopping queries):**
1. A clarifying quiz: budget? use case? wired/wireless?
2. Product carousel: 4-12 cards with images, prices, star ratings, AI labels ("Top Pick," "Best Value")
3. "Why you might like this" explanations, review snippets from Reddit/Amazon/Wirecutter
4. Instant Checkout via Stripe — buy without leaving ChatGPT (Walmart, Target, Shopify merchants)
5. A swipe interface (right = like, left = pass) that refines recommendations

**What's missing:**
- **No Amazon products.** Amazon blocked OpenAI crawlers. 40% of US e-commerce is invisible.
- **64% accuracy rate** — 1 in 3 recommendations doesn't match user needs (Dataslayer)
- **83% of carousel products are sourced from Google Shopping** organic results (Search Engine Land)
- No warranty or return policy information
- May show only one color variant

**The affiliate disruption:** ChatGPT synthesizes content from review sites (Wirecutter, RTINGS) without users clicking through, cutting off affiliate revenue. OpenAI said they'll "experiment" with compensation but gave no specifics. A single Reddit thread discussing your product now carries more weight than meticulously optimized product pages.

### Journey 4: "I need a plumber — my pipe burst"

**What you see on ChatGPT:** An advisory paragraph. Nine methods to find a plumber (Google Maps, Yelp, Angie's List...). Advice to "contact multiple plumbers." General price ranges. When given a specific city, it may name 3-5 businesses — favoring national franchises (Roto-Rooter) over local independents.

**What you DON'T see:** No phone number to call. No availability status. No "call now" button. No map. No estimated arrival time. No verification the business answers its phone.

**The platform fragmentation problem:** A marketing firm tested "best AC repair near me in Arlington TX" across four AI platforms. Result: **not a single contractor appeared in more than one tool's recommendations.** Zero overlap. Complete fragmentation.

| Platform | Data Sources | Bias |
|---|---|---|
| ChatGPT | Angi, Yelp, BBB | National franchises |
| Perplexity | Local company websites (14+) | Well-built websites |
| Gemini | Facebook, Nextdoor | Community-mentioned |

**The real-world gap:** In an emergency, you need three things: (1) a phone number, (2) confirmation they answer, (3) availability today. AI provides none. You get a well-written paragraph, then go to Google Maps anyway.

### Journey 5: "I need a divorce lawyer"

**What you see on ChatGPT:** It names specific firms and applies evaluation. Unlike Google's list where you choose, ChatGPT synthesizes and recommends. That recommendation carries implicit authority — the user didn't ask for ten options; they received an endorsement.

**What's catastrophically missing:**

| Missing Signal | Why It Matters |
|---|---|
| License verification | No AI checks bar admission or valid license |
| Disciplinary record | No screening for malpractice, complaints, suspensions |
| Malpractice insurance | Not verified |
| Conflict of interest | Not screened |
| Confidentiality | ChatGPT conversations can be subpoenaed. Sam Altman acknowledged: "If you talk to a therapist or a lawyer... there's legal privilege. We haven't figured that out yet." |

**The hallucination epidemic in legal:** 600+ documented cases of lawyers citing AI-fabricated legal authority nationwide. Rate: 2-3 cases per day. In *Mata v. Avianca*, ChatGPT fabricated 6 legal cases with fake citations and fake quotes. When asked to verify, it doubled down: "I found the case does indeed exist on Westlaw and LexisNexis." It did not exist.

**The therapist trust paradox:** University of Southampton found non-experts trust ChatGPT legal advice **more than real lawyers**, even when told the source. Participants could distinguish AI from lawyer advice at 0.59 — barely above coin flip (0.50). Brown University identified 15 ethical risks in AI therapy, including "deceptive empathy" (phrases like "I see you" without comprehension).

---

## 2. THE TRUST DEFICIT: What Users Lose and Gain

### What You Lose

**The ability to evaluate sources.** For two decades, Google's 10-blue-links trained users in information literacy by design. You learned to read URLs (.gov vs .com), scan snippets, triangulate across sources. AI eliminates all these cues. You get one synthesized answer. You cannot see what the AI chose not to include.

**The ability to compare.** Google shows you 10 options and you choose. ChatGPT shows you one answer and you accept. This is not a design flaw — it's the product.

**Serendipity and discovery.** The interesting link you'd never have clicked, the unexpected result that changed your search — these disappear when AI pre-digests everything.

**Source diversity.** "Answer Bubbles" (arXiv, March 2026): identical queries on different AI platforms draw from largely non-overlapping source pools (only 24-25% overlap). SearchGPT gets 27.3% from encyclopedic sources; Google gets 10%. Two users asking the same question on different platforms inhabit different information realities — and neither can detect it.

**Calibrated uncertainty.** AI search reduces hedging language by up to 60% while preserving confidence markers. The AI doesn't just give you one answer — it makes uncertain claims sound more certain than the underlying sources warrant. The researchers call this "selective epistemic attenuation."

### What You Gain

**Speed.** AI halves time-on-task for information gathering.

**Natural language.** "Quiet Thai place in Brooklyn with outdoor seating and vegetarian options" works as a query. That's genuinely useful.

**Synthesis across sources.** The AI reads 50 pages and summarizes. For a non-expert, this is transformative.

**Accessibility.** Non-experts get access to professional-level information synthesis. The equalizing effect on novices is real.

**Multi-step reasoning.** "I'm allergic to latex and need dental work — which practices use non-latex gloves?" is a query AI can handle and Google cannot.

### The Numbers That Matter

| Finding | Stat | Source |
|---|---|---|
| People who don't check AI answers | 92% | Exploding Topics/Inc |
| Employees using AI without evaluating accuracy | 66% | KPMG (48K people, 47 countries) |
| Americans who trust AI "a lot" | 5% | YouGov |
| Americans more concerned than excited about AI | 50% | Pew (5K people) |
| AI-answered queries with zero clicks to sources | 80% | arXiv 2026 |
| Users who saw AI summary and clicked a source | ~1% | Pew 2025 |
| Users who say citations boost trust | 65.9% | Digital Third Coast |
| Users who actually click citations | 27% | Digital Third Coast |
| Fabricated citations that still boost trust | Yes | arXiv 2026 |

**The three-layer paradox:**
1. **Stated trust is low** — only 5-46% trust AI depending on the survey
2. **Behavioral trust is high** — 66% use without evaluating, 92% don't check
3. **Verification is structurally discouraged** — the whole value prop is "we did the work so you don't have to"

People are behaviorally dependent on AI, attitudinally skeptical of it, and structurally unable to verify it. That combination is the trust deficit at its most precise.

---

## 3. ADVERSARIAL DYNAMICS: How AEO Will Corrupt AI Recommendations

### The Parallel to Early SEO

We know AEO optimization will corrupt AI recommendations because we do it ourselves. Synlig Digital helps businesses get cited by AI. That's legitimate now — just as early SEO was legitimate. But the same dynamics apply:

1. **First movers get organic advantage** (where we are now)
2. **Tools automate optimization** (already happening)
3. **Bad actors game the system** (already happening)
4. **Platforms fight back with algorithm changes** (beginning)
5. **Arms race becomes permanent** (inevitable)

### What's Already Happening

**Content poisoning at the CDN layer:** Tools like Scrunch serve entirely different content to AI crawlers than to human visitors. This is invisible and undetectable to end users.

**AI memory manipulation:** Microsoft documented 31 legitimate businesses actively poisoning AI memory (persistent instructions injected via prompt injection) in a 60-day window. This is not hypothetical. It is production-scale manipulation.

**Citation gaming:** ChatGPT's citation patterns are volatile — Reddit went from ~60% of citations to ~10% in one month. Same query returns same brand list less than 1% of the time. This volatility creates an optimization surface that's being actively exploited.

### Can Users Tell the Difference?

**No.** There is currently no mechanism — technical, regulatory, or social — that allows an end user to distinguish between:
- A recommendation the AI made because it genuinely found the business credible
- A recommendation the AI made because the business optimized its content for AI crawlers
- A recommendation the AI made because someone injected prompt instructions into its context
- A recommendation the AI hallucinated entirely

All four look identical to the user. Same confident tone. Same format.

### The Regulation Gap

**There is no "ad label" for AI recommendations.** No regulator has established requirements for AI platforms to disclose when recommendations are influenced by optimization, data poisoning, or commercial relationships.

**Perplexity tried and retreated.** They implemented labeled, separated, clearly-marked sponsored answers — the most honest possible implementation of AI advertising. They still concluded that even the *existence* of advertising made users doubt everything else. If the most careful implementation of AI ads failed the trust test, the implication for less careful implementations is clear. (Perplexity pivoted to subscription-only in February 2026.)

**EU AI Act:** Classifies recommendation systems as "limited risk" requiring transparency obligations — but the implementing regulations are still being finalized. The Digital Services Act (DSA) requires algorithmic transparency for "very large platforms" (45M+ EU users), but enforcement for AI-native platforms is untested.

**FTC:** Expected to issue a policy statement on AI recommendations in 2026. Early signals suggest a light touch. The Rytr enforcement (FTC sued an AI writing tool for generating fake reviews) is the only direct action to date.

**Liability for bad AI recommendations:** No clear legal framework. If ChatGPT recommends a dentist who harms you, neither OpenAI nor the dentist is liable for the recommendation itself under current law. Section 230 protections likely apply to AI platforms, though this is untested.

### The User's Future

The user will face the same information environment that Google created, but worse:
- In Google, you could at least see 10 results and develop skepticism about rankings
- In AI, you see one confident answer with no visible ranking system to question
- The optimization and manipulation are invisible by design
- The platforms have no economic incentive to make them visible

---

## 4. NON-OBVIOUS TRUST MECHANISMS

### Beyond Reviews and Ratings

Traditional trust signals (star ratings, review count, badges) are being gamed to death. What mechanisms could actually work for AI-mediated discovery?

### Mechanism 1: Social Proof from Personal Network

**"3 friends ate here last month"** is the strongest trust signal that exists. 92% of consumers trust peer recommendations over advertising.

**What works:** Spotify wraps your friends' listening into discovery. Airbnb (2025) added "Who's Going" and "Connections" features for Experiences. Booking.com says "friends' reviews" is the most influential trust factor.

**What failed:** Netflix tried social recommendations (2004-2010) and abandoned them. Raw social graph without relationship-strength weighting doesn't work. Research consensus: the *trust relationship* matters more than the *social relationship* — your financial advisor's restaurant opinion matters less than your foodie friend's, even though you "know" the advisor better.

**Privacy-preserving version:** ZK proofs can verify "someone in your contact list visited this business 5+ times" without revealing who. Technically feasible today. Nobody builds it because the incentive structure doesn't exist yet — the platform that has your friend data (Meta, Google) has no reason to share it with AI recommendation systems.

### Mechanism 2: Revealed Preference Over Stated Preference

**Repeat purchases are the strongest trust signal that nobody uses.** A person who goes back to the same restaurant 12 times in a year is providing more reliable trust data than 100 five-star reviews. You can fake a review in 30 seconds. You cannot fabricate a year of consistent purchasing behavior.

**What exists:**
- PSD2 transaction data shows repeated merchant transactions (derivable as repeat visits)
- Amazon added a "Frequently Returned Item" badge — the *only* existing implementation of surfacing negative implicit feedback to consumers
- Google Popular Times shows foot traffic patterns (but aggregated, not individual)

**What doesn't exist:** No system connects "AI recommended this" → "user went there" → "user came back" → feeds into AI trust score. This is the missing feedback loop.

### Mechanism 3: AI Recommendation Insurance

**This already exists.** Munich Re's aiSure has been backing AI predictions with financial guarantees since 2018. EUR 15M coverage, model-agnostic underwriting, parametric-style claims.

The consumer extension: **"We're so confident in this recommendation that we'll refund you if it doesn't work out."** This flips the trust problem from "should I believe this AI?" to "is someone willing to bet money on it?"

Nobody does this for consumer AI recommendations yet. The extension from enterprise B2B to consumer is a UX and pricing challenge, not a conceptual one.

### Mechanism 4: Expert Attestation, Not Expert Authority

The Michelin Guide model: paid experts with skin in the game, whose reputation depends on accuracy over time. This works because the expert is identifiable, accountable, and evaluable.

**For AI:** Community-curated lists (Wirecutter for products, local food bloggers for restaurants) that AI explicitly references as sources. The AI's recommendation becomes traceable to a human expert whose track record is evaluable.

**What's different from current citations:** Current AI citations are anonymous and volatile. Expert attestation would mean the AI says "this recommendation is based on [named expert]'s evaluation, and [named expert] has been accurate 87% of the time." Accountability over anonymity.

### Mechanism 5: Prediction Markets for Quality

Nobody has created "will this restaurant still be good in 6 months?" markets despite Polymarket and Manifold making it trivial. MIT/General Mills research suggests short-term prediction markets aren't more accurate than conventional methods, but the mechanism could work differently for quality *persistence* questions — which is what a user actually cares about.

### Mechanism 6: Calibrated Confidence Expression

Instead of one confident answer, show the AI's actual uncertainty: "I'm confident about this recommendation (cited by 4 sources, consistent reviews)" vs. "I'm guessing here (limited data, no recent reviews)."

Research shows this works — but only with progressive disclosure (simple signal first, detail on demand). The transparency paradox: too much explanation *decreases* trust. The optimal signal is "87% of verified users were satisfied" — simple, verifiable, outcome-based.

### Mechanism Ranking

| Mechanism | Impact | Feasibility | Data Exists | User Understands | Gaming Resistance |
|---|---|---|---|---|---|
| Repeat visit/purchase data | ★★★★★ | ★★★ | Yes (PSD2) | Yes | High |
| Social proof (friends) | ★★★★★ | ★★ | Locked in platforms | Yes | Medium |
| Calibrated confidence | ★★★★ | ★★★★ | Derivable | Yes | Medium |
| Expert attestation | ★★★★ | ★★★ | Partial | Yes | Medium |
| AI recommendation insurance | ★★★★ | ★★ | No | Yes | High |
| Return rate surfacing | ★★★ | ★★★ | Locked in merchants | Yes | High |
| Prediction markets | ★★ | ★★ | No | Low | High |

---

## 5. THE GARAGE VERSION

### What's the smallest thing you could build that would be genuinely useful to an end user?

**Not** a browser extension (requires installation, privacy concerns, Chrome Web Store approval).
**Not** PSD2 integration (requires AISP license, months of compliance work).
**Not** a social network (cold start problem kills you).

### The Recommendation Receipt

**Concept:** A simple web app where you record what AI recommended and whether it worked out.

```
AI told me to go to [Restaurant X] → I went → ★★★★ It was great
AI told me to buy [Product Y] → I bought it → ★★ It broke after 2 weeks
AI told me to call [Plumber Z] → Never answered the phone → ★ Useless
```

**Why this works:**
1. **Zero dependencies.** No APIs, no licenses, no platform cooperation needed. A database and a form.
2. **Novel data.** Nobody tracks "did the AI recommendation actually work?" This data doesn't exist anywhere.
3. **Immediately useful.** Even with 100 users, you have signal: "ChatGPT recommends Restaurant X for Italian food, but 3/5 people who followed that recommendation said the food was mediocre."
4. **Anti-gaming.** You're rating the recommendation, not the business. The business can't optimize for this — they don't control what AI says about them.
5. **AI-consumable.** Expose via MCP server or simple API. AI models can query: "When you recommended Restaurant X to users, how did it work out?" This creates the feedback loop that doesn't exist.

**MVP scope:**
- Landing page: "Track your AI recommendations"
- Simple form: What did AI recommend? Did you follow it? How did it go?
- Public aggregate page per business: "AI recommended this business 47 times. 31 people followed through. Average satisfaction: 3.8/5"
- Optional: specify which AI platform made the recommendation (ChatGPT, Perplexity, Gemini, Claude)

**What this becomes:** The first dataset mapping AI recommendation accuracy from the user's perspective. The smallest version of the feedback loop — not verified transactions, not PSD2 data, just humans reporting "did this work out?" After the first 1,000 entries, you have genuinely novel data that no one else has. After 10,000, you have a product.

**Revenue path:** Free for consumers. Sell aggregate data to:
- Businesses ("Here's how AI recommendations are working for you vs. competitors")
- AI companies ("Here's where your recommendations succeed and fail by category")
- Agencies/consultants ("Here's citation-to-outcome data for your clients")

### What This Is NOT

This is not the trust protocol. This is not the reciprocal behavioral data network. This is not the next Google.

This is a Chrome-extension-free, API-free, license-free way to start collecting the one dataset nobody has: **did the AI recommendation actually work for the human who followed it?**

Everything else — PSD2 integration, ZK proofs, BankID verification, community curation — is a future layer that becomes useful once you've proven the core question matters.

---

## 6. SYNTHESIS: The User's Trust Journey in 2026

### The Current State (March 2026)

A human with a need opens ChatGPT or Perplexity. They get a confident, well-written answer that is:
- **Accurate about 64-68% of the time** for local businesses
- **Drawing from a narrow, opaque source pool** (Foursquare, not Google Maps; no Amazon for products)
- **Presenting uncertain information with inflated confidence** (hedging language reduced 60%)
- **Completely unverifiable** from within the AI interface (80% zero-click rate)
- **Vulnerable to invisible manipulation** (content cloaking, AI memory poisoning, AEO optimization)
- **Unregulated** (no disclosure requirements, no liability framework, no "ad label")

The user is told they're getting a "smart answer." What they're actually getting is a confident summary of incomplete data from opaque sources, with no mechanism to evaluate quality, verify accuracy, or detect manipulation.

### The Trajectory

This will get worse before it gets better. AEO optimization is accelerating. Content cloaking tools already exist. AI models are training on AI-generated content. The feedback loop between "AI recommends businesses that optimize for AI" and "businesses optimize harder for AI" is the same loop that turned Google into an ad platform. The difference: Google at least showed you 10 results. AI shows you one.

### What Would Make It Better

From the user's perspective, they need three things:

1. **Outcome data:** "When AI recommended this before, did it work out?" Not reviews. Not ratings. Actual follow-through results.

2. **Calibrated honesty:** "I'm confident about this" vs. "I'm guessing — you should verify." AI platforms have no incentive to do this because uncertainty reduces engagement.

3. **Source accountability:** "This recommendation is based on [source]. [Source]'s track record is [X]." Not anonymous citations. Traceable, evaluable provenance.

None of these exist today. All of them are buildable. The question is who builds them — the platforms (no incentive), regulators (too slow), or someone outside both systems.

---

## Sources

### AI Local Search Accuracy
- SOCi 2026 AI Local Visibility Report (350K locations, 3.2M queries): searchengineland.com
- BrightLocal 2026 Local Consumer Survey (1,002 consumers): brightlocal.com
- Local Falcon Restaurant Visibility Study (189K results): localfalcon.com
- MarketingCode AI Platform Fragmentation Test: marketingcode.com

### User Trust Research
- KPMG/UQ/UMelb "Trust, Attitudes and Use of AI" 2025 (48K people, 47 countries): kpmg.com
- Pew Research "How Americans View AI" (5K adults, Sept 2025): pewresearch.org
- Edelman Trust Barometer Flash Poll on AI (Nov 2025): edelman.com
- Stack Overflow Developer AI Trust (Feb 2026): stackoverflow.blog
- Exploding Topics via Inc (Sept 2025) — 92% verification rate: inc.com

### Answer Bubbles / AI Search Impact
- "Answer Bubbles: Information Exposure in AI-Mediated Search" (11K queries, arXiv March 2026): arxiv.org/html/2603.16138
- "The Rise of AI Search" (arXiv Feb 2026): arxiv.org/html/2602.13415
- Seer Interactive AI Overview CTR Study (Sept 2025): seerinteractive.com

### AI Recommendation Failures
- Ryan Sutton restaurant investigation (Oct 2024): thelotimes.com
- Stefanina's Google AI fabricated specials (Aug 2025): futurism.com, fox2now.com
- Mata v. Avianca fabricated legal citations (SDNY 2023)
- 600+ AI legal hallucination cases: Jones Walker AI Law Blog
- JAMA Pediatrics ChatGPT diagnostic errors (83% error rate, 2024)
- NPR medical AI accuracy (March 2026): npr.org

### Anchoring & Automation Bias
- "Trust and reliance on AI" (Computers in Human Behavior, 2024): sciencedirect.com
- "Anchoring bias in LLMs" (J Computational Social Science, Dec 2025): springer.com
- "Mitigating Anchoring Bias in Social Work Research" (JSWVE, Aug 2025): jswve.org
- AI & Society systematic review on automation bias (2025): springer.com

### Regulation
- EU AI Act transparency requirements: digital-strategy.ec.europa.eu
- FTC Rytr enforcement action: ftc.gov
- Perplexity ad experiment and retreat (Feb 2026): multiple sources
- Microsoft AI memory poisoning report: microsoft.com/security

### Novel Trust Mechanisms
- Munich Re aiSure (AI recommendation insurance): munichre.com
- Amazon "Frequently Returned Item" badge: amazon.com
- Netflix social recommendation failure (2004-2010): multiple sources
- MIT/General Mills prediction market research: mit.edu

### Platform-Specific
- ChatGPT Shopping (50M daily queries, Nov 2025): openai.com
- Perplexity + Yelp Fusion + OpenTable integrations: perplexity.ai
- Google AI Overviews healthcare query removal (Dec 2025): searchengineland.com

---

*This document is task #2 of the PageRank 2026 research series. It feeds back into the master strategy document at `/workspace/memory/knowledge/strategy/pagerank-2026-concept.md`. The user journey perspective complements the outcome data inventory (task #1) and the verification mechanisms research (task #3, pending).*
