#!/usr/bin/env node
// Skill: verify-before-done (part 1). Detects the real test / typecheck / lint / build commands for a repo.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, parseArgs } from './lib.mjs';

export function detect(root = process.cwd()) {
  const has = f => existsSync(join(root, f));
  const checks = [];
  const notes = [];
  let pm = null;
  if (has('package.json')) {
    pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : (has('bun.lockb') || has('bun.lock')) ? 'bun' : 'npm';
    const pkg = readJSON(join(root, 'package.json')) || {};
    const s = pkg.scripts || {};
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const run = name => (pm === 'npm' ? `npm run ${name}` : `${pm} ${name}`);
    const NEUTERED = /(^\s*echo\b(?![^&|;]*&&\s*\w+\s+(?!exit)))|(\|\|\s*(true|exit\s+0|:))|(^|&&|;)\s*exit\s+0\s*$|^\s*(true|:)\s*$/;
    const pick = (kind, names) => { for (const n of names) if (s[n] && kind === 'test' && NEUTERED.test(s[n])) { notes.push(`scripts.${n} = "${s[n]}" is NOT a real test command (echo / exit 0 / || true). Treat the repo as untested and report it.`); return false; } else if (s[n] && !/no test specified/.test(s[n])) { checks.push({ kind, cmd: run(n), source: `package.json scripts.${n} = "${s[n]}"` }); return true; } return false; };
    pick('typecheck', ['typecheck', 'type-check', 'tsc', 'check-types', 'types']);
    pick('lint', ['lint']);
    if (!pick('test', ['test:unit', 'test', 'test:ci'])) {
      if (deps.vitest) checks.push({ kind: 'test', cmd: `${pm === 'npm' ? 'npx' : pm + ' exec'} vitest run`, source: 'vitest in devDependencies (no test script)' });
      else if (deps.jest || has('jest.config.js') || has('jest.config.ts')) checks.push({ kind: 'test', cmd: `${pm === 'npm' ? 'npx' : pm + ' exec'} jest`, source: 'jest config/dependency (no test script)' });
      else notes.push('No unit-test runner found. "Tests pass" cannot be claimed for this repo; say so explicitly.');
    }
    if (!checks.some(c => c.kind === 'typecheck') && (has('tsconfig.json') && deps.typescript)) checks.push({ kind: 'typecheck', cmd: `${pm === 'npm' ? 'npx' : pm + ' exec'} tsc --noEmit -p .`, source: 'tsconfig.json + typescript dependency' });
    pick('build', ['build']);
    if (deps['@playwright/test'] || deps.cypress) notes.push('E2E suite present (playwright/cypress); run it for UI changes.');
    if (!has('node_modules')) notes.push(`node_modules missing; install first: ${pm === 'npm' ? 'npm ci' : pm + ' install --frozen-lockfile'}`);
  }
  if (has('pyproject.toml') || has('pytest.ini') || has('setup.cfg')) checks.push({ kind: 'test', cmd: 'python -m pytest -q', source: 'python project files' });
  if (has('go.mod')) checks.push({ kind: 'test', cmd: 'go test ./...', source: 'go.mod' });
  if (has('Cargo.toml')) checks.push({ kind: 'test', cmd: 'cargo test', source: 'Cargo.toml' });
  return { root, packageManager: pm, checks, notes };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const r = detect(args._[0] || process.cwd());
  if (args.json) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`verify plan for ${r.root} (pm: ${r.packageManager || 'n/a'})`);
    for (const c of r.checks) console.log(`  [${c.kind}] ${c.cmd}    # ${c.source}`);
    for (const n of r.notes) console.log(`  note: ${n}`);
  }
}
