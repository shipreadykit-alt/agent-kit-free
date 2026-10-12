#!/usr/bin/env node
// Skill: secret-shield.
//  - Hook mode (PreToolUse on Bash|Read|Grep): stops the agent from printing secrets into the transcript
//    (incident: anthropics/claude-code#30731, where the agent read /proc/*/environ and .env, then echoed keys).
//  - Scan mode: node secret-shield.mjs scan [path] [--diff] -> finds hard-coded secrets (values redacted).
import { basename } from 'node:path';
import { readHookInput, block, allow, parseArgs, walk, safeRead, rel, git } from './lib.mjs';

const ENV_FILE = /(^|\/)\.env(\.(?!example$|sample$|template$|defaults$|dist$)[\w.-]+)?$/i;
const SECRET_FILES = /(^|\/)(id_(rsa|ed25519|ecdsa|dsa)$|[^/]*\.(pem|p12|pfx|key|keystore|jks)$|credentials(\.json)?$|\.npmrc$|\.pypirc$|\.netrc$|service-account[^/]*\.json$|\.aws\/credentials$|\.docker\/config\.json$)/i;

export function isSecretPath(p = '') {
  const s = String(p);
  if (/\.(example|sample|template)$/i.test(s)) return false;
  return ENV_FILE.test(s) || SECRET_FILES.test(s);
}

const READERS = '(cat|less|more|head|tail|bat|nl|strings|xxd|od|sed|awk|grep|rg|cut|sort|type|source|\\.|cp|base64|openssl)';
export function checkBash(cmd = '') {
  const hits = [];
  if (/\/proc\/[^\s]*\/environ/.test(cmd)) hits.push('reads another process environment (/proc/*/environ)');
  if (/(^|[;&|]\s*|\bsudo\s+)(printenv|env|set|export\s+-p|declare\s+-x)\s*($|[;&|>])/.test(cmd.trim())) hits.push('dumps all environment variables');
  if (/(echo|printf|print)\s+[^\n]*\$\{?[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIAL|DSN|DATABASE_URL|PRIVATE)[A-Z0-9_]*/i.test(cmd)) hits.push('echoes a secret-looking variable');
  const re = new RegExp(`\\b${READERS}\\b[^\\n;&|]*?([^\\s'"]*(\\.env(\\.[\\w.-]+)?|id_rsa|id_ed25519|\\.pem|credentials(\\.json)?|\\.npmrc|\\.netrc|service-account[^\\s]*\\.json))(?=[\\s'";&|]|$)`, 'gi');
  const namesOnly = /(cut\s+-d\s*['"]?=['"]?\s+-f\s*1\b|sed\s+(-E\s+)?['"]s\/=\.\*\/\/g?['"]|grep\s+-o\s+['"]\^\[A-Z_0-9\]\+['"])/.test(cmd);
  let m;
  while (!namesOnly && (m = re.exec(cmd))) { if (isSecretPath(m[2])) hits.push(`prints secret file ${m[2]}`); }
  if (/\bgit\s+add\s+[^\n]*\.env(\s|$)/.test(cmd) || /\bgit\s+add\s+(-f|--force)\b[^\n]*\.env/.test(cmd)) hits.push('stages a .env file for commit');
  return hits;
}

// ---- scanner ---------------------------------------------------------------
export const PATTERNS = [
  ['aws-access-key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['github-token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/g],
  ['stripe-live-key', /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/g],
  ['openai-key', /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/g],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{32,}\b/g],
  ['slack-token', /\bxox[abpors]-[A-Za-z0-9-]{10,}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['private-key-block', /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g],
  ['db-url-with-password', /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^:\s/'"]+:([^@\s'"]{3,})@[^\s'"]+/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  ['generic-assignment', /\b([A-Z0-9_]*(SECRET|TOKEN|API_KEY|APIKEY|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*)\s*[:=]\s*['"]([^'"\s]{12,})['"]/g],
];

const PLACEHOLDER = /(^(pass|password|secret|root|admin|postgres|user)$|x{4,}|random|\*{3,}|your[_-]|changeme|example|placeholder|dummy|test|fake|sample|<|\$\{|process\.env|localhost|password123|secret123|^\.\.\.)/i;

function entropy(s) {
  const f = {}; for (const c of s) f[c] = (f[c] || 0) + 1;
  return Object.values(f).reduce((h, n) => h - (n / s.length) * Math.log2(n / s.length), 0);
}

export function redact(s) { return s.length <= 8 ? '****' : `${s.slice(0, 4)}…${s.slice(-2)} (${s.length} chars)`; }

export function scanText(text, file) {
  const findings = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (line.length > 2000) return;
    for (const [id, re] of PATTERNS) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(line))) {
        const value = id === 'generic-assignment' ? m[3] : id === 'db-url-with-password' ? m[4] : m[0];
        if (id === 'generic-assignment' && (PLACEHOLDER.test(value) || entropy(value) < 3.0)) continue;
        if (id === 'db-url-with-password' && (PLACEHOLDER.test(value) || /\.(example|sample|template)$/.test(file))) continue;
        if (id === 'jwt' && /test|spec|mock|fixture/i.test(file)) continue;
        findings.push({ file, line: i + 1, rule: id, value: redact(value) });
      }
    }
  });
  return findings.filter(x => x.rule !== 'generic-assignment' || !findings.some(y => y !== x && y.line === x.line && y.rule !== 'generic-assignment'));
}

export function scan(root, { diff = false } = {}) {
  let findings = [];
  const trackedEnv = git(['ls-files'], root).split('\n').filter(f => f && isSecretPath(f));
  for (const f of trackedEnv) findings.push({ file: f, line: 0, rule: 'secret-file-committed', value: 'file is tracked by git' });
  if (diff) {
    const d = git(['diff', '--unified=0', 'HEAD'], root) + git(['diff', '--cached', '--unified=0'], root);
    let file = '';
    for (const l of d.split('\n')) {
      if (l.startsWith('+++ b/')) file = l.slice(6);
      else if (l.startsWith('+') && !l.startsWith('+++')) findings.push(...scanText(l.slice(1), file).map(x => ({ ...x, line: '+' })));
    }
    for (const u of git(['ls-files', '--others', '--exclude-standard'], root).split('\n').filter(f => f && !f.startsWith('.claude/agent-kit/'))) findings.push(...scanText(safeRead(`${root}/${u}`, 512 * 1024), u));
  } else {
    for (const p of walk(root)) {
      const b = basename(p);
      if (rel(root, p).startsWith('.claude/agent-kit/')) continue;
      if (/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|zip|gz|lock|map|min\.js|svg)$/i.test(b) || /lock\.(json|yaml)$/.test(b)) continue;
      findings.push(...scanText(safeRead(p, 512 * 1024), rel(root, p)));
    }
  }
  return findings;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args._[0] === 'scan') {
    const root = args._[1] || process.cwd();
    const f = scan(root, { diff: !!args.diff });
    if (args.json) console.log(JSON.stringify(f, null, 2));
    else {
      console.log(`secret-shield scan: ${root}${args.diff ? ' (diff vs HEAD)' : ''}`);
      console.log(f.length ? f.map(x => `  ${x.rule.padEnd(22)} ${x.file}:${x.line}  ${x.value}`).join('\n') : '  no secrets found');
      console.log(`  total: ${f.length}`);
    }
    process.exit(f.length ? 1 : 0);
  }
  if (args.cmd) { const h = checkBash(args.cmd); console.log(h.length ? `BLOCK\t${args.cmd}\n  - ${h.join('\n  - ')}` : `ALLOW\t${args.cmd}`); process.exit(h.length ? 2 : 0); }
  const input = readHookInput();
  const tool = input.tool_name || '';
  const ti = input.tool_input || {};
  let hits = [];
  if (tool === 'Bash') hits = checkBash(ti.command);
  else if (['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool) && isSecretPath(ti.file_path)) hits = [`${tool} on secret file ${ti.file_path}`];
  else if (tool === 'Grep' && isSecretPath(ti.path || '')) hits = [`grep inside secret file ${ti.path}`];
  if (hits.length) block(`${hits.join('; ')}.\nSecrets that enter the transcript are exposed. To check that a variable is set, use: test -n "$VAR" && echo set. To list key NAMES only: sed 's/=.*//' .env. Ask the user if you truly need a value.`);
  allow();
}
