#!/usr/bin/env node
// Skill: destructive-guard. PreToolUse hook for the Bash tool.
// Blocks irreversible commands (data wipes, history rewrites, mass deletes) before they run.
// Usage as hook: reads Claude Code hook JSON on stdin. Usage as CLI: node guard-bash.mjs --cmd "<command>"
import { resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { readHookInput, block, allow, parseArgs } from './lib.mjs';

const SAFE_RM_TARGETS = /^(\.\/)?(node_modules|dist|build|out|\.next|coverage|\.turbo|\.cache|tmp|\.parcel-cache|target|__pycache__|\.pytest_cache)(\/.*)?$/;

export const RULES = [
  // --- databases / ORMs (incidents: claude-code#27063, #33183, Replit Jul-2025)
  { id: 'drizzle-force', re: /drizzle-kit\s+(push\b[^\n]*--force|drop\b)/i, why: 'drizzle-kit push --force / drop skips the data-loss prompt (see anthropics/claude-code#27063: 60+ prod tables wiped).' },
  { id: 'prisma-reset', re: /prisma\s+(migrate\s+reset|db\s+push\b[^\n]*(--force-reset|--accept-data-loss))/i, why: 'prisma migrate reset / db push --force-reset / --accept-data-loss drops data (anthropics/claude-code#33183).' },
  { id: 'sql-drop', re: /\b(DROP\s+(TABLE|DATABASE|SCHEMA|COLUMN)|TRUNCATE\s+(TABLE\s+)?\w)/i, why: 'Raw DROP / TRUNCATE is irreversible.' },
  { id: 'sql-delete-nowhere', re: /\bDELETE\s+FROM\s+[\w."`]+\s*(;|"|'|$)/im, why: 'DELETE FROM without WHERE deletes every row.' },
  { id: 'sql-where-true', re: /\bWHERE\s+(1\s*=\s*1|true)\b/i, why: 'WHERE 1=1 / WHERE true on a write affects all rows.' },
  { id: 'framework-wipe', re: /(rails\s+db:(drop|reset|schema:load)|rake\s+db:(drop|reset)|manage\.py\s+flush|artisan\s+migrate:(fresh|reset)|sequelize(-cli)?\s+db:(drop|migrate:undo:all)|typeorm\s+schema:drop|knex\s+migrate:rollback\s+--all|mongosh?[^\n]*dropDatabase|redis-cli[^\n]*flush(all|db))/i, why: 'Framework command that wipes the database.' },
  { id: 'prod-env-mutation', re: /((railway|heroku|fly|flyctl|vercel|render)\s+(variables?|config|env|secrets)\s*(set|unset|rm|remove|add|:set|:unset)[^\n]*(DATABASE_URL|DB_URL|POSTGRES|MONGO|REDIS))/i, why: 'Changing production database env vars (agent changed DATABASE_URL in claude-code#33183).' },
  // --- git history / working tree
  { id: 'git-reset-hard', re: /\bgit\s+reset\s+[^\n]*--hard/i, why: 'git reset --hard discards uncommitted work.' },
  { id: 'git-clean', re: /\bgit\s+clean\s+-[a-z]*f/i, why: 'git clean -f permanently deletes untracked files.' },
  { id: 'git-force-push', re: /\bgit\s+push\b[^\n]*(\s-f\b|--force(?!-with-lease)|\s\+\w)/i, why: 'git push --force rewrites remote history (use --force-with-lease on your own branch, after asking).' },
  { id: 'git-discard-all', re: /\bgit\s+(checkout\s+--\s+\.|restore\s+(--staged\s+)?(--worktree\s+)?\.(\s|$)|stash\s+(drop|clear))/i, why: 'Discards all local changes / stashes.' },
  { id: 'git-branch-D', re: /\bgit\s+branch\s+-D\s+(main|master|develop|production|prod|release)\b/i, why: 'Force-deleting a protected branch.' },
  // --- filesystem / system
  { id: 'find-delete', re: /\bfind\s+(\/|~|\$HOME|\.\.)[^\n]*(-delete|-exec\s+rm)/i, why: 'find ... -delete outside the project.' },
  { id: 'disk', re: /(\bmkfs(\.\w+)?\b|\bdd\s+[^\n]*of=\/dev\/|>\s*\/dev\/sd[a-z])/i, why: 'Writes to a raw disk device.' },
  { id: 'chmod-777', re: /\bchmod\s+-R\s+0?777\s+(\/|~|\$HOME)/i, why: 'Recursive 777 on system/home paths.' },
  { id: 'pipe-to-shell', re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/i, why: 'Piping a remote script into a shell executes unreviewed code.' },
  // --- infra
  { id: 'infra-destroy', re: /(terraform\s+(destroy|apply\b[^\n]*-auto-approve)|pulumi\s+destroy|kubectl\s+delete\s+(ns|namespace|pv|pvc|--all)|aws\s+s3\s+(rb|rm\s+[^\n]*--recursive)|gcloud\s+[^\n]*\sdelete\b[^\n]*--quiet)/i, why: 'Destroys cloud infrastructure or data.' },
];

function rmCheck(cmd, cwd) {
  // Inspect every rm invocation with recursive+force semantics.
  const segs = cmd.split(/&&|\|\||;|\n|\|/);
  for (const seg of segs) {
    const m = seg.trim().match(/^(sudo\s+)?rm\s+(.*)$/);
    if (!m) continue;
    const parts = m[2].split(/\s+/).filter(Boolean);
    const flags = parts.filter(p => p.startsWith('-')).join('');
    const recursive = /r|R|--recursive/.test(flags);
    if (!recursive) continue;
    const targets = parts.filter(p => !p.startsWith('-'));
    if (targets.length === 0) continue;
    for (let t of targets) {
      t = t.replace(/^["']|["']$/g, '');
      if (/^(\/|~|\$HOME|\$\{HOME\}|\*|\.|\.\.|\.\/\*|\.\.\/.*|\/\*)$/.test(t) || t === '~/' || t === './') {
        return `rm -r on "${t}" would delete everything in that location.`;
      }
      if (/[$`]/.test(t) && !/^\$\{?PWD\}?\//.test(t)) {
        return `rm -r with an unexpanded variable "${t}". If it is empty this becomes rm -rf / (classic incident). Expand and echo it first.`;
      }
      if (SAFE_RM_TARGETS.test(t)) continue;
      const abs = isAbsolute(t) ? t : resolve(cwd, t.replace(/^~(?=\/)/, homedir()));
      if (t.startsWith('~')) return `rm -r inside the home directory ("${t}").`;
      if (!abs.startsWith(resolve(cwd) + '/')) return `rm -r outside the project directory ("${t}").`;
      if (/(^|\/)(\.git|src|app|lib|prisma|migrations|db|data|public|pages|components)(\/)?$/.test(t)) {
        return `rm -r on a core project directory ("${t}"). Delete specific files instead.`;
      }
    }
  }
  return null;
}

export function check(cmd, cwd = process.cwd()) {
  if (!cmd || typeof cmd !== 'string') return null;
  const hits = [];
  for (const r of RULES) if (r.re.test(cmd)) hits.push(`${r.id}: ${r.why}`);
  const rm = rmCheck(cmd, cwd);
  if (rm) hits.push(`rm-recursive: ${rm}`);
  return hits.length ? hits : null;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.cmd) {
    const hits = check(args.cmd, args.cwd || process.cwd());
    console.log(hits ? `BLOCK\t${args.cmd}\n  - ${hits.join('\n  - ')}` : `ALLOW\t${args.cmd}`);
    process.exit(hits ? 2 : 0);
  }
  const input = readHookInput();
  const cmd = input?.tool_input?.command;
  const hits = check(cmd, input?.cwd || process.cwd());
  if (hits) block(`${hits.join(' | ')}\nThis command is irreversible. Do NOT retry it, reword it, or split it to get around this check. Stop, explain to the user what you wanted to do and why, and ask them to run it themselves if they really want it.`);
  allow();
}
