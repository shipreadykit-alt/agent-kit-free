#!/usr/bin/env node
// Skill: fail-loud. Finds code that hides failures: empty catches, log-and-continue, catches that return
// fake/sample/empty data, .catch(() => {}), `except: pass`, and "not implemented" stubs.
// Evidence: r/ClaudeAI "the biggest time sink is silent fake success" (agent inserted try/catch returning sample data);
// Replit incident (agent fabricated 4,000 fake records to cover failures).
// Usage: node fail-loud.mjs [root] [--diff [--base HEAD]] [--json]
import { readHookInput, parseArgs, walk, safeRead, rel, git } from './lib.mjs';
import { join } from 'node:path';

const CODE = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py'];
const TESTY = /(\.(test|spec)\.|__tests__|\/tests?\/|\/e2e\/|\/mocks?\/|fixtures?|\.stories\.|seed)/;

function blockAfter(src, idx) {
  const open = src.indexOf('{', idx); if (open < 0 || open - idx > 80) return null;
  let depth = 0;
  for (let i = open; i < src.length && i < open + 4000; i++) {
    const c = src[i];
    if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) return { start: open, end: i, body: src.slice(open + 1, i) }; }
  }
  return null;
}
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

export function scanSource(src, file) {
  const f = []; const add = (line, severity, rule, detail) => f.push({ file, line, severity, rule, detail });
  if (file.endsWith('.py')) {
    src.split('\n').forEach((l, i, a) => {
      if (/^\s*except(\s+(Exception|BaseException)(\s+as\s+\w+)?)?\s*:\s*(pass)?\s*$/.test(l)) {
        const next = (a[i + 1] || '').trim();
        if (/pass\s*$/.test(l) || next === 'pass' || next === '...') add(i + 1, 'high', 'swallowed-exception', `${l.trim()} ${next}`.trim());
        else if (/^return\s+(None|\[\]|\{\}|""|''|0|False)\s*$/.test(next)) add(i + 1, 'medium', 'catch-returns-empty', `${l.trim()} → ${next}`);
      }
      if (/raise\s+NotImplementedError/.test(l) && !TESTY.test(file)) add(i + 1, 'low', 'not-implemented', l.trim());
    });
    return f;
  }
  const re = /\bcatch\s*(\(([^)]*)\))?\s*\{/g; let m;
  while ((m = re.exec(src))) {
    const b = blockAfter(src, m.index); if (!b) continue;
    const body = b.body.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const line = lineOf(src, m.index);
    const rethrows = /\b(throw|reject\(|next\(\s*\w+|process\.exit|res\.status\(\s*[45]\d\d|status:\s*[45]\d\d|return\s+(NextResponse|Response|new Response|res)\b[^;]*[45]\d\d|notFound\(\)|redirect\(|captureException|Sentry\.|logger\.(error|fatal)|setError|toast\.error|return\s*\{\s*(error|ok:\s*false|success:\s*false))/;
    if (!body) { add(line, 'high', 'empty-catch', 'catch block is empty: the error disappears'); continue; }
    if (/\b(mock|fake|sample|dummy|placeholder|fallback|stub|demo)\w*/i.test(body) && /return|=/.test(body) && !rethrows.test(body)) { add(line, 'high', 'catch-returns-fake-data', body.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 2).join(' ')); continue; }
    if (rethrows.test(body)) continue;
    if (/^\s*(return\s*(\[\s*\]|\{\s*\}|null|undefined|false|0|''|""|``)?\s*;?\s*)$/.test(body)) { add(line, 'medium', 'catch-returns-empty', `catch → ${body}  (caller cannot tell "no data" from "failed")`); continue; }
    if (/console\.(log|warn|error|info|debug)/.test(body) && !/\breturn\b/.test(body)) { add(line, 'medium', 'log-and-continue', 'error is only logged, execution continues as if it succeeded'); continue; }
    if (/console\.(log|warn|error)/.test(body) && /return\s*(\[\s*\]|\{\s*\}|null|undefined|false)/.test(body)) add(line, 'medium', 'catch-returns-empty', 'logs then returns an empty value');
  }
  const pc = /\.catch\(\s*(\(\s*\w*\s*\)|\w+)\s*=>\s*(\{\s*\}|null|undefined|\[\s*\]|\{\s*\}\s*\)|console\.\w+\([^)]*\))\s*\)|\.catch\(\s*(console\.(log|error|warn)|noop|\(\)\s*=>\s*\{\s*\})\s*\)/g;
  while ((m = pc.exec(src))) add(lineOf(src, m.index), m[0].includes('console') ? 'medium' : 'high', 'promise-catch-swallow', m[0].replace(/\s+/g, ' '));
  if (!TESTY.test(file)) {
    const nre = /throw new Error\(\s*['"`](not implemented|todo|unimplemented)[^'"`]*['"`]\s*\)|\/\/\s*TODO:?\s*(implement|real|actually|replace (with|this))|\b(const|let)\s+(mock|fake|dummy|sample)[A-Z]\w*\s*=/gi;
    while ((m = nre.exec(src))) add(lineOf(src, m.index), 'low', 'stub-or-mock-in-prod', m[0]);
  }
  return f;
}

export function addedLines(root, base = 'HEAD') {
  const d = git(['diff', '--unified=0', '--no-color', base], root);
  const map = {}; let file = null;
  for (const l of d.split('\n')) {
    if (l.startsWith('+++ b/')) { file = l.slice(6); map[file] = map[file] || new Set(); }
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h && file) { const s = +h[1], n = h[2] === undefined ? 1 : +h[2]; for (let i = s; i < s + n; i++) map[file].add(i); }
  }
  for (const u of git(['ls-files', '--others', '--exclude-standard'], root).split('\n').filter(Boolean)) map[u] = 'all';
  return map;
}

export function scanRepo(root, { diff = false, base = 'HEAD' } = {}) {
  let files = walk(root, { exts: CODE });
  let lines = null;
  if (diff) { lines = addedLines(root, base); files = Object.keys(lines).filter(f => CODE.some(e => f.endsWith(e))).map(f => join(root, f)); }
  const out = [];
  for (const p of files) {
    const r = rel(root, p);
    if (r.startsWith('.claude/')) continue;
    let fs = scanSource(safeRead(p), r);
    if (TESTY.test(r)) fs = fs.filter(x => x.severity === 'high' && x.rule !== 'stub-or-mock-in-prod');
    if (lines) fs = fs.filter(x => lines[r] === 'all' || lines[r]?.has(x.line));
    out.push(...fs);
  }
  return out;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const root = args._[0] || args.root || process.cwd();
  const f = scanRepo(root, { diff: !!args.diff, base: args.base || 'HEAD' });
  if (args.json) console.log(JSON.stringify(f, null, 2));
  else {
    console.log(`fail-loud: ${root}${args.diff ? ' (new/changed lines only)' : ''}`);
    if (!f.length) console.log('  ✓ no silent-failure patterns found');
    for (const x of f) console.log(`  [${x.severity.toUpperCase()}] ${x.rule.padEnd(24)} ${x.file}:${x.line}  ${x.detail}`);
    const c = s => f.filter(x => x.severity === s).length;
    console.log(`  total: ${f.length} (high ${c('high')}, medium ${c('medium')}, low ${c('low')})`);
  }
  process.exit(f.some(x => x.severity === 'high') ? 1 : 0);
}
