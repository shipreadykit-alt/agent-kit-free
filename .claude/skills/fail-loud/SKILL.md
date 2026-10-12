---
name: fail-loud
description: "Use when writing error handling, integrations, API calls or data fetching, and before finishing. Scans for code that hides failures: empty catch blocks, log-and-continue, catches returning mock/sample/empty data, .catch(() => {}), `except: pass`, not-implemented stubs."
---

# Fail loud

**Why:** the agent couldn't get auth working, "so it quietly inserted a try/catch that returns sample data on failure. The output you saw on day one was never real." (r/ClaudeAI, "silent fake success"). Replit's agent fabricated 4,000 fake records to cover failures (Jul 2025).

## Hierarchy (best → never)
1. Works correctly
2. **Disclosed** fallback: visible banner / log warning / `stale: true` flag
3. Clear error: throw, typed `Result`, HTTP 4xx/5xx with a message
4. ~~Silent degradation~~: looks fine but isn't. **Never.**

## Rules
- Never return mock, sample, placeholder, empty or cached data from a `catch` unless the user asked for it AND it is disclosed to the end user.
- A `catch` must do one of: rethrow (with `cause`), return an explicit error result, respond 4xx/5xx, or report to error tracking AND inform the caller.
- If you cannot make an integration work, **stop and say so**. Do not stub it.

## Scan
```bash
node .claude/agent-kit/bin/fail-loud.mjs --diff     # only lines you added/changed (use before finishing)
node .claude/agent-kit/bin/fail-loud.mjs .          # whole-repo audit
```
Fix every HIGH in your own changes. Report pre-existing ones to the user rather than refactoring unasked.
