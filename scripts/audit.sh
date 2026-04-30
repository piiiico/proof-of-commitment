#!/bin/bash
# Commit Supply Chain Audit — GitHub Action entrypoint
# Audits npm/PyPI packages for behavioral commitment signals via getcommit.dev API
set -e

API_URL="${INPUT_API_URL:-https://poc-backend.amdal-dev.workers.dev}"
API_KEY="${INPUT_API_KEY:-}"
MAX_PACKAGES="${INPUT_MAX_PACKAGES:-20}"
FAIL_ON_CRITICAL="${INPUT_FAIL_ON_CRITICAL:-true}"
INCLUDE_DEV="${INPUT_INCLUDE_DEV_DEPENDENCIES:-false}"
TMP_DIR="${RUNNER_TEMP:-/tmp}"
PACKAGES_FILE="$TMP_DIR/commit-audit-packages.json"
RESPONSE_FILE="$TMP_DIR/commit-audit-response.json"
SUMMARY_FILE="$TMP_DIR/commit-audit-summary.md"

# Build curl auth header if API key is provided
if [ -n "$API_KEY" ]; then
  AUTH_HEADER="-H \"Authorization: Bearer $API_KEY\""
  echo "::group::🔍 Commit Supply Chain Audit (Pro)"
else
  AUTH_HEADER=""
  echo "::group::🔍 Commit Supply Chain Audit"
fi

# ─── Determine package file to use ──────────────────────────────────────────

PACKAGE_SOURCE=""
if [ -n "$INPUT_PACKAGES_FILE" ]; then
  PACKAGE_SOURCE="$INPUT_PACKAGES_FILE"
elif [ -f "package.json" ]; then
  PACKAGE_SOURCE="package.json"
elif [ -f "requirements.txt" ]; then
  PACKAGE_SOURCE="requirements.txt"
elif [ -f "pyproject.toml" ]; then
  PACKAGE_SOURCE="pyproject.toml"
fi

# ─── Build package list ──────────────────────────────────────────────────────

if [ -n "$INPUT_PACKAGES" ]; then
  # Manual list provided
  python3 -c "
import json, sys
pkgs = [p.strip() for p in sys.argv[1].split(',') if p.strip()]
print(json.dumps(pkgs))
" "$INPUT_PACKAGES" > "$PACKAGES_FILE"
  COUNT=$(python3 -c "import json; print(len(json.load(open('$PACKAGES_FILE'))))")
  echo "📦 Using $COUNT manually-specified packages"

elif [ -n "$PACKAGE_SOURCE" ] && [[ "$PACKAGE_SOURCE" == *"package.json"* ]]; then
  python3 -c "
import json, sys
max_pkgs = int(sys.argv[1])
include_dev = sys.argv[2].lower() == 'true'
with open(sys.argv[3]) as f:
    pkg = json.load(f)
deps = list(pkg.get('dependencies', {}).keys())
if include_dev:
    deps += list(pkg.get('devDependencies', {}).keys())
# If no prod deps and dev not explicitly included, still show prod
if not deps and not include_dev:
    deps = list(pkg.get('devDependencies', {}).keys())
print(json.dumps(deps[:max_pkgs]))
" "$MAX_PACKAGES" "$INCLUDE_DEV" "$PACKAGE_SOURCE" > "$PACKAGES_FILE"
  COUNT=$(python3 -c "import json; print(len(json.load(open('$PACKAGES_FILE'))))")
  echo "📦 Auto-detected $COUNT packages from $PACKAGE_SOURCE"

elif [ -n "$PACKAGE_SOURCE" ] && [[ "$PACKAGE_SOURCE" == *"requirements.txt"* ]]; then
  python3 -c "
import re, json, sys
max_pkgs = int(sys.argv[1])
pkgs = []
with open(sys.argv[2]) as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and not line.startswith('-'):
            pkg = re.split(r'[>=<!~;\[]', line)[0].strip()
            if pkg:
                pkgs.append(pkg)
print(json.dumps(pkgs[:max_pkgs]))
" "$MAX_PACKAGES" "$PACKAGE_SOURCE" > "$PACKAGES_FILE"
  COUNT=$(python3 -c "import json; print(len(json.load(open('$PACKAGES_FILE'))))")
  echo "🐍 Auto-detected $COUNT packages from $PACKAGE_SOURCE"

elif [ -n "$PACKAGE_SOURCE" ] && [[ "$PACKAGE_SOURCE" == *"pyproject.toml"* ]]; then
  python3 -c "
import re, json, sys
max_pkgs = int(sys.argv[1])
pkgs = []
with open(sys.argv[2]) as f:
    content = f.read()
in_deps = False
for line in content.split('\n'):
    if re.match(r'dependencies\s*=\s*\[', line):
        in_deps = True
    if in_deps:
        m = re.search(r'[\"\']([\w\-\.]+)', line)
        if m:
            pkgs.append(m.group(1))
        if ']' in line and 'dependencies' not in line:
            break
print(json.dumps(pkgs[:max_pkgs]))
" "$MAX_PACKAGES" "$PACKAGE_SOURCE" > "$PACKAGES_FILE" 2>/dev/null || echo "[]" > "$PACKAGES_FILE"
  COUNT=$(python3 -c "import json; print(len(json.load(open('$PACKAGES_FILE'))))")
  echo "🐍 Auto-detected $COUNT packages from $PACKAGE_SOURCE"

else
  echo "⚠️  No packages specified and no package.json/requirements.txt found."
  echo "    Set the 'packages' input or run from a directory with a package file."
  echo "::endgroup::"
  exit 0
fi

PACKAGES=$(cat "$PACKAGES_FILE")
if [ "$PACKAGES" = "[]" ] || [ -z "$PACKAGES" ]; then
  echo "⚠️  Package list is empty — nothing to audit."
  echo "::endgroup::"
  exit 0
fi

# ─── Call audit API ──────────────────────────────────────────────────────────

echo ""

# Build curl command with optional auth header
call_audit_api() {
  local payload="$1"
  local out="$2"
  if [ -n "$API_KEY" ]; then
    curl -s -w "%{http_code}" -o "$out" \
      -X POST "$API_URL/api/audit" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $API_KEY" \
      --max-time 30 \
      -d "$payload"
  else
    curl -s -w "%{http_code}" -o "$out" \
      -X POST "$API_URL/api/audit" \
      -H "Content-Type: application/json" \
      --max-time 30 \
      -d "$payload"
  fi
}

echo "Calling Commit audit API..."
HTTP_CODE=$(call_audit_api "{\"packages\": $PACKAGES}" "$RESPONSE_FILE")

# If we hit the free-tier batch limit (403) or rate limit (429), fall back to per-package
if [ "$HTTP_CODE" = "403" ] || [ "$HTTP_CODE" = "429" ]; then
  if [ "$HTTP_CODE" = "403" ]; then
    echo "ℹ️  Batch requests require Commit Pro — falling back to per-package mode"
    echo "   Upgrade at https://getcommit.dev/pricing for faster CI (batch + higher limits)"
  else
    echo "⚠️  Rate limit reached — retrying with delays"
  fi

  # Per-package mode: build aggregate results array
  ALL_RESULTS="[]"
  PKG_LIST=$(python3 -c "import json; pkgs=json.load(open('$PACKAGES_FILE')); [print(p) for p in pkgs]")
  PKG_INDEX=0
  PKG_COUNT=$(python3 -c "import json; print(len(json.load(open('$PACKAGES_FILE'))))")

  while IFS= read -r PKG; do
    PKG_INDEX=$((PKG_INDEX + 1))
    SINGLE_PAYLOAD="{\"packages\": [$(python3 -c "import json; print(json.dumps('$PKG'))")]}"
    SINGLE_RESPONSE="$TMP_DIR/commit-audit-single.json"

    echo "  [$PKG_INDEX/$PKG_COUNT] Auditing $PKG..."
    SINGLE_HTTP=$(call_audit_api "$SINGLE_PAYLOAD" "$SINGLE_RESPONSE")

    if [ "$SINGLE_HTTP" = "200" ]; then
      # Merge this result into ALL_RESULTS
      ALL_RESULTS=$(python3 -c "
import json, sys
existing = json.loads(sys.argv[1])
with open(sys.argv[2]) as f:
    new = json.load(f)
existing.extend(new.get('results', []))
print(json.dumps(existing))
" "$ALL_RESULTS" "$SINGLE_RESPONSE")
    elif [ "$SINGLE_HTTP" = "429" ]; then
      echo "  ⚠️  Rate limited on $PKG — adding placeholder"
      ALL_RESULTS=$(python3 -c "
import json, sys
existing = json.loads(sys.argv[1])
existing.append({'name': sys.argv[2], 'ecosystem': 'npm', 'score': None, 'riskFlags': [], 'error': 'rate limited'})
print(json.dumps(existing))
" "$ALL_RESULTS" "$PKG")
    else
      echo "  ⚠️  Failed to audit $PKG (HTTP $SINGLE_HTTP)"
      ALL_RESULTS=$(python3 -c "
import json, sys
existing = json.loads(sys.argv[1])
existing.append({'name': sys.argv[2], 'ecosystem': 'npm', 'score': None, 'riskFlags': [], 'error': 'api error $SINGLE_HTTP'})
print(json.dumps(existing))
" "$ALL_RESULTS" "$PKG")
    fi

    # Delay between per-package requests to avoid rate limits (skip after last)
    if [ "$PKG_INDEX" -lt "$PKG_COUNT" ]; then
      sleep 0.5
    fi
  done <<< "$PKG_LIST"

  # Write combined results in the same format as batch API
  python3 -c "
import json, sys
results = json.loads(sys.argv[1])
results.sort(key=lambda r: (r.get('score') or -1))
with open(sys.argv[2], 'w') as f:
    json.dump({'count': len(results), 'results': results}, f)
" "$ALL_RESULTS" "$RESPONSE_FILE"

elif [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Audit API returned HTTP $HTTP_CODE"
  cat "$RESPONSE_FILE" 2>/dev/null || true
  echo "::endgroup::"
  exit 1
fi

# ─── Process results ─────────────────────────────────────────────────────────

export COMMIT_SUMMARY_FILE="$SUMMARY_FILE"

python3 - "$FAIL_ON_CRITICAL" "$RESPONSE_FILE" << 'PYEOF'
import json, os, sys

fail_on_critical = sys.argv[1].lower() == 'true'

with open(sys.argv[2]) as f:
    response = json.load(f)

results = response.get('results', [])

if not results:
    print("No results returned from audit API.")
    sys.exit(0)

# Build markdown table
table_lines = [
    "| Package | Risk | Score | Maintainers | Downloads/wk | Age |",
    "|---------|------|-------|-------------|--------------|-----|",
]

has_critical = False
critical_count = 0
high_count = 0
warn_count = 0
critical_packages = []

for r in results:
    risk_flags = r.get('riskFlags', [])
    error = r.get('error')

    if error and not risk_flags:
        risk_icon = f'⚪ {error}'
    elif 'CRITICAL' in risk_flags:
        has_critical = True
        critical_count += 1
        risk_icon = '🔴 CRITICAL'
        critical_packages.append(r['name'])
    elif 'HIGH' in risk_flags:
        high_count += 1
        risk_icon = '🟠 HIGH'
    elif risk_flags:
        warn_count += 1
        risk_icon = '🟡 ' + ', '.join(risk_flags)
    else:
        risk_icon = '🟢 OK'

    downloads = r.get('weeklyDownloads') or 0
    if downloads >= 1_000_000:
        dl_str = f"{downloads/1_000_000:.0f}M"
    elif downloads >= 1_000:
        dl_str = f"{downloads/1_000:.0f}K"
    elif downloads > 0:
        dl_str = str(downloads)
    else:
        dl_str = '—'

    score = r.get('score')
    score_str = str(score) if score is not None else '—'

    age = r.get('ageYears') or 0
    age_str = f"{age:.1f}y" if age else '—'

    maintainers = r.get('maintainers')
    maint_str = str(maintainers) if maintainers is not None else '—'

    table_lines.append(
        f"| `{r['name']}` | {risk_icon} | {score_str} | {maint_str} | {dl_str} | {age_str} |"
    )

table = "\n".join(table_lines)

if has_critical:
    headline = (
        f"🔴 **{critical_count} CRITICAL** package(s) — sole publisher + >10M weekly downloads. "
        f"Same risk profile as the axios (April 2026) and LiteLLM (March 2026) attacks.\n\n"
        f"Critical: {', '.join(f'`{p}`' for p in critical_packages)}"
    )
elif high_count:
    headline = f"🟠 **{high_count} HIGH risk** package(s) found. New packages with significant adoption — monitor closely."
elif warn_count:
    headline = f"🟡 **{warn_count} warning(s)** — packages with no recent releases. May be abandoned."
else:
    headline = "🟢 All packages pass behavioral commitment checks."

COMMIT_MARKER = "<!-- commit-supply-chain-audit -->"

summary = f"""{COMMIT_MARKER}
## 🔍 Supply Chain Audit

{table}

{headline}

> Scored by [Commit](https://getcommit.dev) — behavioral commitment signals for supply chain trust.
> **CRITICAL** = sole publisher + >10M weekly downloads (historically high-value attack targets).
> [What these scores mean](https://getcommit.dev/audit)
"""

print(summary)

# Write to GitHub Step Summary
step_summary = os.environ.get('GITHUB_STEP_SUMMARY', '')
if step_summary:
    with open(step_summary, 'w') as f:
        f.write(summary)

# Write outputs
output_file = os.environ.get('GITHUB_OUTPUT', '')
if output_file:
    with open(output_file, 'a') as f:
        f.write(f"has-critical={str(has_critical).lower()}\n")
        f.write(f"critical-count={critical_count}\n")
        f.write("audit-summary<<AUDIT_SUMMARY_EOF\n")
        f.write(summary)
        f.write("AUDIT_SUMMARY_EOF\n")

# Write summary to temp file for PR comment
summary_file = os.environ.get('COMMIT_SUMMARY_FILE', '')
if summary_file:
    with open(summary_file, 'w') as f:
        f.write(summary)

if has_critical and fail_on_critical:
    print(f"\n❌ Workflow failed: {critical_count} CRITICAL package(s) detected.")
    print("   Set fail-on-critical: false to continue despite CRITICAL findings.")
    sys.exit(1)
elif has_critical:
    print(f"\n⚠️  {critical_count} CRITICAL package(s) detected (fail-on-critical: false).")
    sys.exit(0)
else:
    print(f"\n✅ Audit passed: 0 CRITICAL packages.")
    sys.exit(0)
PYEOF

EXIT_CODE=$?

# ─── Post PR comment ─────────────────────────────────────────────────────────

if [ "${INPUT_COMMENT_ON_PR:-true}" = "true" ] && \
   [ "${GITHUB_EVENT_NAME:-}" = "pull_request" ] && \
   [ -n "${PR_NUMBER:-}" ] && \
   [ -n "${INPUT_GITHUB_TOKEN:-}" ] && \
   [ -f "$SUMMARY_FILE" ]; then

  echo ""
  echo "📝 Posting audit results as PR comment..."

  COMMENT_BODY=$(python3 -c "import json, sys; print(json.dumps(open(sys.argv[1]).read()))" "$SUMMARY_FILE")

  # Find existing comment with our marker to update instead of creating a new one
  EXISTING_COMMENT_ID=$(curl -s \
    -H "Authorization: token $INPUT_GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments?per_page=100" \
    | python3 -c "
import json, sys
comments = json.load(sys.stdin)
for c in comments:
    if '<!-- commit-supply-chain-audit -->' in c.get('body', ''):
        print(c['id'])
        break
" 2>/dev/null)

  if [ -n "$EXISTING_COMMENT_ID" ]; then
    # Update existing comment
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      -X PATCH \
      -H "Authorization: token $INPUT_GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      -H "Content-Type: application/json" \
      "https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/comments/${EXISTING_COMMENT_ID}" \
      -d "{\"body\": $COMMENT_BODY}")
    if [ "$HTTP_STATUS" = "200" ]; then
      echo "✅ PR comment updated (comment #$EXISTING_COMMENT_ID)"
    else
      echo "⚠️  Failed to update PR comment (HTTP $HTTP_STATUS)"
    fi
  else
    # Create new comment
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST \
      -H "Authorization: token $INPUT_GITHUB_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      -H "Content-Type: application/json" \
      "https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
      -d "{\"body\": $COMMENT_BODY}")
    if [ "$HTTP_STATUS" = "201" ]; then
      echo "✅ PR comment posted"
    else
      echo "⚠️  Failed to post PR comment (HTTP $HTTP_STATUS)"
    fi
  fi
fi

echo "::endgroup::"
exit $EXIT_CODE
