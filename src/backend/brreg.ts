/**
 * Brønnøysund Register Centre (Brreg) API client.
 *
 * Public data source for the cold start MVP: provides real commitment
 * signals (years operating, financial health, employee stability) without
 * needing any user-contributed data.
 *
 * APIs used:
 *   - Enhetsregisteret (entity register): https://data.brreg.no/enhetsregisteret/api/
 *   - Regnskapsregisteret (accounts register): https://data.brreg.no/regnskapsregisteret/
 *
 * Both are free, no auth required, CC BY 4.0 licensed.
 */

const ENTITY_BASE = "https://data.brreg.no/enhetsregisteret/api/enheter";
const ACCOUNTS_BASE = "https://data.brreg.no/regnskapsregisteret/regnskap";

// ── Types ────────────────────────────────────────────────────────────

export interface BrregEntity {
  organisasjonsnummer: string;
  navn: string;
  organisasjonsform?: { kode: string; beskrivelse: string };
  stiftelsesdato?: string; // YYYY-MM-DD
  registreringsdatoEnhetsregisteret?: string;
  antallAnsatte?: number;
  naeringskode1?: { kode: string; beskrivelse: string };
  naeringskode2?: { kode: string; beskrivelse: string };
  forretningsadresse?: {
    adresse?: string[];
    postnummer?: string;
    poststed?: string;
    kommune?: string;
  };
  konkurs: boolean;
  underAvvikling: boolean;
  underTvangsavviklingEllerTvangsopplosning: boolean;
  sisteInnsendteAarsregnskap?: string; // year
  vedtektsfestetFormaal?: string[];
}

export interface BrregAccounts {
  regnskapsperiode: { fraDato: string; tilDato: string };
  resultatregnskapResultat: {
    aarsresultat: number;
    ordinaertResultatFoerSkattekostnad: number;
    driftsresultat: {
      driftsresultat: number;
      driftsinntekter: { sumDriftsinntekter: number };
      driftskostnad: { sumDriftskostnad: number };
    };
  };
  egenkapitalGjeld: {
    sumEgenkapitalGjeld: number;
    egenkapital: { sumEgenkapital: number };
    gjeldOversikt: { sumGjeld: number };
  };
  eiendeler: { sumEiendeler: number };
}

export interface CommitmentProfile {
  orgNumber: string;
  name: string;
  // Temporal commitment
  foundedDate: string | null;
  yearsOperating: number | null;
  registeredDate: string | null;
  // Operational commitment
  employees: number | null;
  industry: string | null;
  industryCode: string | null;
  orgForm: string | null;
  location: string | null;
  // Status signals
  isBankrupt: boolean;
  isLiquidating: boolean;
  isActive: boolean;
  // Financial commitment (from latest accounts)
  financials: {
    period: string;
    revenue: number;
    operatingResult: number;
    netResult: number;
    equity: number;
    totalAssets: number;
    totalDebt: number;
    equityRatio: number; // equity / total assets
    profitMargin: number; // net result / revenue
  } | null;
  // Derived commitment scores (0-100)
  signals: {
    temporal: number; // based on years operating
    financial: number; // based on profitability + equity
    operational: number; // based on employees + active status
    overall: number; // weighted composite
  };
  // Human-readable summary
  summary: string;
}

// ── API calls ────────────────────────────────────────────────────────

const HEADERS = { Accept: "application/json" };

export async function searchEntities(
  query: string,
  size = 5
): Promise<BrregEntity[]> {
  const url = `${ENTITY_BASE}?navn=${encodeURIComponent(query)}&size=${size}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return [];

  const data = (await res.json()) as any;
  return data?._embedded?.enheter ?? [];
}

export async function getEntity(
  orgNumber: string
): Promise<BrregEntity | null> {
  const clean = orgNumber.replace(/\s/g, "");
  const res = await fetch(`${ENTITY_BASE}/${clean}`, { headers: HEADERS });
  if (!res.ok) return null;
  return (await res.json()) as BrregEntity;
}

export async function getAccounts(
  orgNumber: string
): Promise<BrregAccounts | null> {
  const clean = orgNumber.replace(/\s/g, "");
  const res = await fetch(`${ACCOUNTS_BASE}/${clean}`, { headers: HEADERS });
  if (!res.ok) return null;

  const data = await res.json();
  // API returns array; take first (most recent)
  const accounts = Array.isArray(data) ? data[0] : data;
  return accounts as BrregAccounts;
}

// ── Commitment profile builder ───────────────────────────────────────

function computeYearsOperating(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const founded = new Date(dateStr);
  const now = new Date();
  return Math.round(
    (now.getTime() - founded.getTime()) / (365.25 * 24 * 60 * 60 * 1000) * 10
  ) / 10;
}

function temporalScore(years: number | null): number {
  if (years === null) return 0;
  // 0-1 year: 10, 1-3: 30, 3-5: 50, 5-10: 70, 10-20: 85, 20+: 95
  if (years < 1) return 10;
  if (years < 3) return 30;
  if (years < 5) return 50;
  if (years < 10) return 70;
  if (years < 20) return 85;
  return 95;
}

function financialScore(
  equityRatio: number,
  profitMargin: number,
  netResult: number
): number {
  let score = 0;

  // Equity ratio: 0-10% = 10, 10-25% = 30, 25-40% = 60, 40%+ = 80
  if (equityRatio > 0.4) score += 40;
  else if (equityRatio > 0.25) score += 30;
  else if (equityRatio > 0.1) score += 15;
  else score += 5;

  // Profitability: negative = 0, 0-5% = 15, 5-10% = 25, 10%+ = 35
  if (profitMargin > 0.1) score += 35;
  else if (profitMargin > 0.05) score += 25;
  else if (profitMargin > 0) score += 15;
  else score += 0;

  // Positive net result bonus
  if (netResult > 0) score += 25;

  return Math.min(score, 100);
}

function operationalScore(
  employees: number | null,
  isActive: boolean
): number {
  if (!isActive) return 0;
  if (employees === null || employees === 0) return 30; // Active but unknown employees
  if (employees < 5) return 40;
  if (employees < 20) return 55;
  if (employees < 100) return 70;
  if (employees < 500) return 85;
  return 95;
}

export async function buildCommitmentProfile(
  orgNumber: string
): Promise<CommitmentProfile | null> {
  const entity = await getEntity(orgNumber);
  if (!entity) return null;

  const accounts = await getAccounts(orgNumber);

  const years = computeYearsOperating(entity.stiftelsesdato);
  const isActive =
    !entity.konkurs &&
    !entity.underAvvikling &&
    !entity.underTvangsavviklingEllerTvangsopplosning;

  let financials: CommitmentProfile["financials"] = null;
  let finScore = 0;

  if (accounts) {
    const revenue =
      accounts.resultatregnskapResultat?.driftsresultat?.driftsinntekter
        ?.sumDriftsinntekter ?? 0;
    const operatingResult =
      accounts.resultatregnskapResultat?.driftsresultat?.driftsresultat ?? 0;
    const netResult =
      accounts.resultatregnskapResultat?.aarsresultat ?? 0;
    const equity =
      accounts.egenkapitalGjeld?.egenkapital?.sumEgenkapital ?? 0;
    const totalAssets = accounts.eiendeler?.sumEiendeler ?? 0;
    const totalDebt = accounts.egenkapitalGjeld?.gjeldOversikt?.sumGjeld ?? 0;

    const equityRatio = totalAssets > 0 ? equity / totalAssets : 0;
    const profitMargin = revenue > 0 ? netResult / revenue : 0;

    financials = {
      period: `${accounts.regnskapsperiode.fraDato} to ${accounts.regnskapsperiode.tilDato}`,
      revenue,
      operatingResult,
      netResult,
      equity,
      totalAssets,
      totalDebt,
      equityRatio: Math.round(equityRatio * 1000) / 10,
      profitMargin: Math.round(profitMargin * 1000) / 10,
    };

    finScore = financialScore(equityRatio, profitMargin, netResult);
  }

  const tScore = temporalScore(years);
  const oScore = operationalScore(entity.antallAnsatte ?? null, isActive);

  // Weighted: temporal 30%, financial 40%, operational 30%
  const overall = Math.round(
    tScore * 0.3 + finScore * 0.4 + oScore * 0.3
  );

  const location = entity.forretningsadresse
    ? [entity.forretningsadresse.poststed, entity.forretningsadresse.kommune]
        .filter(Boolean)
        .join(", ")
    : null;

  // Build human-readable summary
  const parts: string[] = [];
  parts.push(`${entity.navn} (${entity.organisasjonsnummer})`);

  if (entity.organisasjonsform?.beskrivelse) {
    parts.push(`Type: ${entity.organisasjonsform.beskrivelse}`);
  }

  if (years !== null) {
    parts.push(
      `Operating for ${years} years (founded ${entity.stiftelsesdato})`
    );
  }

  if (entity.antallAnsatte !== undefined) {
    parts.push(`${entity.antallAnsatte} employees`);
  }

  if (entity.naeringskode1?.beskrivelse) {
    parts.push(`Industry: ${entity.naeringskode1.beskrivelse}`);
  }

  if (location) parts.push(`Location: ${location}`);

  if (!isActive) {
    if (entity.konkurs) parts.push("⚠️ BANKRUPT");
    if (entity.underAvvikling) parts.push("⚠️ UNDER LIQUIDATION");
    if (entity.underTvangsavviklingEllerTvangsopplosning)
      parts.push("⚠️ FORCED DISSOLUTION");
  }

  if (financials) {
    const fmtNOK = (n: number) => {
      if (Math.abs(n) >= 1_000_000)
        return `${(n / 1_000_000).toFixed(1)}M NOK`;
      if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K NOK`;
      return `${n} NOK`;
    };

    parts.push(`\nFinancial snapshot (${financials.period}):`);
    parts.push(`  Revenue: ${fmtNOK(financials.revenue)}`);
    parts.push(`  Net result: ${fmtNOK(financials.netResult)}`);
    parts.push(`  Equity: ${fmtNOK(financials.equity)}`);
    parts.push(`  Equity ratio: ${financials.equityRatio}%`);
    parts.push(`  Profit margin: ${financials.profitMargin}%`);
  }

  parts.push(`\nCommitment signals:`);
  parts.push(`  Temporal (longevity): ${tScore}/100`);
  parts.push(`  Financial (health): ${finScore}/100`);
  parts.push(`  Operational (activity): ${oScore}/100`);
  parts.push(`  Overall commitment: ${overall}/100`);

  return {
    orgNumber: entity.organisasjonsnummer,
    name: entity.navn,
    foundedDate: entity.stiftelsesdato ?? null,
    yearsOperating: years,
    registeredDate: entity.registreringsdatoEnhetsregisteret ?? null,
    employees: entity.antallAnsatte ?? null,
    industry: entity.naeringskode1?.beskrivelse ?? null,
    industryCode: entity.naeringskode1?.kode ?? null,
    orgForm: entity.organisasjonsform?.beskrivelse ?? null,
    location,
    isBankrupt: entity.konkurs,
    isLiquidating: entity.underAvvikling,
    isActive,
    financials,
    signals: {
      temporal: tScore,
      financial: finScore,
      operational: oScore,
      overall,
    },
    summary: parts.join("\n"),
  };
}

/**
 * Rank entities for relevance when searching by name.
 *
 * Brreg returns results in arbitrary order. For restaurant/business lookups
 * we want to surface the "real" company rather than a sole trader (ENK) with
 * a similar name or an inactive entity.  We score on signals available in the
 * entity search response (no extra API calls needed):
 *
 *  +20  Org form is AS or ASA (vs ENK which scores -20)
 *  +30  Primary industry is food service / restaurant (56.xxx)
 *  +15  Primary industry is accommodation (55.xxx) — adjacent sector
 *  +10  Has ≥ 1 reported employee
 *  +10  Has ≥ 5 reported employees (stacks with above)
 *  -50  Bankrupt / under liquidation / forced dissolution
 *
 * Higher score = should appear first.
 */
function scoreEntity(entity: BrregEntity): number {
  let score = 0;

  // Organisation form
  const orgKode = entity.organisasjonsform?.kode?.toUpperCase() ?? "";
  if (orgKode === "AS" || orgKode === "ASA") score += 20;
  else if (orgKode === "ENK") score -= 20;

  // Industry — prefer restaurant/food service (56.xxx) and accommodation (55.xxx)
  // 56.10x / 56.110: Restaurants — highest priority for food lookups
  // 56.2xx: Catering — still food industry but secondary
  // 55.xxx: Accommodation (often includes food service)
  const nkKode = entity.naeringskode1?.kode ?? "";
  if (nkKode.startsWith("56.1")) score += 35; // Restaurants specifically
  else if (nkKode.startsWith("56")) score += 28; // Other food service (catering, bars)
  else if (nkKode.startsWith("55")) score += 15; // Accommodation

  // Employee count — stacking bonuses so more employees rank higher
  const emp = entity.antallAnsatte ?? 0;
  if (emp >= 1) score += 10;
  if (emp >= 5) score += 10;
  if (emp >= 10) score += 5;
  if (emp >= 20) score += 5;

  // Penalise inactive entities
  if (
    entity.konkurs ||
    entity.underAvvikling ||
    entity.underTvangsavviklingEllerTvangsopplosning
  ) {
    score -= 50;
  }

  return score;
}

export async function searchAndProfile(
  query: string,
  maxResults = 3
): Promise<CommitmentProfile[]> {
  // Fetch a larger pool so we can re-rank before building full profiles.
  // Brreg results can have the best match at position 10-15 when a sole trader
  // (ENK) with a similar name appears first.  Fetch up to 20 to capture those.
  const poolSize = Math.min(Math.max(maxResults * 5, 10), 20);
  const entities = await searchEntities(query, poolSize);

  // Re-rank by our relevance heuristic, then take the top maxResults.
  const ranked = [...entities].sort(
    (a, b) => scoreEntity(b) - scoreEntity(a)
  );
  const selected = ranked.slice(0, maxResults);

  const profiles: CommitmentProfile[] = [];
  for (const entity of selected) {
    const profile = await buildCommitmentProfile(
      entity.organisasjonsnummer
    );
    if (profile) profiles.push(profile);
  }

  return profiles;
}
