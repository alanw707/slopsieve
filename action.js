import fs from 'node:fs/promises';
import { analyzePR } from './lib/analyze.js';
import { analyzeWorkflowCost } from './lib/cost-gate.js';

function env(name, fallback = '') {
  return process.env[name] ?? fallback;
}

function toBool(v, fallback = true) {
  if (v === undefined || v === null || v === '') return fallback;
  return String(v).toLowerCase() === 'true';
}

function authHeaders(token) {
  const h = {
    accept: 'application/vnd.github+json',
    'user-agent': 'slopsieve-action/0.1'
  };
  if (token && token.trim()) h.authorization = `Bearer ${token.trim()}`;
  return h;
}

async function ghRequest(url, token, options = {}) {
  const resp = await fetch(url, {
    ...options,
    headers: { ...authHeaders(token), ...(options.headers || {}) }
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`GitHub ${resp.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function listPrFiles(repo, prNumber, token) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const url = `https://api.github.com/repos/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`;
    const chunk = await ghRequest(url, token);
    if (!Array.isArray(chunk) || !chunk.length) break;
    out.push(...chunk);
    if (chunk.length < 100) break;
  }
  return out;
}

function formatCostSection(costReports) {
  if (!costReports.length) return '';
  const lines = [];
  lines.push('');
  lines.push('### 💸 Cost Gate');
  for (const r of costReports) {
    lines.push(`- **${r.file}**: ~${r.estimatedMonthlyWaste} runner-min/month waste`);
    for (const f of (r.findings || []).slice(0, 4)) {
      lines.push(`  - ${f.type}: ${f.recommendation}`);
    }
  }
  return lines.join('\n');
}

function formatComment(result, costSection = '') {
  const { findings, markdown } = result;
  const badge = findings.risk.label === 'HIGH'
    ? '🔴 HIGH'
    : findings.risk.label === 'MEDIUM'
      ? '🟡 MEDIUM'
      : '🟢 LOW';

  const blockers = [];
  if (findings.secretHits?.length) blockers.push(`Potential secrets detected (${findings.secretHits.reduce((a, x) => a + x.count, 0)} hits)`);
  if (findings.invalidDeps?.length) blockers.push(`Invalid dependencies detected (${findings.invalidDeps.length})`);

  const lines = [];
  lines.push(`## 🔍 SlopSieve Review — ${badge}`);
  lines.push('');
  lines.push(`**Risk Score:** ${findings.score}/100`);
  lines.push('');
  if (blockers.length) {
    lines.push('### Blockers');
    blockers.forEach(b => lines.push(`- ${b}`));
    lines.push('');
  }
  lines.push(markdown);
  if (costSection) lines.push(costSection);
  lines.push('');
  lines.push('Powered by [SlopSieve](https://github.com/alanw707/slopsieve)');
  return lines.join('\n');
}

async function main() {
  const token = env('GITHUB_TOKEN') || env('INPUT_GITHUB_TOKEN');
  const repo = env('GITHUB_REPOSITORY');
  const eventPath = env('GITHUB_EVENT_PATH');
  const failOnHigh = toBool(env('INPUT_FAIL_ON_HIGH', 'true'), true);
  env('INPUT_POLICY', 'standard');

  if (!repo) throw new Error('GITHUB_REPOSITORY missing');
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH missing');

  const raw = await fs.readFile(eventPath, 'utf8');
  const event = JSON.parse(raw);
  const prNumber = event.pull_request?.number || event.number;
  if (!prNumber) throw new Error('PR number not found in event payload');

  const result = await analyzePR({ repo, pr: prNumber, token });

  const prFiles = await listPrFiles(repo, prNumber, token);
  const workflowFiles = prFiles.filter((f) => f.filename && /^\.github\/workflows\/.+\.ya?ml$/i.test(f.filename));
  const costReports = [];
  for (const wf of workflowFiles) {
    try {
      const yaml = wf.raw_url
        ? await fetch(wf.raw_url, { headers: authHeaders(token) }).then(r => r.text())
        : '';
      if (!yaml) continue;
      const cost = analyzeWorkflowCost(yaml);
      costReports.push({ file: wf.filename, ...cost });
    } catch (e) {
      costReports.push({ file: wf.filename, estimatedMonthlyWaste: 0, findings: [{ type: 'analysis_error', recommendation: String(e.message || e) }] });
    }
  }

  const body = formatComment(result, formatCostSection(costReports));

  const commentsUrl = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments?per_page=100`;
  const comments = await ghRequest(commentsUrl, token);
  const existing = comments.find(c => c.body && c.body.includes('🔍 SlopSieve Review'));

  if (existing) {
    await ghRequest(`https://api.github.com/repos/${repo}/issues/comments/${existing.id}`,
      token,
      { method: 'PATCH', body: JSON.stringify({ body }) }
    );
  } else {
    await ghRequest(`https://api.github.com/repos/${repo}/issues/${prNumber}/comments`,
      token,
      { method: 'POST', body: JSON.stringify({ body }) }
    );
  }

  if (result.findings.risk.label === 'HIGH' && failOnHigh) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
