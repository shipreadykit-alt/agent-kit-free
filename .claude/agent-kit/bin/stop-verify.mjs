#!/usr/bin/env node
// Skill: verify-before-done (part 3). Stop hook. If the agent is about to claim success
// ("done", "all tests pass", "fixed") after changing code, but there is no passing verification receipt
// for the CURRENT working tree, block the stop and make it run the real checks.
// Evidence: anthropics/claude-code#46940, #11913 (fabricated "ALL PASSED"); r/ClaudeAI "silent fake success".
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readHookInput, block, allow, git } from './lib.mjs';
import { treeHash } from './tree-hash.mjs';
import { analyze } from './test-integrity.mjs';

export const CLAIM = /\b(all (the )?(tests|checks|specs) (now )?(pass|passed|passing|green)|tests? (are |now )?(pass|passing|green)|(is|are|now) (done|complete|fixed|working)|(task|feature|fix|implementation|change)s? (is |are )?(complete|done|ready)|works now|fully (working|implemented|tested)|ready (to|for) (merge|ship|review|deploy)|should (now )?work|everything (works|passes|is working)|successfully (implemented|fixed|completed))\b|✅/i;

export function lastAssistantText(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return '';
  const lines = readFileSync(transcriptPath, 'utf8').trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    let e; try { e = JSON.parse(lines[i]); } catch { continue; }
    const msg = e.message || e;
    if ((e.type === 'assistant' || msg.role === 'assistant')) {
      const c = msg.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(p => p.type === 'text').map(p => p.text).join('\n') : '';
      if (text.trim()) return text;
    }
  }
  return '';
}

export function decide({ root, text, receipt, currentTree, changed, integrity = [] }) {
  if (!changed) return { ok: true, why: 'no code changes' };
  const high = integrity.filter(f => f.severity === 'high');
  if (high.length && CLAIM.test(text)) return { ok: false, why: `Tests were weakened in this change: ${high.map(f => `${f.rule} (${f.file})`).join(', ')}. A passing run does not count. Revert these or justify each one to the user.` };
  if (!CLAIM.test(text)) return { ok: true, why: 'no success claim' };
  if (/\b(not (yet )?(run|verified|tested)|unverified|could not (run|verify)|did not run)\b/i.test(text)) return { ok: true, why: 'claim is explicitly hedged' };
  if (!receipt) return { ok: false, why: 'You claimed success but no verification has been run on these changes.' };
  if (receipt.tree !== currentTree) return { ok: false, why: `Files changed after the last verification (${receipt.at}). The receipt does not cover the current code.` };
  if (!receipt.results?.length) return { ok: false, why: 'No tests or checks exist / ran for this repo, so success cannot be claimed. Write "not verified by tests" and describe what you actually checked.' };
  if (!receipt.ok) return { ok: false, why: `The last verification FAILED (${receipt.results.map(r => `${r.kind}=exit ${r.exitCode}`).join(', ')}). You cannot report success.` };
  return { ok: true, why: 'fresh passing receipt' };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const input = readHookInput();
  if (input.stop_hook_active) allow(); // never loop
  const root = input.cwd || process.cwd();
  const changed = git(['status', '--porcelain', '--', '.', ':(exclude).claude/agent-kit'], root).trim().length > 0;
  const rp = join(root, '.claude', 'agent-kit', 'last-verify.json');
  let receipt = null; try { receipt = JSON.parse(readFileSync(rp, 'utf8')); } catch {}
  const integrity = changed ? analyze(git(['diff', '--no-color', '--unified=0', 'HEAD'], root)) : [];
  const d = decide({ root, text: lastAssistantText(input.transcript_path), receipt, currentTree: changed ? treeHash(root) : '', changed, integrity });
  if (!d.ok) block(`${d.why}\nRun: node .claude/agent-kit/bin/run-verify.mjs and paste its real output (the final VERIFY line). If checks fail, report the failure honestly: do NOT edit, skip or delete tests to make them pass. If the repo has no tests, say "not verified by tests" instead of claiming success.`);
  allow();
}
