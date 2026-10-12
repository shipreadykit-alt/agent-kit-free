---
name: verify-before-done
description: "Use before saying a task is done, fixed, working or that tests pass. Detects the repo's real test/typecheck/lint commands, runs them, and records a receipt tied to the exact working tree; a Stop hook blocks success claims without a fresh passing receipt."
---

# Verify before done

**Why:** "silent fake success" is the #1 time sink reported by daily users (r/ClaudeAI), and there are documented cases of fabricated `ALL PASSED` summaries (anthropics/claude-code#46940, #11913).

## Procedure (every coding task)
1. `node .claude/agent-kit/bin/detect-checks.mjs`: see the exact commands for this repo (from package.json / configs). Never guess commands.
2. `node .claude/agent-kit/bin/run-verify.mjs`: runs typecheck, lint and tests (add `--build` for build, `--only test` to narrow). Writes `.claude/agent-kit/last-verify.json` with exit codes plus a hash of the current working tree.
3. In your final message, **paste the final `VERIFY ...` line verbatim**, plus the failing test names if any.
4. If something fails: say so plainly, show the error, and fix the code. Never edit tests to match broken code (see `test-integrity`).
5. If the repo has no tests: write "not verified by tests" and describe what you actually checked (typecheck, a curl, a script).

## Enforcement
The Stop hook (`stop-verify.mjs`) reads your last message. If you changed files and claim success ("done", "all tests pass", "fixed", "ready for review", ✅) without a passing receipt **for the current tree**, it blocks the stop and sends you back to run the checks. Editing files after verifying invalidates the receipt.
