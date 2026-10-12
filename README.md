# Ship-Ready Agent Kit: free safety pack

**Guardrails that make AI coding agents tell the truth.** Five guardrails for **Claude Code** (enforced with hooks) and **Cursor** (always-on rules plus the same scripts).

- Plain Node 18+.
- Zero dependencies.
- Nothing leaves your machine.

> Prompts are suggestions. Hooks are enforcement.

## What's in the free pack

| Guardrail | What it blocks or flags | How |
|---|---|---|
| **verify-before-done** | The agent says "done" or "all tests pass" without a fresh, passing test run for the *current* code. Also blocks stale results (code edited after testing) and fake `test` scripts like `echo ok && exit 0`. | `Stop` hook + `run-verify.mjs` receipt (exit codes + working-tree hash) |
| **test-integrity** | Weakened tests in the diff: `.skip`/`.only`, deleted assertions, changed expected values, deleted test files, `"test": "jest \|\| true"` | Diff checker; also consulted by the Stop hook |
| **fail-loud** | Error-hiding code: empty `catch {}`, catch → `return []` / mock data, log-and-continue, `.catch(() => {})`, Python `except: pass` | Source scanner (`--diff` for changed files only) |
| **destructive-guard** | Dangerous shell commands, for example:<br>• Database: `prisma migrate reset`, `db push --accept-data-loss`, `drizzle-kit push --force`, `DROP`/`TRUNCATE`, unscoped `DELETE`<br>• Git: `git reset --hard`, `git push --force`, `git clean -fdx`<br>• Files and infra: `rm -rf` outside build dirs, `curl \| bash`, `terraform destroy` | `PreToolUse` hook on Bash (exit 2 = blocked, with a reason) |
| **secret-shield** | Reading `.env*` / key files, `printenv` / `env`, `echo $API_KEY`, `/proc/*/environ`, `git add .env`. It also scans for hardcoded keys (Stripe, AWS, OpenAI, GitHub, DB URLs with passwords…), with values redacted. | `PreToolUse` hook on Bash/Read/Edit + scanner |

Safe alternatives stay allowed. For example:
- `rm -rf node_modules`
- `git push --force-with-lease`
- `cat .env.example`
- `cut -d= -f1 .env` (key names only)
- `test -n "$OPENAI_API_KEY"`

## Install (about 1 minute)

```bash
git clone https://github.com/shipreadykit-alt/agent-kit-free.git
node agent-kit-free/install.mjs /path/to/your/project            # add --dry-run to preview
```

What the installer does:
- Copies the scripts into `.claude/agent-kit/bin/`, the skills into `.claude/skills/`, and a Cursor rule into `.cursor/rules/`.
- **Merges** the hooks into your existing `.claude/settings.json`. It never overwrites, and it's safe to re-run.
- Adds the verification receipt to `.gitignore`.

Then restart Claude Code, or check with `/hooks`. In Cursor, the rule is always applied.

## Use

```bash
node .claude/agent-kit/bin/run-verify.mjs                 # run your real test/lint/build, write a receipt
node .claude/agent-kit/bin/test-integrity.mjs             # check the diff for weakened tests
node .claude/agent-kit/bin/fail-loud.mjs --diff           # check changed files for hidden errors
node .claude/agent-kit/bin/secret-shield.mjs scan . --diff
node .claude/agent-kit/bin/guard-bash.mjs --cmd "git push -f origin main"   # see what would be blocked
```

## Tests

```bash
node --test tests/
```

## Limits (honest)

- These are pattern-based guardrails, not a sandbox. A determined agent can find commands the patterns don't cover. Keep backups, keep production credentials off dev machines, and review diffs.
- The Stop hook decides when the agent is *claiming* success by matching phrases. Unusual wording can slip past it.
- Cursor has no equivalent of Claude Code's blocking hooks here. There the rule *instructs* the agent to run the scripts, and CI is your enforcement.

## Full kit

The full **Ship-Ready Agent Kit** adds:
- **dep-verify**: blocks hallucinated or typo-squatted packages ("slopsquatting")
- **migration-safety**: reviews SQL migrations for drops, locks and unsafe renames
- **context-pack**: one `AGENTS.md` → `CLAUDE.md` + Cursor rules, with a drift check
- more as they ship

→ **https://shipreadykit-alt.github.io**

## License

MIT © 2026 Ship-Ready
