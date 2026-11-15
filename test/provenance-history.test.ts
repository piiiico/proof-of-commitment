/**
 * Window-free provenance history (PyPI + npm).
 *
 * PyPI shows Loss/Change only against an attested release from the preceding
 * 14 days (warehouse PROVENANCE_COMPARISON_WINDOW_DAYS). fastapi attested up to
 * 0.128.0 (2025-12-27) and then stopped; PyPI's page now reads plain "No
 * provenance", the same as boto3, which never attested. These tests run the real
 * pypi.ts / npm.ts code on recorded registry responses (fixtures recorded
 * 2026-11-15, stripped to the fields read). Only fetch is mocked.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { buildPyPICommitmentProfile, pypiReleaseProvenance } from "../src/backend/pypi.ts";
import { npmReleaseProvenance } from "../src/backend/npm.ts";
import {
  computeProvenanceHistory,
  provenanceStoppedFlag,
  type ReleaseProvenance,
} from "../src/backend/provenance-history.ts";

const DIR = `${import.meta.dir}/fixtures/provenance/`;
const load = (f: string) => Bun.file(DIR + f).json();

async function pypiHistory(p: string) {
  const j = await load(`${p}.json.json`);
  const s = await load(`${p}.simple.json`);
  return computeProvenanceHistory(pypiReleaseProvenance(j.releases, s.files), j.info.version, { pypiWindow: true });
}

describe("PyPI provenance history (recorded fixtures)", () => {
  test("fastapi: stopped after 0.128.0, ≥100 releases since, PyPI no longer warns", async () => {
    const h = await pypiHistory("fastapi");
    expect(h.latestState).toBe("none");
    expect(h.lastAttestedVersion).toBe("0.128.0");
    expect(h.lastAttestedAt?.slice(0, 10)).toBe("2025-12-27");
    expect(h.releasesSinceWithoutProvenance).toBeGreaterThanOrEqual(100);
    expect(h.pypiWouldWarn).toBe(false);
    const flag = provenanceStoppedFlag(h)!;
    expect(flag).toStartWith("INFO: provenance stopped: attested until 0.128.0 (2025-12-27); ");
    expect(flag).not.toMatch(/compromis|suspicious|malicious/i);
  });

  test("requests: latest full, no flag", async () => {
    const h = await pypiHistory("requests");
    expect(h.latestState).toBe("full");
    expect(h.lastAttestedVersion).toBe(h.latestVersion);
    expect(h.releasesSinceWithoutProvenance).toBe(0);
    expect(provenanceStoppedFlag(h)).toBeNull();
  });

  test("boto3: never attested → lastAttested null, no flag", async () => {
    const h = await pypiHistory("boto3");
    expect(h.latestState).toBe("none");
    expect(h.lastAttestedVersion).toBeNull();
    expect(provenanceStoppedFlag(h)).toBeNull();
  });

  test("grouping uses the JSON API version map, not filenames", () => {
    // A filename whose version string disagrees with the release key: the release key wins.
    const rel = pypiReleaseProvenance(
      { "1.0": [{ filename: "x-9.9.tar.gz", upload_time: "2026-01-01T00:00:00" }] },
      [{ filename: "x-9.9.tar.gz", provenance: "https://p", "upload-time": "2026-01-01T00:00:00Z" }]
    );
    expect(rel).toEqual([{ version: "1.0", publishedAt: Date.parse("2026-01-01T00:00:00Z"), state: "full" }]);
  });

  test("incomplete = some files attested; yanked files ignored", () => {
    const rel = pypiReleaseProvenance(
      {
        "2.0": [
          { filename: "a.whl", upload_time: "2026-01-01T00:00:00" },
          { filename: "a.tar.gz", upload_time: "2026-01-01T00:00:00" },
          { filename: "a-old.whl", upload_time: "2026-01-01T00:00:00", yanked: true },
        ],
      },
      [
        { filename: "a.whl", provenance: "https://p", "upload-time": "2026-01-01T00:00:00Z" },
        { filename: "a.tar.gz", provenance: null, "upload-time": "2026-01-01T00:00:00Z" },
        { filename: "a-old.whl", provenance: "https://p", "upload-time": "2026-01-01T00:00:00Z", yanked: true },
      ]
    );
    expect(rel[0]!.state).toBe("incomplete");
  });
});

describe("PyPI 14-day rule vs window-free view", () => {
  const day = 24 * 3600 * 1000;
  const t0 = Date.parse("2026-06-01T00:00:00Z");
  const mk = (gapDays: number): ReleaseProvenance[] => [
    { version: "1.0", publishedAt: t0, state: "full" },
    { version: "1.1", publishedAt: t0 + gapDays * day, state: "none" },
  ];
  test("stop within 14 days → PyPI warns too", () => {
    const h = computeProvenanceHistory(mk(5), "1.1", { pypiWindow: true });
    expect(h.pypiWouldWarn).toBe(true);
    expect(provenanceStoppedFlag(h)).not.toBeNull();
  });
  test("stop after 39 days → PyPI silent, we still report", () => {
    const h = computeProvenanceHistory(mk(39), "1.1", { pypiWindow: true });
    expect(h.pypiWouldWarn).toBe(false);
    expect(provenanceStoppedFlag(h)).toBe("INFO: provenance stopped: attested until 1.0 (2026-06-01); 1 release since without");
  });
  test("npm has no window → pypiWouldWarn null", () => {
    expect(computeProvenanceHistory(mk(5), "1.1", { pypiWindow: false }).pypiWouldWarn).toBeNull();
  });
});

describe("npm provenance history from the packument", () => {
  test("proof-of-commitment: latest attested, no flag", async () => {
    const pkg = await load("proof-of-commitment.npm.json");
    const h = computeProvenanceHistory(npmReleaseProvenance(pkg), pkg["dist-tags"].latest, { pypiWindow: false });
    expect(h.latestState).toBe("full");
    expect(h.lastAttestedVersion).toBe(pkg["dist-tags"].latest);
    expect(provenanceStoppedFlag(h)).toBeNull();
  });
  test("dropping attestations from latest → flag", async () => {
    const pkg = await load("proof-of-commitment.npm.json");
    const latest = pkg["dist-tags"].latest;
    pkg.versions[latest] = { dist: {} };
    const h = computeProvenanceHistory(npmReleaseProvenance(pkg), latest, { pypiWindow: false });
    expect(h.latestState).toBe("none");
    expect(provenanceStoppedFlag(h)).toStartWith("INFO: provenance stopped: attested until ");
  });
});

describe("buildPyPICommitmentProfile wiring (fetch mocked, real code)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  test("fastapi profile carries provenance + summary line; Simple API down → null, not a guess", async () => {
    const json = await load("fastapi.json.json");
    const simple = await load("fastapi.simple.json");
    let simpleUp = true;
    let simpleAccept = "";
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input?.url ?? input);
      if (url === "https://pypi.org/pypi/fastapi/json") return Response.json(json);
      if (url === "https://pypi.org/simple/fastapi/") {
        simpleAccept = new Headers(init?.headers).get("accept") ?? "";
        return simpleUp ? Response.json(simple) : new Response("x", { status: 503 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const p = (await buildPyPICommitmentProfile("fastapi"))!;
    expect(simpleAccept).toBe("application/vnd.pypi.simple.v1+json");
    expect(p.provenance?.lastAttestedVersion).toBe("0.128.0");
    expect(p.summary).toContain("Provenance history: provenance stopped: attested until 0.128.0");

    simpleUp = false;
    const q = (await buildPyPICommitmentProfile("fastapi"))!;
    expect(q.provenance).toBeNull();
    expect(provenanceStoppedFlag(q.provenance)).toBeNull();
  });
});
