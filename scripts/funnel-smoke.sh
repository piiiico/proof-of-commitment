#!/usr/bin/env bash
# funnel-smoke.sh — Pre-publish funnel-path gate for proof-of-commitment CLI.
#
# Exercises three key conversion/security paths before npm publish.
# Any path failure exits non-zero, blocking the release.
#
# Paths tested:
#   A: CLI audit with API key → 200 + results (auth-header regression, v1.20.1)
#   B: CLI audit anonymous after RL → 429 + parseable message + instant_key_url
#   C: cursor-hook stdin {command:'npm install lodash'} after RL →
#        permission=ask + signup URL in user_message (silent-allow regression, v1.21.1)
#   D: cursor-hook stdin in CLAUDE CODE PreToolUse format
#        {tool_name:'Bash', tool_input:{command:'npm install lodash'}} after RL →
#        hookSpecificOutput.permissionDecision in (ask|deny)
#        + signup URL referencing claude-code-hook-429 (v1.22.0 dual-client regression)
#   E: cursor-hook stdin in WINDSURF pre_run_command format
#        {agent_action_name:'pre_run_command', tool_info:{command_line:'npm install lodash'}} after RL →
#        exit code 2 (blocked) + stderr contains signup URL with windsurf-hook-429 ref
#
# Each path is driven against a local mock server so the gate is deterministic
# in CI and free of production rate-limit state.
#
# Usage:
#   bash scripts/funnel-smoke.sh [--tarball <path>]
#
# Environment:
#   COMMIT_TEST_API_KEY  (optional) Real API key for positive auth check.
#                        Falls back to a stub "test-key-smoke" value when absent.
#   TARBALL              Path to a pre-built .tgz (overrides --tarball and npm pack).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$SCRIPT_DIR/../npm-package"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tarball) TARBALL="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# ── Setup ──────────────────────────────────────────────────────────────────

SMOKE_DIR="$(mktemp -d /tmp/funnel-smoke-XXXXXX)"
trap 'cleanup' EXIT

cleanup() {
  # Kill mock server if running
  if [[ -n "${MOCK_PID:-}" ]]; then
    kill "$MOCK_PID" 2>/dev/null || true
  fi
  rm -rf "$SMOKE_DIR"
}

echo "━━━  Commit Funnel Smoke  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Smoke dir: $SMOKE_DIR"

# ── Build tarball ──────────────────────────────────────────────────────────

if [[ -n "${TARBALL:-}" ]]; then
  TGZPATH="$TARBALL"
  echo "  Tarball:   $TGZPATH (pre-built)"
else
  echo "  Packing npm-package..."
  cd "$PKG_DIR"
  PACK_OUTPUT=$(npm pack --silent 2>&1)
  TGZNAME=$(echo "$PACK_OUTPUT" | tail -1)
  TGZPATH="$PKG_DIR/$TGZNAME"
  echo "  Packed:    $TGZPATH"
fi

# ── Install CLI from tarball ──────────────────────────────────────────────

INSTALL_DIR="$SMOKE_DIR/install"
mkdir -p "$INSTALL_DIR"
echo "  Installing CLI..."
(cd "$INSTALL_DIR" && npm install --silent "$TGZPATH" 2>&1 | tail -2)
CLI="$INSTALL_DIR/node_modules/.bin/poc"
[[ -x "$CLI" ]] || { echo "✗ CLI binary not found at $CLI"; exit 1; }

# ── Mock HTTP server ──────────────────────────────────────────────────────
#
# Serves two URL patterns:
#   /api/audit          — auth-gate mode: 200 if Authorization present, 401 if not
#   /api/audit-rl       — rate-limit mode: always returns 429 with signup CTA body
#
# This lets the smoke script point each path at a different base URL
# via COMMIT_API_URL without running separate server processes.

MOCK_PORT=18450

python3 - <<'PYEOF' &
import http.server, json, urllib.parse, sys

class MockHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass  # silence access log

    def do_POST(self):
        content_len = int(self.headers.get('Content-Length', 0))
        self.rfile.read(content_len)  # drain body

        path = self.path.split('?')[0]

        if path == '/api/audit':
            # Auth-gate mode: require Authorization header
            auth = self.headers.get('Authorization', '')
            if not auth.startswith('Bearer '):
                body = json.dumps({'error': 'missing or invalid Authorization header'}).encode()
                self.send_response(401)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                body = json.dumps({
                    'count': 1,
                    'results': [{'name': 'react', 'score': 88, 'riskFlags': [], 'ecosystem': 'npm', 'weeklyDownloads': 50000000, 'maintainers': 4, 'ageYears': 11.2}]
                }).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        elif path == '/api/audit-rl':
            # Rate-limit mode: always 429 with CTA fields
            body = json.dumps({
                'message': 'Daily free audit limit reached on this network IP.',
                'instant_key_url': 'https://getcommit.dev/get-started?ref=audit-cli-429',
                'packages_already_scored': [],
                'retry_after_seconds': 86400,
                'shared_ip_hint': False,
            }).encode()
            self.send_response(429)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Retry-After', '86400')
            self.end_headers()
            self.wfile.write(body)

        else:
            self.send_response(404)
            self.end_headers()

server = http.server.HTTPServer(('127.0.0.1', 18450), MockHandler)
server.serve_forever()
PYEOF

MOCK_PID=$!
echo "  Mock server: PID $MOCK_PID on port $MOCK_PORT"

# Wait for the mock to be ready
for i in $(seq 1 20); do
  if python3 -c "import socket; s=socket.socket(); s.connect(('127.0.0.1', 18450)); s.close()" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

AUTH_URL="http://127.0.0.1:${MOCK_PORT}/api/audit"
RL_URL="http://127.0.0.1:${MOCK_PORT}/api/audit-rl"

TEST_KEY="${COMMIT_TEST_API_KEY:-test-key-smoke}"

PASS=0
FAIL=0

pass() { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

echo ""
echo "── Path A: CLI audit with COMMIT_API_KEY → 200 + results (auth-header regression) ──"
echo "   URL: $AUTH_URL"

# With API key set via env var → mock accepts Authorization header → returns 200
PATH_A_OUT=$(COMMIT_API_URL="$AUTH_URL" COMMIT_API_KEY="$TEST_KEY" NO_COLOR=1 "$CLI" react 2>&1 || true)
echo "   Output: $(echo "$PATH_A_OUT" | head -3)"

if echo "$PATH_A_OUT" | grep -qiE "react|score|CRITICAL|HIGH|risk|OK|pass|Scored|✓"; then
  pass "Path A: CLI returned audit results (Authorization header accepted by mock)"
else
  fail "Path A: CLI did not return expected results — auth header regression likely"
  echo "   Full output: $PATH_A_OUT"
fi

# Negative check: without key, mock returns 401 → CLI should not return clean results
PATH_A_ANON=$(COMMIT_API_URL="$AUTH_URL" NO_COLOR=1 "$CLI" react 2>&1 || true)
echo "   Anon output: $(echo "$PATH_A_ANON" | head -2)"

# A correct CLI without auth will get 401 from mock → error, not clean results
if ! echo "$PATH_A_ANON" | grep -qiE "^react|Scored.*react|react.*88|react.*OK"; then
  pass "Path A (negative): CLI did not produce clean results without auth (expected)"
else
  fail "Path A (negative): CLI returned clean results without Authorization header — auditHeaders() missing"
  echo "   Full output: $PATH_A_ANON"
fi

echo ""
echo "── Path B: CLI audit anonymous → 429 + message + instant_key_url ──────────"
echo "   URL: $RL_URL"

# CLI exits non-zero on 429 — capture output and tolerate non-zero exit
PATH_B_OUT=$(COMMIT_API_URL="$RL_URL" NO_COLOR=1 "$CLI" lodash 2>&1 || true)
echo "   Output: $(echo "$PATH_B_OUT" | head -3)"

if echo "$PATH_B_OUT" | grep -qiE "rate.limit|limit.reached|get-started|instant.key|free.*key|429|daily"; then
  pass "Path B: CLI surfaced 429 message with signup CTA"
else
  fail "Path B: CLI did not surface rate-limit message — 429 handling regression"
  echo "   Full output: $PATH_B_OUT"
fi

if echo "$PATH_B_OUT" | grep -q "get-started"; then
  pass "Path B: instant_key_url present in output"
else
  fail "Path B: instant_key_url not found in CLI output — CTA missing"
fi

echo ""
echo "── Path C: cursor-hook RL → permission=ask + signup URL in user_message ───"
echo "   URL: $RL_URL"

# Install the cursor-hook via CLI (writes ~/.commit/cursor-hook.js)
HOOK_HOME="$SMOKE_DIR/home"
mkdir -p "$HOOK_HOME/.commit"
HOOK_SCRIPT="$HOOK_HOME/.commit/cursor-hook.js"

# Extract the embedded hook script from the installed CLI
# We run poc hook --cursor to generate the hook file (uses HOME override)
HOME="$HOOK_HOME" COMMIT_API_URL="$RL_URL" "$CLI" hook --cursor 2>/dev/null || true

if [[ ! -f "$HOOK_SCRIPT" ]]; then
  fail "Path C: cursor-hook.js not generated at $HOOK_SCRIPT"
  echo "   Directory contents: $(ls "$HOOK_HOME/.commit/" 2>/dev/null || echo 'empty')"
else
  echo "   Hook generated: $HOOK_SCRIPT"

  # Run cursor hook with simulated stdin command
  HOOK_INPUT='{"command":"npm install lodash","workingDirectory":"/tmp"}'
  HOOK_OUT=$(echo "$HOOK_INPUT" | HOME="$HOOK_HOME" COMMIT_API_URL="$RL_URL" node "$HOOK_SCRIPT" 2>&1 || true)
  echo "   Output: $HOOK_OUT"

  if echo "$HOOK_OUT" | python3 -c "
import json, sys
try:
    data = json.loads(sys.stdin.read())
    perm = data.get('permission', '')
    msg = data.get('user_message', '')
    assert perm in ('ask', 'deny'), f'permission={perm!r}, expected ask or deny'
    assert 'get-started' in msg or 'cursor-hook-429' in msg or 'getcommit' in msg, f'signup URL not in user_message: {msg!r}'
    print('OK')
except Exception as e:
    print(f'FAIL: {e}')
    sys.exit(1)
" 2>/dev/null | grep -q OK; then
    pass "Path C: cursor-hook returned permission=ask + signup URL in user_message"
  else
    # Detailed failure output
    DETAIL=$(echo "$HOOK_OUT" | python3 -c "
import json, sys
raw = sys.stdin.read()
print('raw:', repr(raw))
try:
    data = json.loads(raw)
    print('permission:', data.get('permission'))
    print('has url:', 'get-started' in data.get('user_message', ''))
except Exception as e:
    print('parse error:', e)
" 2>/dev/null || echo "non-JSON output")
    fail "Path C: cursor-hook regression — silent allow or missing signup URL"
    echo "   Detail: $DETAIL"
  fi

  echo ""
  echo "── Path D: cursor-hook RL via CLAUDE CODE PreToolUse format ──────────────"
  echo "   URL: $RL_URL"

  # Claude Code PreToolUse stdin: {hook_event_name, tool_name, tool_input:{command}}
  # Expected: stdout JSON with hookSpecificOutput.permissionDecision in (ask|deny)
  # and permissionDecisionReason containing the claude-code-hook-429 ref.
  CC_INPUT='{"session_id":"smoke","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"npm install lodash"}}'
  CC_OUT=$(echo "$CC_INPUT" | HOME="$HOOK_HOME" COMMIT_API_URL="$RL_URL" node "$HOOK_SCRIPT" 2>&1 || true)
  echo "   Output: $CC_OUT"

  if echo "$CC_OUT" | python3 -c "
import json, sys
try:
    data = json.loads(sys.stdin.read())
    out = data.get('hookSpecificOutput', {})
    assert out.get('hookEventName') == 'PreToolUse', f'hookEventName={out.get(\"hookEventName\")!r}'
    decision = out.get('permissionDecision', '')
    assert decision in ('ask', 'deny'), f'permissionDecision={decision!r}, expected ask or deny'
    reason = out.get('permissionDecisionReason', '')
    assert 'claude-code-hook-429' in reason or 'get-started' in reason, f'signup URL missing from permissionDecisionReason: {reason!r}'
    # Verify Cursor format NOT used by mistake
    assert 'permission' not in data, 'leaked Cursor-format key permission'
    print('OK')
except Exception as e:
    print(f'FAIL: {e}')
    sys.exit(1)
" 2>/dev/null | grep -q OK; then
    pass "Path D: cursor-hook spoke Claude Code format with claude-code-hook-429 attribution"
  else
    DETAIL=$(echo "$CC_OUT" | python3 -c "
import json, sys
raw = sys.stdin.read()
print('raw:', repr(raw))
try:
    data = json.loads(raw)
    out = data.get('hookSpecificOutput', {})
    print('hookSpecificOutput keys:', list(out.keys()))
    print('permissionDecision:', out.get('permissionDecision'))
    print('ref present:', 'claude-code-hook-429' in out.get('permissionDecisionReason', ''))
except Exception as e:
    print('parse error:', e)
" 2>/dev/null || echo "non-JSON output")
    fail "Path D: Claude Code format regression — wrong shape, decision, or attribution"
    echo "   Detail: $DETAIL"
  fi

  echo ""
  echo "── Path E: cursor-hook RL via WINDSURF pre_run_command format ────────────"
  echo "   URL: $RL_URL"

  # Windsurf pre_run_command stdin: {agent_action_name, tool_info:{command_line}}
  # Expected: exit code 2 (blocked) + stderr contains windsurf-hook-429 ref.
  WS_INPUT='{"agent_action_name":"pre_run_command","tool_info":{"command_line":"npm install lodash","cwd":"/tmp"},"trajectory_id":"smoke"}'
  WS_STDERR="$SMOKE_DIR/ws_stderr.txt"
  WS_EXIT=0
  echo "$WS_INPUT" | HOME="$HOOK_HOME" COMMIT_API_URL="$RL_URL" node "$HOOK_SCRIPT" 2>"$WS_STDERR" || WS_EXIT=$?
  WS_ERR=$(cat "$WS_STDERR")
  echo "   Exit code: $WS_EXIT"
  echo "   Stderr: $(echo "$WS_ERR" | head -3)"

  if [[ "$WS_EXIT" -eq 2 ]]; then
    pass "Path E: Windsurf hook exited with code 2 (blocked)"
  else
    fail "Path E: Windsurf hook exit code=$WS_EXIT, expected 2 (blocked)"
  fi

  if echo "$WS_ERR" | grep -qE "windsurf-hook-429|get-started|getcommit"; then
    pass "Path E: Windsurf hook stderr contains signup URL with windsurf attribution"
  else
    fail "Path E: Windsurf hook stderr missing signup CTA or windsurf-hook-429 ref"
    echo "   Full stderr: $WS_ERR"
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ $FAIL -gt 0 ]]; then
  echo "  GATE BLOCKED — fix the regressions above before publishing."
  exit 1
fi

echo "  GATE PASSED — safe to publish."
