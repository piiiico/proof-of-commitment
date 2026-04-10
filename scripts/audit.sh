#!/bin/bash
# Commit Supply Chain Audit — GitHub Action entrypoint
# Audits npm/PyPI packages for behavioral commitment signals via getcommit.dev API
set -e

API_URL="https://poc-backend.amdal-dev.workers.dev/api/audit"
MAX_PACKAGES="${INPUT_MAX_PACKAGES:-20}"
FAIL_ON_CRITICAL="${INPUT_FAIL_ON_CRITICAL:-true}"
TMP_DIR="${RUNNER_TEMP:-/tmp}"
PACKAGES_FILE="$TMP_DIR/commit-audit-packages.json"
RESPONSE_FILE="$TMP_DIR/commit-audit-response.json"

echo "::group::🔍 Commit Supply Chain Audit"

# ─── Build package list ──────────────────────────────────────────────────────

if [ -n "$INPUT_PACKAGES" ]; then
  # Manual list provided
  python3 -c "
import json, sys
pkgs = [p.strip() for p in sys.argv[1].split(',') if p.strip()]
print(json.dumps(pkgs)
)" "$INPUT_PACKAGES" > "$PACKAGES_FILE"
  COUNT=$(python3 -c "import json; print(len(json.load(open('$PACKAGES_FILE'))))")
  echo "📦 Using $COUNT manually-specified packages"

elif [ -f "package.json" ]; then
  python3 -c "
import json, sys
max_pkgs = int(sys.argv[1])
with open('package.json') as f:
    pkg = json.load(f)
deps = list(pkg.get('dependencies', {}).keys())
# Include devDependencies only if no prod deps found
if not deps:
    deps = list(pkg.get('devDependencies', {}).keys())
print(json.dumps(deps[:max_pkgs]))
" "$MAX_PACKAGES" > "$PACKAGES_FILE"
  COUNT=$(python3 -c "import json; print(len(json.load(open('$PACKAGES_FILE'))))")
  echo "📦 Auto-detected $COUNT packages from package.json"

elif [ -f "requirements.txt" ]; then
  python3 -c "
import re, json, sys
max_pkgs = int(sys.argv[1])
pkgs = []
with open('requirements.txt') as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and not line.startswith('-'):
            pkg = re.split(r'[>=<!~;\[]', line)[0].strip()
            if pkg:
                pkgs.append(pkg)
print(json.dumps(pkgs[:max_pkgs]))
" "$MAX_PACKAGES" > "$PACKAGES_FILE"
  COUNT=$(python3 -c "import json; print(len(json.load(open('$PACKAGES_FILE'))))")
  echo "🐍 Auto-detected $COUNT packages from requirements.txt"

elif [ -f "pyproject.toml" ]; then
  python3 -c "
import re, json, sys
max_pkgs = int(sys.argv[1])
pkgs = []
with open('pyproject.toml') as f:
    content = f.read()
# Extract from [project] dependencies
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
" "$MAX_PACKAGES" > "$PACKAGES_FILE" 2>/dev/null || echo "[]" > "$PACKAGES_FILE"
  COUNT=$(python3 -c "import json; print(len(json.load(open('$PACKAGES_FILE'))))")
  echo "🐍 Auto-detected $COUNT packages from pyproject.toml"

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
echo "Calling Commit audit API..."
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESPONSE_FILE" \
  -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  --max-time 30 \
  -d "{\"packages\": $PACKAGES}")

if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Audit API returned HTTP $HTTP_CODE"
  cat "$RESPONSE_FILE" 2>/dev/null || true
  echo "::endgroup::"
  exit 1
fi

# ─── Process results ─────────────────────────────────────────────────────────

SUMMARY_FILE="$TMP_DIR/commit-audit-summary.md"
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
critical_packages = []

for r in results:
    risk_flags = r.get('riskFlags', [])
    if 'CRITICAL' in risk_flags:
        has_critical = True
        critical_count += 1
        risk_icon = '🔴 CRITICAL'
        critical_packages.append(r['name'])
    elif risk_flags:
        high_count += 1
        risk_icon = '🟡 ' + ', '.join(risk_flags)
    else:
        risk_icon = '🟢 OK'

    downloads = r.get('weeklyDownloads', 0)
    if downloads >= 1_000_000:
        dl_str = f"{downloads/1_000_000:.0f}M"
    elif downloads >= 1_000:
        dl_str = f"{downloads/1_000:.0f}K"
    else:
        dl_str = str(downloads)

    age = r.get('ageYears', 0) or 0
    table_lines.append(
        f"| `{r['name']}` | {risk_icon} | {r.get('score', '?')} | {r.get('maintainers', '?')} | {dl_str} | {age:.1f}y |"
    )

table = "\n".join(table_lines)

if has_critical:
    headline = (
        f"🔴 **{critical_count} CRITICAL** package(s) — sole maintainer + >10M weekly downloads. "
        f"Same risk profile as the axios (April 2026) and LiteLLM (March 2026) attacks.\n\n"
        f"Critical: {', '.join(f'`{p}`' for p in critical_packages)}"
    )
elif high_count:
    headline = f"🟡 **{high_count} elevated risk** package(s) found. Review recommended."
else:
    headline = "🟢 All packages pass behavioral commitment checks."

COMMIT_MARKER = "<!-- commit-supply-chain-audit -->"

summary = f"""{COMMIT_MARKER}
## 🔍 Supply Chain Audit

{table}

{headline}

> Scored by [Commit](https://getcommit.dev) — behavioral commitment signals for supply chain trust.
> **CRITICAL** = sole maintainer + >10M weekly downloads (historically high-value attack targets).
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
    print(f"\n✅ Audit passed: {critical_count} CRITICAL packages.")
    sys.exit(0)
PYEOF

EXIT_CODE=$?

# ─── Post PR comment ─────────────────────────────────────────────────────────

SUMMARY_FILE="$TMP_DIR/commit-audit-summary.md"
if [ "${INPUT_COMMENT_ON_PR:-true}" = "true" ] && \
   [ "${GITHUB_EVENT_NAME:-}" = "pull_request" ] && \
   [ -n "${PR_NUMBER:-}" ] && \
   [ -n "${INPUT_GITHUB_TOKEN:-}" ] && \
   [ -f "$SUMMARY_FILE" ]; then

  echo ""
  echo "📝 Posting audit results as PR comment..."

  MARKER="<!-- commit-supply-chain-audit -->"
  COMMENT_BODY=$(cat "$SUMMARY_FILE")

  # Find existing comment with our marker
  EXISTING_COMMENT_ID=$(curl -s \
    -H "Authorization: token $INPUT_GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
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
    ESCAPED_BODY=$(python3 -c "import json, sys; print(json.dumps(sys.stdin.read()))" < "$SUMMARY_FILE")
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      -X PATCH \
      -H "Authorization: token $INPUT_GITHUB_TOKEN" \
      -H "Accept: application/vnd.github.v3+json" \
      -H "Content-Type: application/json" \
      "https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/comments/${EXISTING_COMMENT_ID}" \
      -d "{\"body\": $ESCAPED_BODY}")
    if [ "$HTTP_STATUS" = "200" ]; then
      echo "✅ PR comment updated (comment #$EXISTING_COMMENT_ID)"
    else
      echo "⚠️  Failed to update PR comment (HTTP $HTTP_STATUS)"
    fi
  else
    # Create new comment
    ESCAPED_BODY=$(python3 -c "import json, sys; print(json.dumps(sys.stdin.read()))" < "$SUMMARY_FILE")
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST \
      -H "Authorization: token $INPUT_GITHUB_TOKEN" \
      -H "Accept: application/vnd.github.v3+json" \
      -H "Content-Type: application/json" \
      "https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" \
      -d "{\"body\": $ESCAPED_BODY}")
    if [ "$HTTP_STATUS" = "201" ]; then
      echo "✅ PR comment posted"
    else
      echo "⚠️  Failed to post PR comment (HTTP $HTTP_STATUS)"
    fi
  fi
fi

echo "::endgroup::"
exit $EXIT_CODE
