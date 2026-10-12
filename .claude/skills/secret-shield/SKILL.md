---
name: secret-shield
description: "Keeps API keys and credentials out of the transcript and out of git: blocks reading .env/key files, dumping env vars, echoing tokens, and staging .env; scans the repo or the current diff for hard-coded secrets (values redacted). Use before commits and whenever credentials are involved."
---

# Secret shield

**Why:** anthropics/claude-code#30731: the agent read `/proc/*/environ` and `.env`, printed keys into the transcript and hard-coded them into curl commands.

## Enforced (PreToolUse hook on Bash, Read, Grep, Edit, Write)
Blocks: `cat/head/grep .env*` (except `.env.example`), key files (`*.pem`, `id_rsa`, `credentials.json`, `.npmrc`), `printenv`/`env` dumps, `/proc/*/environ`, `echo $SOME_TOKEN`, `git add .env`.

## How to work with secrets safely
- Presence check: `test -n "$STRIPE_SECRET_KEY" && echo set || echo missing`
- List key **names**: `cut -d= -f1 .env` or `sed 's/=.*//' .env`
- In code: read from `process.env.X`, never inline literals. Add new names to `.env.example` with an empty value.
- Need a real value? Ask the user to export it in their shell. Never ask them to paste it in chat.

## Before every commit
```bash
node .claude/agent-kit/bin/secret-shield.mjs scan . --diff   # only what you changed
node .claude/agent-kit/bin/secret-shield.mjs scan .          # full repo audit
```
Findings print redacted values (`sk_l…9f (32 chars)`). If anything real is found: remove it, tell the user to **rotate** the key (removal alone is not enough once it's in history).
