#!/usr/bin/env node
// Skill: test-integrity. Diff analyzer that catches an agent "making tests pass" by weakening them:
// skipped/focused tests, deleted assertions, deleted test files, tautologies, changed expectations,
// ignored paths, `|| true` in test scripts. Evidence: anthropics/claude-code#319, #7074 ("safe-tests").
// Usage: node test-integrity.mjs [--base <ref>] [--root <dir>] [--json]
import { git, parseArgs } from './lib.mjs';

const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(__tests__|tests?|e2e|spec)\/.*\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$|\.snap$)/;
const ASSERT = /\b(expect\s*\(|assert(\.\w+)?\s*\(|assert\s+[^=]|\.should\b|t\.(equal|deepEqual|is|ok|true|false|throws)\s*\(|require\.(Equal|NoError)|self\.assert\w*\()/;
const SKIP = /\b((it|test|describe|context)\.(skip|todo)\s*\(|x(it|test|describe)\s*\(|@pytest\.mark\.(skip|xfail)|pytest\.skip\(|t\.Skip\(|@Disabled|@Ignore|\.skip\s*=\s*true)/;
const ONLY = /\b(it|test|describe|context)\.only\s*\(|\bf(it|describe)\s*\(/;
const TAUTOLOGY = /expect\(\s*(true|1|['"][^'"]*['"])\s*\)\.(toBe|toEqual)\(\s*\1\s*\)|assert\s+True\b|assert\(true\)|expect\(\s*\w+\s*\)\.toBe\(\s*\w+\s*\)\s*;?\s*\/\/\s*placeholder/;
const WEAKEN = /(\.not\.toThrow\(\)|toBeDefined\(\)|toBeTruthy\(\)|expect\.anything\(\)|@ts-(ignore|expect-error)|eslint-disable)/;
const CONFIG = /(testPathIgnorePatterns|modulePathIgnorePatterns|coveragePathIgnorePatterns|--passWithNoTests|passWithNoTests|exclude\s*:|testIgnore|--testPathIgnorePatterns|coverageThreshold|branches\s*:\s*\d|lines\s*:\s*\d|--bail=0|continue-on-error:\s*true)/;

export function parseDiff(diff) {
  const files = []; let cur = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) { cur = { file: line.split(' b/')[1], add: [], del: [], deleted: false, created: false }; files.push(cur); }
    else if (!cur) continue;
    else if (line.startsWith('deleted file')) cur.deleted = true;
    else if (line.startsWith('new file')) cur.created = true;
    else if (line.startsWith('+++') || line.startsWith('---')) continue;
    else if (line.startsWith('+')) cur.add.push(line.slice(1));
    else if (line.startsWith('-')) cur.del.push(line.slice(1));
  }
  return files;
}

const matcherOf = l => (l.match(/\.(to\w+|assert\w*)\s*\(/) || [])[1];

export function analyze(diff) {
  const findings = [];
  const push = (severity, file, rule, detail) => findings.push({ severity, file, rule, detail });
  for (const f of parseDiff(diff)) {
    const isTest = TEST_FILE.test(f.file);
    const isPkg = /(^|\/)package\.json$/.test(f.file);
    const isCfg = /(jest|vitest|playwright|karma|mocha|pytest|tox|setup)\.(config\.)?[\w.]*$|(^|\/)\.github\/workflows\/|pyproject\.toml$|\.mocharc/.test(f.file);
    if (isTest) {
      if (f.deleted) { push('high', f.file, 'test-file-deleted', `entire test file deleted (${f.del.filter(l => ASSERT.test(l)).length} assertions)`); continue; }
      if (f.file.endsWith('.snap')) { if (f.del.length > 20) push('medium', f.file, 'snapshot-rewritten', `${f.del.length} snapshot lines replaced; confirm the UI change is intended`); continue; }
      const aDel = f.del.filter(l => ASSERT.test(l)).length, aAdd = f.add.filter(l => ASSERT.test(l)).length;
      if (aDel > aAdd) push(aDel - aAdd >= 3 ? 'high' : 'medium', f.file, 'assertions-removed', `${aDel} assertion lines removed, ${aAdd} added (net −${aDel - aAdd})`);
      f.add.filter(l => SKIP.test(l)).forEach(l => push('high', f.file, 'test-skipped', l.trim()));
      f.add.filter(l => ONLY.test(l)).forEach(l => push('high', f.file, 'test-focused-only', `${l.trim()} (.only silently disables every other test)`));
      f.add.filter(l => TAUTOLOGY.test(l)).forEach(l => push('high', f.file, 'tautology', l.trim()));
      f.add.filter(l => WEAKEN.test(l) && !f.del.some(d => d.trim() === l.trim())).forEach(l => push('low', f.file, 'weaker-assertion', l.trim()));
      // changed expected values: same matcher removed and re-added with different literal
      const delM = f.del.filter(l => ASSERT.test(l)).map(l => [matcherOf(l), l.trim()]);
      for (const a of f.add.filter(l => ASSERT.test(l))) {
        const m = matcherOf(a); const prev = delM.find(([dm, dl]) => dm && dm === m && dl !== a.trim() && dl.split('(')[0] === a.trim().split('(')[0]);
        if (prev) push('medium', f.file, 'expectation-changed', `${prev[1]}  →  ${a.trim()}  (did the spec change, or was the test bent to the code?)`);
      }
      const catchAdd = f.add.filter(l => /catch\s*(\(\w*\))?\s*\{\s*\}?$/.test(l.trim())).length;
      if (catchAdd) push('medium', f.file, 'try-catch-in-test', `${catchAdd} try/catch added inside tests (can swallow assertion failures)`);
    }
    if (isPkg) {
      const sAdd = f.add.filter(l => /"test[\w:-]*"\s*:/.test(l));
      for (const l of sAdd) if (/(\|\|\s*(true|exit 0)|exit 0|--passWithNoTests|echo\s)/.test(l)) push('high', f.file, 'test-script-neutered', l.trim());
      if (f.del.some(l => /"test"\s*:/.test(l)) && !sAdd.length) push('high', f.file, 'test-script-removed', 'scripts.test removed');
    }
    if (isCfg || isPkg) f.add.filter(l => CONFIG.test(l)).forEach(l => push('medium', f.file, 'test-config-loosened', l.trim()));
  }
  return findings;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root || process.cwd();
  const base = args.base || 'HEAD';
  const diff = git(['diff', '--no-color', '--unified=0', base, '--', '.'], root) + (base === 'HEAD' ? git(['diff', '--cached', '--no-color', '--unified=0'], root) : '');
  const f = analyze(diff);
  if (args.json) console.log(JSON.stringify(f, null, 2));
  else {
    console.log(`test-integrity: ${root} (diff vs ${base})`);
    if (!f.length) console.log('  ✓ no test-weakening patterns found');
    for (const x of f) console.log(`  [${x.severity.toUpperCase()}] ${x.rule}  ${x.file}\n      ${x.detail}`);
    console.log(`  total: ${f.length} (high: ${f.filter(x => x.severity === 'high').length})`);
  }
  process.exit(f.some(x => x.severity === 'high') ? 1 : 0);
}
