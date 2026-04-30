#!/usr/bin/env bun
/**
 * Commit Portfolio Trust Report Generator
 *
 * Generates a standalone, professional HTML report for dependency portfolio audits.
 * Designed for enterprise buyers — VP Engineering, Security leads, CTOs.
 *
 * Usage:
 *   bun tools/portfolio-report.ts express axios chalk zod hono lodash react next typescript webpack
 *   bun tools/portfolio-report.ts --input packages.json --output report.html
 *   bun tools/portfolio-report.ts --ecosystem npm express axios chalk
 */

const API_BASE = "https://poc-backend.amdal-dev.workers.dev";
const VERSION = "1.0.0";

// --- Types ---

interface ScoreBreakdown {
  longevity: number;
  downloadMomentum: number;
  releaseConsistency: number;
  maintainerDepth: number;
  githubBacking: number;
}

interface AuditResult {
  name: string;
  ecosystem: string;
  score: number | null;
  maintainers: number;
  weeklyDownloads: number;
  ageYears: number;
  trend: "stable" | "growing" | "declining" | "unknown";
  daysSinceLastPublish: number;
  riskFlags: string[];
  scoreBreakdown: ScoreBreakdown;
}

interface AuditResponse {
  count: number;
  results: AuditResult[];
}

// --- CLI parsing ---

function parseArgs(): { packages: string[]; output: string; ecosystem: string } {
  const args = process.argv.slice(2);
  let output = "";
  let ecosystem = "auto";
  let inputFile = "";
  const packages: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" || args[i] === "-o") {
      output = args[++i];
    } else if (args[i] === "--input" || args[i] === "-i") {
      inputFile = args[++i];
    } else if (args[i] === "--ecosystem" || args[i] === "-e") {
      ecosystem = args[++i];
    } else if (!args[i].startsWith("-")) {
      packages.push(args[i]);
    }
  }

  if (inputFile) {
    try {
      const content = require("fs").readFileSync(inputFile, "utf8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        packages.push(...parsed);
      } else if (parsed.packages) {
        packages.push(...parsed.packages);
      }
    } catch (e: any) {
      console.error(`Failed to read input file: ${e.message}`);
      process.exit(1);
    }
  }

  if (packages.length === 0) {
    console.error("Usage: bun tools/portfolio-report.ts [--output file.html] [--ecosystem npm|pypi] package1 package2 ...");
    console.error("       bun tools/portfolio-report.ts --input packages.json");
    process.exit(1);
  }

  return { packages, output, ecosystem };
}

// --- API calls ---

async function auditPackage(name: string, ecosystem: string): Promise<AuditResult | null> {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(`${API_BASE}/api/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packages: [name], ecosystem }),
      });

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") || "10");
        console.warn(`  Rate limited on ${name}, waiting ${retryAfter}s...`);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (!res.ok) {
        console.error(`  API error for ${name}: ${res.status} ${res.statusText}`);
        return null;
      }

      const data: AuditResponse = await res.json();
      if (data.results && data.results.length > 0) {
        return data.results[0];
      }
      return null;
    } catch (e: any) {
      console.error(`  Network error for ${name}: ${e.message}`);
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  return null;
}

async function auditAll(packages: string[], ecosystem: string): Promise<{ results: AuditResult[]; failures: string[] }> {
  const results: AuditResult[] = [];
  const failures: string[] = [];

  console.log(`\nAuditing ${packages.length} packages...\n`);

  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    process.stdout.write(`  [${i + 1}/${packages.length}] ${pkg}...`);
    const result = await auditPackage(pkg, ecosystem);
    if (result && result.score !== null) {
      results.push(result);
      console.log(` score: ${result.score}${result.riskFlags.length ? ` [${result.riskFlags.join(", ")}]` : ""}`);
    } else {
      failures.push(pkg);
      console.log(" FAILED");
    }
    // Small delay between requests to be respectful
    if (i < packages.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return { results, failures };
}

// --- Report generation ---

function scoreColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 60) return "#fbbf24";
  if (score >= 40) return "#fb923c";
  return "#f87171";
}

function scoreLabel(score: number): string {
  if (score >= 80) return "Healthy";
  if (score >= 60) return "Moderate";
  if (score >= 40) return "Elevated";
  return "High Risk";
}

function scoreBgColor(score: number): string {
  if (score >= 80) return "#0d2818";
  if (score >= 60) return "#1f1a00";
  if (score >= 40) return "#1f0d00";
  return "#1f0000";
}

function riskFlagColor(flag: string): string {
  if (flag === "CRITICAL") return "#f87171";
  if (flag === "HIGH") return "#fb923c";
  return "#fbbf24";
}

function trendArrow(trend: string): string {
  if (trend === "growing") return "&#x25B2;"; // ▲
  if (trend === "declining") return "&#x25BC;"; // ▼
  return "&#x25CF;"; // ●
}

function trendColor(trend: string): string {
  if (trend === "growing") return "#4ade80";
  if (trend === "declining") return "#f87171";
  return "#666";
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function computePortfolioStats(results: AuditResult[]) {
  const scores = results.map((r) => r.score!);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const critical = results.filter((r) => r.riskFlags.includes("CRITICAL")).length;
  const high = results.filter((r) => r.riskFlags.includes("HIGH")).length;
  const warn = results.filter((r) => r.riskFlags.includes("WARN")).length;
  const healthy = results.filter((r) => r.score! >= 80).length;
  const moderate = results.filter((r) => r.score! >= 60 && r.score! < 80).length;
  const elevated = results.filter((r) => r.score! >= 40 && r.score! < 60).length;
  const highRisk = results.filter((r) => r.score! < 40).length;
  const singleMaintainer = results.filter((r) => r.maintainers <= 1).length;
  const totalDownloads = results.reduce((a, r) => a + r.weeklyDownloads, 0);
  const sorted = [...results].sort((a, b) => a.score! - b.score!);

  return { avg, critical, high, warn, healthy, moderate, elevated, highRisk, singleMaintainer, totalDownloads, sorted };
}

function generateCriticalFindings(results: AuditResult[]): string[] {
  const findings: string[] = [];

  for (const r of results) {
    if (r.riskFlags.includes("CRITICAL")) {
      findings.push(
        `<strong>${r.name}</strong> has only <strong>${r.maintainers}</strong> maintainer(s) with <strong>${formatDownloads(r.weeklyDownloads)}</strong> weekly downloads. ` +
        `This is a bus-factor risk — if the sole publisher becomes unavailable, a widely-used dependency in your stack goes unmaintained.`
      );
    }
    if (r.riskFlags.includes("HIGH")) {
      findings.push(
        `<strong>${r.name}</strong> is a young package (${r.ageYears.toFixed(1)} years) with high adoption (${formatDownloads(r.weeklyDownloads)}/wk). ` +
        `Rapid adoption of young packages increases supply chain exposure.`
      );
    }
    if (r.riskFlags.includes("WARN")) {
      findings.push(
        `<strong>${r.name}</strong> has not published a release in ${r.daysSinceLastPublish} days. ` +
        `Stale packages may miss security patches and compatibility updates.`
      );
    }
  }

  // Single maintainer without CRITICAL flag
  for (const r of results) {
    if (r.maintainers <= 1 && !r.riskFlags.includes("CRITICAL")) {
      findings.push(
        `<strong>${r.name}</strong> has a single maintainer. While not flagged CRITICAL (downloads below threshold), ` +
        `this remains a concentration risk.`
      );
    }
  }

  // Low GitHub backing
  for (const r of results) {
    if (r.scoreBreakdown.githubBacking <= 3 && r.score! < 70) {
      findings.push(
        `<strong>${r.name}</strong> has minimal GitHub backing (${r.scoreBreakdown.githubBacking}/15). ` +
        `Open-source engagement metrics suggest limited community contribution.`
      );
    }
  }

  return findings;
}

function generateRecommendations(results: AuditResult[], stats: ReturnType<typeof computePortfolioStats>): string[] {
  const recs: string[] = [];

  if (stats.critical > 0) {
    const critPkgs = results.filter((r) => r.riskFlags.includes("CRITICAL")).map((r) => r.name);
    recs.push(
      `<strong>Address CRITICAL risks immediately.</strong> ${critPkgs.join(", ")} ${critPkgs.length > 1 ? "have" : "has"} single-maintainer risk at high download volumes. ` +
      `Consider: funding the maintainer, contributing to the project, or evaluating alternatives with broader maintainer bases.`
    );
  }

  if (stats.singleMaintainer > results.length * 0.3) {
    recs.push(
      `<strong>Reduce single-maintainer concentration.</strong> ${stats.singleMaintainer} of ${results.length} packages ` +
      `(${Math.round((stats.singleMaintainer / results.length) * 100)}%) have a single maintainer. ` +
      `Diversify where possible or establish internal forks for mission-critical dependencies.`
    );
  }

  const stale = results.filter((r) => r.daysSinceLastPublish > 365);
  if (stale.length > 0) {
    recs.push(
      `<strong>Review stale dependencies.</strong> ${stale.map((r) => r.name).join(", ")} ` +
      `${stale.length > 1 ? "have" : "has"} not published in over a year. Assess if these are feature-complete ` +
      `or genuinely unmaintained — the distinction matters for security posture.`
    );
  }

  if (stats.avg >= 75) {
    recs.push(
      `<strong>Portfolio health is strong.</strong> Average score of ${stats.avg.toFixed(0)} indicates a well-curated dependency stack. ` +
      `Continue monitoring for regressions, especially around maintainer changes.`
    );
  } else if (stats.avg >= 55) {
    recs.push(
      `<strong>Portfolio health is moderate.</strong> Average score of ${stats.avg.toFixed(0)} suggests room for improvement. ` +
      `Focus on the lowest-scoring packages first — small changes in dependency selection compound across the stack.`
    );
  } else {
    recs.push(
      `<strong>Portfolio health needs attention.</strong> Average score of ${stats.avg.toFixed(0)} indicates significant supply chain risk. ` +
      `Prioritize a dependency audit and consider a dedicated SBOM review.`
    );
  }

  recs.push(
    `<strong>Set up continuous monitoring.</strong> Dependency health changes over time — maintainers leave, projects go dormant, ` +
    `new vulnerabilities emerge. Commit Pro provides real-time alerts when your dependency scores change. ` +
    `<a href="https://getcommit.dev/pricing" style="color: #4ade80;">Learn more &rarr;</a>`
  );

  return recs;
}

function generateHTML(results: AuditResult[], failures: string[]): string {
  const stats = computePortfolioStats(results);
  const criticalFindings = generateCriticalFindings(results);
  const recommendations = generateRecommendations(results, stats);
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  // Generate score breakdown bars for each package
  function breakdownBar(label: string, value: number, max: number): string {
    const pct = Math.round((value / max) * 100);
    const color = pct >= 70 ? "#4ade80" : pct >= 40 ? "#fbbf24" : "#f87171";
    return `
      <div class="breakdown-row">
        <span class="breakdown-label">${label}</span>
        <div class="breakdown-track">
          <div class="breakdown-fill" style="width: ${pct}%; background: ${color};"></div>
        </div>
        <span class="breakdown-value">${value}/${max}</span>
      </div>`;
  }

  // Package cards
  const packageCards = stats.sorted
    .map(
      (r) => `
    <div class="package-card" style="border-left: 4px solid ${scoreColor(r.score!)};">
      <div class="package-header">
        <div class="package-info">
          <span class="package-name">${r.name}</span>
          <span class="package-eco">${r.ecosystem}</span>
          ${r.riskFlags.map((f) => `<span class="risk-badge" style="background: ${riskFlagColor(f)}20; color: ${riskFlagColor(f)}; border: 1px solid ${riskFlagColor(f)}40;">${f}</span>`).join("")}
        </div>
        <div class="package-score" style="color: ${scoreColor(r.score!)};">
          <span class="score-number">${r.score}</span>
          <span class="score-label">${scoreLabel(r.score!)}</span>
        </div>
      </div>
      <div class="package-meta">
        <span>${formatDownloads(r.weeklyDownloads)}/wk</span>
        <span>${r.maintainers} maintainer${r.maintainers !== 1 ? "s" : ""}</span>
        <span>${r.ageYears.toFixed(1)} years</span>
        <span style="color: ${trendColor(r.trend)};">${trendArrow(r.trend)} ${r.trend}</span>
        <span>${r.daysSinceLastPublish}d since release</span>
      </div>
      <div class="breakdowns">
        ${breakdownBar("Longevity", r.scoreBreakdown.longevity, 25)}
        ${breakdownBar("Downloads", r.scoreBreakdown.downloadMomentum, 25)}
        ${breakdownBar("Releases", r.scoreBreakdown.releaseConsistency, 20)}
        ${breakdownBar("Maintainers", r.scoreBreakdown.maintainerDepth, 15)}
        ${breakdownBar("GitHub", r.scoreBreakdown.githubBacking, 15)}
      </div>
    </div>`
    )
    .join("\n");

  // Heatmap rows
  const heatmapRows = stats.sorted
    .map(
      (r) => `
    <tr>
      <td class="heatmap-name">${r.name}</td>
      <td class="heatmap-cell" style="background: ${scoreBgColor(r.score!)}; color: ${scoreColor(r.score!)};">${r.score}</td>
      <td class="heatmap-cell" style="background: ${scoreBgColor(r.scoreBreakdown.longevity * 4)}; color: ${scoreColor(r.scoreBreakdown.longevity * 4)};">${r.scoreBreakdown.longevity}</td>
      <td class="heatmap-cell" style="background: ${scoreBgColor(r.scoreBreakdown.downloadMomentum * 4)}; color: ${scoreColor(r.scoreBreakdown.downloadMomentum * 4)};">${r.scoreBreakdown.downloadMomentum}</td>
      <td class="heatmap-cell" style="background: ${scoreBgColor(r.scoreBreakdown.releaseConsistency * 5)}; color: ${scoreColor(r.scoreBreakdown.releaseConsistency * 5)};">${r.scoreBreakdown.releaseConsistency}</td>
      <td class="heatmap-cell" style="background: ${scoreBgColor(r.scoreBreakdown.maintainerDepth * 6.67)}; color: ${scoreColor(r.scoreBreakdown.maintainerDepth * 6.67)};">${r.scoreBreakdown.maintainerDepth}</td>
      <td class="heatmap-cell" style="background: ${scoreBgColor(r.scoreBreakdown.githubBacking * 6.67)}; color: ${scoreColor(r.scoreBreakdown.githubBacking * 6.67)};">${r.scoreBreakdown.githubBacking}</td>
      <td class="heatmap-flags">${r.riskFlags.length ? r.riskFlags.map((f) => `<span style="color: ${riskFlagColor(f)};">${f}</span>`).join(" ") : '<span style="color: #666;">&mdash;</span>'}</td>
    </tr>`
    )
    .join("\n");

  // Critical findings HTML
  const findingsHTML = criticalFindings.length
    ? criticalFindings.map((f) => `<li class="finding">${f}</li>`).join("\n")
    : `<li class="finding" style="color: #4ade80;">No critical findings. Portfolio passes all automated checks.</li>`;

  // Recommendations HTML
  const recsHTML = recommendations.map((r) => `<li class="recommendation">${r}</li>`).join("\n");

  // Failures section
  const failuresHTML = failures.length
    ? `<div class="failures-section">
        <h3>Packages that could not be audited</h3>
        <p>${failures.join(", ")}</p>
       </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Commit Dependency Trust Report &mdash; ${dateStr}</title>
  <style>
    /* === Reset & Base === */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0a0a0a;
      --card: #141414;
      --card-border: #222;
      --text: #e5e5e5;
      --text-muted: #888;
      --text-dim: #555;
      --green: #4ade80;
      --yellow: #fbbf24;
      --orange: #fb923c;
      --red: #f87171;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      --mono: "SF Mono", "Fira Code", "Cascadia Code", "JetBrains Mono", monospace;
    }

    @media print {
      :root {
        --bg: #ffffff;
        --card: #f8f8f8;
        --card-border: #ddd;
        --text: #111;
        --text-muted: #555;
        --text-dim: #999;
      }
      body { background: white; color: #111; }
      .package-card { break-inside: avoid; }
      .header { background: #111 !important; }
      .header * { color: white !important; }
      .no-print { display: none !important; }
    }

    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    /* === Layout === */
    .container {
      max-width: 1000px;
      margin: 0 auto;
      padding: 0 24px;
    }

    /* === Header === */
    .header {
      background: linear-gradient(135deg, #0a0a0a 0%, #111 50%, #0a0a0a 100%);
      border-bottom: 1px solid var(--card-border);
      padding: 48px 0 40px;
    }

    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
    }

    .header-left h1 {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.5px;
      margin-bottom: 4px;
    }

    .header-left .subtitle {
      color: var(--text-muted);
      font-size: 14px;
    }

    .header-right {
      text-align: right;
    }

    .header-logo {
      font-size: 20px;
      font-weight: 700;
      color: var(--green);
      letter-spacing: -0.3px;
      margin-bottom: 4px;
    }

    .header-meta {
      color: var(--text-dim);
      font-size: 12px;
      font-family: var(--mono);
    }

    /* === Executive Summary === */
    .exec-summary {
      padding: 40px 0;
      border-bottom: 1px solid var(--card-border);
    }

    .exec-summary h2 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 24px;
      letter-spacing: -0.3px;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .summary-card {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 20px;
      text-align: center;
    }

    .summary-card .big-number {
      font-size: 36px;
      font-weight: 700;
      font-family: var(--mono);
      line-height: 1;
      margin-bottom: 6px;
    }

    .summary-card .label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .distribution-bar {
      display: flex;
      height: 8px;
      border-radius: 4px;
      overflow: hidden;
      margin-top: 16px;
    }

    .distribution-bar .segment {
      transition: width 0.3s ease;
    }

    .distribution-legend {
      display: flex;
      gap: 16px;
      margin-top: 10px;
      flex-wrap: wrap;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    /* === Sections === */
    .section {
      padding: 40px 0;
      border-bottom: 1px solid var(--card-border);
    }

    .section:last-child {
      border-bottom: none;
    }

    .section h2 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 24px;
      letter-spacing: -0.3px;
    }

    /* === Heatmap === */
    .heatmap-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      font-family: var(--mono);
    }

    .heatmap-table th {
      padding: 10px 12px;
      text-align: center;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      border-bottom: 1px solid var(--card-border);
    }

    .heatmap-table th:first-child {
      text-align: left;
    }

    .heatmap-name {
      padding: 10px 12px;
      font-weight: 500;
      color: var(--text);
    }

    .heatmap-cell {
      padding: 10px 12px;
      text-align: center;
      font-weight: 600;
      border-radius: 4px;
    }

    .heatmap-flags {
      padding: 10px 12px;
      text-align: center;
      font-size: 11px;
      font-weight: 600;
    }

    .heatmap-table tr {
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }

    /* === Package Cards === */
    .package-cards {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .package-card {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 20px 24px;
    }

    .package-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .package-info {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .package-name {
      font-size: 18px;
      font-weight: 600;
      font-family: var(--mono);
    }

    .package-eco {
      font-size: 11px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .risk-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      letter-spacing: 0.3px;
    }

    .package-score {
      text-align: right;
    }

    .score-number {
      font-size: 32px;
      font-weight: 700;
      font-family: var(--mono);
      line-height: 1;
      display: block;
    }

    .score-label {
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.7;
    }

    .package-meta {
      display: flex;
      gap: 20px;
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .breakdowns {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .breakdown-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .breakdown-label {
      width: 90px;
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.3px;
      flex-shrink: 0;
    }

    .breakdown-track {
      flex: 1;
      height: 6px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 3px;
      overflow: hidden;
    }

    .breakdown-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s ease;
    }

    .breakdown-value {
      width: 40px;
      font-size: 11px;
      font-family: var(--mono);
      color: var(--text-muted);
      text-align: right;
      flex-shrink: 0;
    }

    /* === Findings & Recommendations === */
    .findings-list, .recs-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .finding, .recommendation {
      padding: 16px 20px;
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      font-size: 14px;
      line-height: 1.6;
    }

    .finding {
      border-left: 3px solid var(--red);
    }

    .recommendation {
      border-left: 3px solid var(--green);
    }

    .recommendation a {
      text-decoration: none;
    }

    .recommendation a:hover {
      text-decoration: underline;
    }

    /* === Failures === */
    .failures-section {
      margin-top: 24px;
      padding: 16px 20px;
      background: rgba(248, 113, 113, 0.05);
      border: 1px solid rgba(248, 113, 113, 0.15);
      border-radius: 8px;
    }

    .failures-section h3 {
      font-size: 14px;
      color: var(--red);
      margin-bottom: 8px;
    }

    .failures-section p {
      font-family: var(--mono);
      font-size: 13px;
      color: var(--text-muted);
    }

    /* === Footer === */
    .footer {
      padding: 40px 0;
      text-align: center;
      border-top: 1px solid var(--card-border);
    }

    .footer-brand {
      font-size: 16px;
      font-weight: 600;
      color: var(--green);
      margin-bottom: 6px;
    }

    .footer-tagline {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 16px;
    }

    .footer-cta {
      display: inline-block;
      padding: 10px 24px;
      background: var(--green);
      color: #0a0a0a;
      font-weight: 600;
      font-size: 14px;
      border-radius: 8px;
      text-decoration: none;
      transition: opacity 0.2s;
    }

    .footer-cta:hover {
      opacity: 0.9;
    }

    .footer-legal {
      margin-top: 20px;
      font-size: 11px;
      color: var(--text-dim);
    }

    /* === Responsive === */
    @media (max-width: 600px) {
      .header-content { flex-direction: column; }
      .header-right { text-align: left; }
      .summary-grid { grid-template-columns: 1fr 1fr; }
      .package-header { flex-direction: column; align-items: flex-start; gap: 8px; }
      .package-score { text-align: left; }
      .package-meta { gap: 12px; }
      .heatmap-table { font-size: 11px; }
    }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div class="container header-content">
      <div class="header-left">
        <h1>Dependency Trust Report</h1>
        <div class="subtitle">${results.length} packages audited across ${[...new Set(results.map((r) => r.ecosystem))].join(", ")}</div>
      </div>
      <div class="header-right">
        <div class="header-logo">Commit</div>
        <div class="header-meta">${dateStr}<br>${timeStr}<br>v${VERSION}</div>
      </div>
    </div>
  </div>

  <!-- Executive Summary -->
  <div class="container exec-summary">
    <h2>Executive Summary</h2>
    <div class="summary-grid">
      <div class="summary-card">
        <div class="big-number" style="color: ${scoreColor(stats.avg)};">${stats.avg.toFixed(0)}</div>
        <div class="label">Average Score</div>
      </div>
      <div class="summary-card">
        <div class="big-number">${results.length}</div>
        <div class="label">Packages</div>
      </div>
      <div class="summary-card">
        <div class="big-number" style="color: ${stats.critical > 0 ? "var(--red)" : "var(--green)"};">${stats.critical}</div>
        <div class="label">Critical Flags</div>
      </div>
      <div class="summary-card">
        <div class="big-number">${formatDownloads(stats.totalDownloads)}</div>
        <div class="label">Total Downloads/wk</div>
      </div>
      <div class="summary-card">
        <div class="big-number" style="color: ${stats.singleMaintainer > results.length * 0.3 ? "var(--orange)" : "var(--text)"};">${stats.singleMaintainer}</div>
        <div class="label">Single Maintainer</div>
      </div>
    </div>

    <!-- Distribution bar -->
    <div class="distribution-bar">
      ${stats.healthy > 0 ? `<div class="segment" style="width: ${(stats.healthy / results.length) * 100}%; background: var(--green);"></div>` : ""}
      ${stats.moderate > 0 ? `<div class="segment" style="width: ${(stats.moderate / results.length) * 100}%; background: var(--yellow);"></div>` : ""}
      ${stats.elevated > 0 ? `<div class="segment" style="width: ${(stats.elevated / results.length) * 100}%; background: var(--orange);"></div>` : ""}
      ${stats.highRisk > 0 ? `<div class="segment" style="width: ${(stats.highRisk / results.length) * 100}%; background: var(--red);"></div>` : ""}
    </div>
    <div class="distribution-legend">
      <div class="legend-item"><div class="legend-dot" style="background: var(--green);"></div> Healthy (${stats.healthy})</div>
      <div class="legend-item"><div class="legend-dot" style="background: var(--yellow);"></div> Moderate (${stats.moderate})</div>
      <div class="legend-item"><div class="legend-dot" style="background: var(--orange);"></div> Elevated (${stats.elevated})</div>
      <div class="legend-item"><div class="legend-dot" style="background: var(--red);"></div> High Risk (${stats.highRisk})</div>
    </div>
  </div>

  <!-- Risk Heatmap -->
  <div class="container section">
    <h2>Risk Heatmap</h2>
    <div style="overflow-x: auto;">
      <table class="heatmap-table">
        <thead>
          <tr>
            <th style="text-align: left;">Package</th>
            <th>Score</th>
            <th>Longevity</th>
            <th>Downloads</th>
            <th>Releases</th>
            <th>Maintainers</th>
            <th>GitHub</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          ${heatmapRows}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Critical Findings -->
  <div class="container section">
    <h2>Critical Findings</h2>
    <ul class="findings-list">
      ${findingsHTML}
    </ul>
    ${failuresHTML}
  </div>

  <!-- Package Details -->
  <div class="container section">
    <h2>Package Details</h2>
    <div class="package-cards">
      ${packageCards}
    </div>
  </div>

  <!-- Recommendations -->
  <div class="container section">
    <h2>Recommendations</h2>
    <ol class="recs-list">
      ${recsHTML}
    </ol>
  </div>

  <!-- Footer -->
  <div class="container footer">
    <div class="footer-brand">Commit</div>
    <div class="footer-tagline">Trust signals for your software supply chain</div>
    <a href="https://getcommit.dev/pricing" class="footer-cta no-print">Get real-time monitoring &rarr;</a>
    <div class="footer-legal">
      Generated by <a href="https://getcommit.dev" style="color: var(--green); text-decoration: none;">Commit</a> (getcommit.dev) &mdash; v${VERSION}<br>
      Scores reflect point-in-time analysis. Dependency health changes &mdash; monitor continuously.<br>
      &copy; ${now.getFullYear()} Commit. All rights reserved.
    </div>
  </div>

</body>
</html>`;
}

// --- Main ---

async function main() {
  const { packages, output, ecosystem } = parseArgs();

  console.log("Commit Portfolio Trust Report Generator");
  console.log("=======================================");
  console.log(`Packages: ${packages.join(", ")}`);
  console.log(`Ecosystem: ${ecosystem}`);

  const { results, failures } = await auditAll(packages, ecosystem);

  if (results.length === 0) {
    console.error("\nNo packages could be audited. Exiting.");
    process.exit(1);
  }

  console.log(`\nGenerating report... (${results.length} succeeded, ${failures.length} failed)`);

  const html = generateHTML(results, failures);

  const outputPath = output || `portfolio-report-${new Date().toISOString().slice(0, 10)}.html`;
  require("fs").writeFileSync(outputPath, html, "utf8");

  const stats = computePortfolioStats(results);
  console.log(`\n✓ Report saved to: ${outputPath}`);
  console.log(`  Average score: ${stats.avg.toFixed(0)}`);
  console.log(`  Critical flags: ${stats.critical}`);
  console.log(`  File size: ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
