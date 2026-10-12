// Hash of the working tree relative to HEAD (tracked diff + untracked files), ignoring agent-kit receipts.
import { createHash } from 'node:crypto';
import { git, safeRead } from './lib.mjs';
import { join } from 'node:path';
export function treeHash(root = process.cwd()) {
  const h = createHash('sha1');
  h.update(git(['rev-parse', 'HEAD'], root));
  h.update(git(['diff', 'HEAD', '--binary', '--', '.', ':(exclude).claude/agent-kit/last-verify.json'], root));
  const untracked = git(['ls-files', '--others', '--exclude-standard'], root).split('\n').filter(f => f && !f.includes('.claude/agent-kit/last-verify.json'));
  for (const f of untracked) { h.update(f); h.update(safeRead(join(root, f), 4 * 1024 * 1024)); }
  return h.digest('hex');
}
