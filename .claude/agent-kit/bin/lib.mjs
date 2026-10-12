// Shared helpers for Ship-Ready Agent Kit. Zero dependencies, Node >= 18.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

export function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

export function readHookInput() {
  const raw = readStdin();
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

/** Block a tool call (Claude Code: exit code 2 + stderr is fed back to the model). */
export function block(reason) {
  process.stderr.write(`[agent-kit] BLOCKED: ${reason}\n`);
  process.exit(2);
}

export function allow() { process.exit(0); }

export function git(args, cwd = process.cwd()) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch { return ''; }
}

const IGNORE_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage', '.turbo', '.vercel', '.cache', 'vendor', '.venv', '__pycache__', '.contentlayer']);

export function walk(root, { exts = null, maxFiles = 20000 } = {}) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop();
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name)) stack.push(join(dir, e.name));
      } else if (e.isFile()) {
        const p = join(dir, e.name);
        if (!exts || exts.includes(extname(e.name))) out.push(p);
      }
    }
  }
  return out.sort();
}

export function rel(root, p) { return relative(root, p) || '.'; }

export function readJSON(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

export function safeRead(p, max = 2 * 1024 * 1024) {
  try {
    if (statSync(p).size > max) return '';
    return readFileSync(p, 'utf8');
  } catch { return ''; }
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) args[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) args[k] = argv[++i];
      else args[k] = true;
    } else args._.push(a);
  }
  return args;
}

export { existsSync, join };
