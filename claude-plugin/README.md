# Commit — Claude Code Plugin

Supply chain gate for Claude Code. Scores npm, PyPI, Cargo, and Go packages on behavioral commitment signals before your AI assistant installs them.

## What it does

When Claude Code runs `npm install`, `pip install`, `cargo add`, or `go get`, this plugin intercepts the command via a `PreToolUse` hook and scores every package against [getcommit.dev](https://getcommit.dev):

- **CRITICAL** → blocked (sole npm publisher + >10M downloads/week — the LiteLLM/axios attack profile)
- **HIGH** → asks you to confirm
- **Clean** → allowed immediately

The Shai-Hulud worm (May 2026) compromised 637 packages in 39 minutes and specifically targeted AI coding assistants. This plugin puts a gate back in — no install runs without a score.

## Install

```
/plugin install commit@claude-plugins-community
```

No API key required. Runs in under 500ms per install command.

## With an API key

Rate limit is 200 audits/day on the free tier. Sign up at [getcommit.dev/get-started](https://getcommit.dev/get-started) and set `COMMIT_API_KEY` in your environment — the hook reads it automatically.

## Links

- [Blog: Supply chain gate for Cursor + Claude Code](https://getcommit.dev/blog/cursor-hook-supply-chain-gate)
- [npm: proof-of-commitment](https://www.npmjs.com/package/proof-of-commitment)
- [Source](https://github.com/piiiico/proof-of-commitment)
