#!/usr/bin/env node
// Skill: verify-before-done (part 2). Runs the detected checks and writes a tamper-evident receipt
// (.claude/agent-kit/last-verify.json) tied to the exact working-tree state. The Stop hook reads it.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detect } from './detect-checks.mjs';
import { treeHash } from './tree-hash.mjs';
import { parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const root = args.root || process.cwd();
const plan = detect(root);
if (args.cmd) plan.checks = [{ kind: 'scoped', cmd: String(args.cmd), source: '--cmd' }];
const only = args.only ? String(args.only).split(',') : null;
const results = [];
for (const c of plan.checks) {
  if (only && !only.includes(c.kind)) continue;
  if (c.kind === 'build' && !args.build) continue;
  const t0 = Date.now();
  const r = spawnSync(c.cmd, { cwd: root, shell: true, encoding: 'utf8', env: { ...process.env, CI: '1', FORCE_COLOR: '0' }, maxBuffer: 64 * 1024 * 1024, timeout: Number(args.timeout || 900) * 1000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const tail = out.split('\n').slice(-40).join('\n');
  results.push({ kind: c.kind, cmd: c.cmd, exitCode: r.status ?? -1, ms: Date.now() - t0, tail });
  console.log(`\n$ ${c.cmd}\n${tail}\n→ exit ${r.status} (${Date.now() - t0} ms)`);
}
const ok = results.length > 0 && results.every(r => r.exitCode === 0);
const receipt = { ok, scope: args.cmd ? 'scoped' : 'full', at: new Date().toISOString(), tree: treeHash(root), results: results.map(({ tail, ...r }) => r), notes: plan.notes };
mkdirSync(join(root, '.claude', 'agent-kit'), { recursive: true });
writeFileSync(join(root, '.claude', 'agent-kit', 'last-verify.json'), JSON.stringify(receipt, null, 2));
console.log(`\nVERIFY ${ok ? 'PASSED' : results.length ? 'FAILED' : 'NOTHING-RAN'}: ${results.map(r => `${r.kind}=${r.exitCode}`).join(' ')}`);
if (plan.notes.length) console.log(plan.notes.map(n => `note: ${n}`).join('\n'));
process.exit(ok ? 0 : 1);
