---
name: destructive-guard
description: "Blocks irreversible shell commands (DB wipes like drizzle-kit push --force / prisma migrate reset, DROP/TRUNCATE, git reset --hard, force-push, rm -rf outside build dirs, terraform destroy). Always active via a PreToolUse hook; use this skill when planning anything that deletes data, rewrites git history or touches production."
---

# Destructive-command guard

**Why:** real incidents. `drizzle-kit push --force` wiped 60+ production tables (anthropics/claude-code#27063), `prisma db push` accepted a reset (#33183), and Replit's agent dropped a live DB during a code freeze (Fortune, Jul 2025).

## What is enforced (hook, cannot be bypassed by the model)
`.claude/settings.json` runs `.claude/agent-kit/bin/guard-bash.mjs` before every Bash call. Exit code 2 blocks the call and the reason is shown to you.

## Your rules
1. If a command is blocked, **do not** retry, reword, split, encode or wrap it to get past the guard. That is the exact failure mode this exists for.
2. Explain to the user what you wanted to do, why, and what data/history it would destroy. Propose a safe alternative:
   - schema change → `prisma migrate dev --name x` (local) / `prisma migrate deploy` (CI); drizzle → `drizzle-kit generate` + review SQL
   - discard changes → `git stash push -m "agent backup"` instead of `reset --hard`
   - rewrite remote → `git push --force-with-lease` on your own feature branch, only after asking
   - cleanup → delete specific paths inside the project (build dirs are allowed)
3. Before ANY migration or data operation, confirm which database `DATABASE_URL` points at **by host name only** (never print the full URL).

## Manual check
`node .claude/agent-kit/bin/guard-bash.mjs --cmd "<command>"` prints ALLOW/BLOCK with the reason.
