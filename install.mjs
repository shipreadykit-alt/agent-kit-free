#!/usr/bin/env node
// Ship-Ready free safety pack installer: copies skills, scripts and Cursor rules into a project and MERGES hooks into
// .claude/settings.json (never overwrites your existing settings). Usage: node install.mjs /path/to/project [--dry-run]
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(process.argv[2] || '.');
const dry = process.argv.includes('--dry-run');
if (!existsSync(join(target, '.git')) && !existsSync(join(target, 'package.json'))) { console.error(`✗ ${target} doesn't look like a project (no .git or package.json)`); process.exit(1); }
const copy = (from, to) => { console.log(`  + ${to}`); if (!dry) { mkdirSync(dirname(join(target, to)), { recursive: true }); cpSync(join(here, from), join(target, to), { recursive: true }); } };
console.log(`Installing Ship-Ready free safety pack → ${target}${dry ? ' (dry run)' : ''}`);
copy('.claude/agent-kit/bin', '.claude/agent-kit/bin');
copy('.claude/skills', '.claude/skills');
copy('.cursor/rules/agent-kit-guardrails.mdc', '.cursor/rules/agent-kit-guardrails.mdc');
const kit = JSON.parse(readFileSync(join(here, '.claude/settings.json'), 'utf8'));
const sp = join(target, '.claude/settings.json');
const cur = existsSync(sp) ? JSON.parse(readFileSync(sp, 'utf8')) : {};
cur.hooks = cur.hooks || {};
for (const [ev, groups] of Object.entries(kit.hooks)) {
  cur.hooks[ev] = cur.hooks[ev] || [];
  for (const g of groups) {
    const have = new Set(cur.hooks[ev].flatMap(x => (x.hooks || []).map(h => `${x.matcher || ''}::${h.command}`)));
    const fresh = { ...g, hooks: g.hooks.filter(h => !have.has(`${g.matcher || ''}::${h.command}`)) };
    if (fresh.hooks.length) cur.hooks[ev].push(fresh);
  }
}
console.log(`  ~ .claude/settings.json (hooks merged: ${Object.keys(kit.hooks).join(', ')})`);
if (!dry) writeFileSync(sp, JSON.stringify(cur, null, 2) + '\n');
const gi = join(target, '.gitignore');
if (!dry && (!existsSync(gi) || !readFileSync(gi, 'utf8').includes('last-verify.json'))) writeFileSync(gi, (existsSync(gi) ? readFileSync(gi, 'utf8').replace(/\n?$/, '\n') : '') + '.claude/agent-kit/last-verify.json\n');
console.log('\nDone. Restart Claude Code (or run /hooks) to load the hooks. Try: node .claude/agent-kit/bin/run-verify.mjs');
console.log('Full kit (dep-verify, migration-safety, context-pack + more): https://shipreadykit-alt.github.io');
