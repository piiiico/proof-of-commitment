/**
 * Provenance history — window-free "did this package STOP shipping provenance?"
 *
 * PyPI (since 2025-11-06) shows Loss/Change only against an attested release made
 * in the preceding 14 days (warehouse PROVENANCE_COMPARISON_WINDOW_DAYS = 14). After
 * that, a project that stopped attesting reads plain "No provenance", the same as a
 * project that never attested. npm shows nothing per-history unless pnpm
 * `trustPolicy: no-downgrade` is on. This module computes the window-free view from
 * per-release states, so an agent sees both: the full history AND what PyPI itself
 * would warn about.
 *
 * Informational only — no score impact. A stop is usually a legitimate CI change.
 */

export type ProvenanceState = "full" | "none" | "incomplete";

export interface ReleaseProvenance {
  version: string;
  publishedAt: number; // ms epoch (first upload of the release)
  state: ProvenanceState;
}

export interface ProvenanceHistory {
  /** State of the latest stable release (what the registry project page shows). */
  latestVersion: string | null;
  latestState: ProvenanceState | null;
  /** Most recently published release with at least one attested file. */
  lastAttestedVersion: string | null;
  lastAttestedAt: string | null; // ISO
  /** Releases published after lastAttestedAt with no provenance at all. */
  releasesSinceWithoutProvenance: number;
  /** PyPI's own 14-day rule applied to the latest release (null for npm). */
  pypiWouldWarn: boolean | null;
}

export const PYPI_COMPARISON_WINDOW_DAYS = 14;
const DAY_MS = 24 * 3600 * 1000;

export function computeProvenanceHistory(
  releases: ReleaseProvenance[],
  latestVersion: string | null,
  opts: { pypiWindow: boolean }
): ProvenanceHistory {
  const latest = latestVersion
    ? releases.find((r) => r.version === latestVersion) ?? null
    : null;

  let lastAttested: ReleaseProvenance | null = null;
  for (const r of releases) {
    if (r.state === "none") continue;
    if (!lastAttested || r.publishedAt > lastAttested.publishedAt) lastAttested = r;
  }

  const releasesSinceWithoutProvenance = lastAttested
    ? releases.filter((r) => r.state === "none" && r.publishedAt > lastAttested!.publishedAt).length
    : 0;

  let pypiWouldWarn: boolean | null = null;
  if (opts.pypiWindow) {
    pypiWouldWarn = false;
    if (latest && latest.state === "none") {
      const from = latest.publishedAt - PYPI_COMPARISON_WINDOW_DAYS * DAY_MS;
      pypiWouldWarn = releases.some(
        (r) => r.state !== "none" && r.publishedAt < latest.publishedAt && r.publishedAt >= from
      );
    }
  }

  return {
    latestVersion: latest?.version ?? latestVersion,
    latestState: latest?.state ?? null,
    lastAttestedVersion: lastAttested?.version ?? null,
    lastAttestedAt: lastAttested ? new Date(lastAttested.publishedAt).toISOString() : null,
    releasesSinceWithoutProvenance,
    pypiWouldWarn,
  };
}

/** Neutral informational flag; null when there is no stop to report. */
export function provenanceStoppedFlag(h: ProvenanceHistory | null | undefined): string | null {
  if (!h || !h.lastAttestedVersion || h.latestState !== "none" || h.releasesSinceWithoutProvenance < 1) return null;
  const date = (h.lastAttestedAt ?? "").slice(0, 10);
  const n = h.releasesSinceWithoutProvenance;
  return `INFO: provenance stopped: attested until ${h.lastAttestedVersion} (${date}); ${n} release${n === 1 ? "" : "s"} since without`;
}

/** One summary line for profile text (single-package lookups, MCP, pages). */
export function provenanceSummaryLine(h: ProvenanceHistory | null | undefined): string | null {
  if (!h || !h.latestState) return null;
  const stop = provenanceStoppedFlag(h);
  if (stop) {
    const pypi = h.pypiWouldWarn === false ? " (PyPI's 14-day window no longer shows this)" : "";
    return `Provenance history: ${stop.replace(/^INFO: /, "")}${pypi}`;
  }
  if (!h.lastAttestedVersion) return "Provenance history: no release has ever shipped provenance";
  return `Provenance history: latest ${h.latestState}; last attested ${h.lastAttestedVersion} (${(h.lastAttestedAt ?? "").slice(0, 10)})`;
}
