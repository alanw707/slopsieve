import http from 'node:http';
import { URL } from 'node:url';
import { analyzePR, ghFetch } from './lib/analyze.js';
import { analyzeWorkflowCost } from './lib/cost-gate.js';

const PORT = Number(process.env.PORT || 3028);

function htmlEscape(s = '') {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}



function parseRequestBody(req, raw) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw || '{}');
    } catch {
      throw new Error('Invalid JSON body');
    }
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw);
    return Object.fromEntries(params.entries());
  }

  // Plain text fallback for fast API usage from scripts/CLI.
  return { workflow: String(raw || '') };
}

function json(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

function text(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

function page(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

function baseStyles() {
  return `
    <style>
      :root { --bg:#0b1020; --card:#121a33; --ink:#e8ecff; --muted:#aab3d6; --ok:#2dd4bf; --warn:#fbbf24; --bad:#fb7185; --link:#93c5fd; }
      *{box-sizing:border-box} body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;background:linear-gradient(180deg,#070a14, var(--bg));color:var(--ink)}
      a{color:var(--link);text-decoration:none} a:hover{text-decoration:underline}
      .wrap{max-width:1100px;margin:0 auto;padding:28px}
      .hero{display:flex;gap:20px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
      .title{font-size:34px;letter-spacing:-0.02em;margin:0}
      .subtitle{color:var(--muted);margin:8px 0 0;max-width:70ch;line-height:1.35}
      .card{background:rgba(18,26,51,.92);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.35)}
      .grid{display:grid;gap:16px;grid-template-columns:1fr;}
      @media(min-width:900px){.grid{grid-template-columns:1.3fr .7fr}}
      label{display:block;color:var(--muted);font-size:13px;margin:10px 0 6px}
      input,select,textarea{width:100%;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:#0b1228;color:var(--ink);outline:none}
      textarea{min-height:110px}
      button{background:#2563eb;border:0;color:white;padding:10px 14px;border-radius:12px;cursor:pointer;font-weight:650}
      button.secondary{background:rgba(255,255,255,.08)}
      .row{display:flex;gap:12px;flex-wrap:wrap}
      .row > *{flex:1;min-width:220px}
      .kpi{display:flex;gap:10px;flex-wrap:wrap}
      .pill{padding:6px 10px;border-radius:999px;font-size:12px;font-weight:650;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08)}
      .pill.ok{color:var(--ok);border-color:rgba(45,212,191,.3)}
      .pill.warn{color:var(--warn);border-color:rgba(251,191,36,.35)}
      .pill.bad{color:var(--bad);border-color:rgba(251,113,133,.35)}
      pre{background:#070a14;border:1px solid rgba(255,255,255,.08);padding:12px;border-radius:14px;overflow:auto;}
      .muted{color:var(--muted)}
      .small{font-size:13px;line-height:1.35}
      .footer{margin-top:20px;color:var(--muted);font-size:12px}
      .hr{height:1px;background:rgba(255,255,255,.08);margin:14px 0}
    </style>
  `;
}

function landing({ error = '' } = {}) {
  return `<!doctype html>
  <html><head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>SlopSieve — PR triage for maintainers</title>
    ${baseStyles()}
  </head>
  <body>
    <div class="wrap">
      <div class="hero">
        <div>
          <h1 class="title">SlopSieve</h1>
          <p class="subtitle">A fast PR triage dashboard to flag <b>AI-slop risk patterns</b> (dependency hallucinations, missing tests, leaked secrets, oversized diffs) and generate a human verification checklist — <b>no paid APIs</b>, no LLM calls.</p>
        </div>
        <div class="card small" style="min-width:260px;max-width:420px">
          <div class="pill">Self-hosted</div>
          <div class="pill">Public GitHub repos work without auth</div>
          <div class="pill">Optional GITHUB_TOKEN for higher rate limits</div>
          <div class="hr"></div>
          <div class="muted">Tip: Start with a repo you're maintaining, list open PRs, then click the worst-looking one.</div>
        </div>
      </div>

      ${error ? `<div class="card" style="border-color:rgba(251,113,133,.4);margin-top:16px"><b>Error:</b> ${htmlEscape(error)}</div>` : ''}

      <div class="grid" style="margin-top:16px">
        <div class="card">
          <h2 style="margin:0 0 10px">Analyze one PR</h2>
          <form method="POST" action="/analyze">
            <div class="row">
              <div>
                <label>Repo (owner/name)</label>
                <input name="repo" placeholder="godotengine/godot" required />
              </div>
              <div>
                <label>PR number</label>
                <input name="pr" placeholder="12345" required />
              </div>
            </div>
            <label>GitHub token (optional)</label>
            <input name="token" placeholder="ghp_... (kept only for this request)" />
            <div style="margin-top:12px" class="row">
              <button type="submit">Analyze PR</button>
            </div>
          </form>
        </div>

        <div class="card">
          <h2 style="margin:0 0 10px">List open PRs</h2>
          <form method="POST" action="/list">
            <label>Repo (owner/name)</label>
            <input name="repo" placeholder="godotengine/godot" required />
            <label>GitHub token (optional)</label>
            <input name="token" placeholder="ghp_..." />
            <div style="margin-top:12px">
              <button type="submit">Fetch open PRs</button>
            </div>
          </form>
          <div class="footer">We score each PR using heuristics (size, tests ratio, dependency changes, secret patterns, AI signature). Click into one for details.</div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <h2 style="margin:0 0 10px">Deploy Gate mode (NEW)</h2>
        <p class="muted small">Pre-deploy guardrails for AI-assisted code. Paste your deployment plan and SlopSieve returns <b>ALLOW / REVIEW / BLOCK</b> with reasons and a release checklist.</p>
        <form method="POST" action="/deploy-gate">
          <div class="row">
            <div>
              <label>Service / app name</label>
              <input name="service" placeholder="payments-api" required />
            </div>
            <div>
              <label>Environment</label>
              <select name="environment">
                <option>production</option>
                <option>staging</option>
                <option>development</option>
              </select>
            </div>
            <div>
              <label>Policy profile</label>
              <select name="policy">
                <option value="standard" selected>standard</option>
                <option value="strict">strict</option>
                <option value="dev">dev</option>
              </select>
            </div>
          </div>
          <label>Deployment plan / notes</label>
          <textarea name="plan" placeholder="Paste CI output, deploy command, migration notes, rollback plan, and test evidence..." required></textarea>
          <div style="margin-top:12px"><button type="submit">Run Deploy Gate</button></div>
        </form>
      </div>

      <div class="card" style="margin-top:16px">
        <h2 style="margin:0 0 10px">Cost Gate (NEW)</h2>
        <p class="muted small">Paste a GitHub Actions workflow YAML (or CI logs). SlopSieve estimates monthly CI waste, flags cost anti-patterns, and suggests an optimized YAML diff.</p>
        <form method="POST" action="/cost-gate">
          <label>Workflow YAML / CI log</label>
          <textarea name="workflow" placeholder="name: CI
on:
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps: ..." required></textarea>
          <div style="margin-top:12px"><button type="submit">Run Cost Gate</button></div>
        </form>
      </div>

      <div class="footer">No data is stored server-side. Token is only used for GitHub API calls during the request.</div>
    </div>
  </body></html>`;
}

function renderList({ repo, prs, token }) {
  const rows = prs.map(p => {
    const created = new Date(p.created_at).toISOString().slice(0, 10);
    const title = htmlEscape(p.title);
    return `<li style="margin:10px 0">
      <div><b>#${p.number}</b> <a href="${htmlEscape(p.html_url)}" target="_blank" rel="noreferrer">${title}</a></div>
      <div class="muted small">by ${htmlEscape(p.user?.login || '')} · created ${created}</div>
      <form method="POST" action="/analyze" style="margin-top:8px">
        <input type="hidden" name="repo" value="${htmlEscape(repo)}" />
        <input type="hidden" name="pr" value="${p.number}" />
        <input type="hidden" name="token" value="${htmlEscape(token || '')}" />
        <button type="submit">Analyze</button>
      </form>
    </li>`;
  }).join('\n');

  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>SlopSieve — ${htmlEscape(repo)} open PRs</title>${baseStyles()}</head>
    <body><div class="wrap">
      <div class="card">
        <div class="row" style="align-items:center">
          <div><h1 style="margin:0">Open PRs: ${htmlEscape(repo)}</h1><div class="muted small">Click analyze to generate a risk score + checklist.</div></div>
          <div style="text-align:right"><a href="/" class="pill">← Back</a></div>
        </div>
        <div class="hr"></div>
        <ul style="list-style:none;padding:0;margin:0">${rows || '<li class="muted">No open pull requests found.</li>'}</ul>
      </div>
    </div></body></html>`;
}

function renderReport({ findings, markdown }) {
  const risk = findings.risk;
  const pills = [
    `<span class="pill ${risk.cls}">RISK ${risk.label} · ${findings.score}/100</span>`,
    `<span class="pill">Files ${findings.stats.filesChanged}</span>`,
    `<span class="pill">Lines ${findings.stats.changes} (+${findings.stats.additions}/-${findings.stats.deletions})</span>`,
    `<span class="pill">Tests ratio ${(findings.testChangeRatio * 100).toFixed(1)}%</span>`,
    findings.hasAiSig ? `<span class="pill warn">AI signature detected</span>` : `<span class="pill ok">No AI signature found</span>`
  ].join(' ');

  const secret = findings.secretHits?.length
    ? `<div class="card" style="border-color:rgba(251,113,133,.35);margin-top:14px"><b>Potential secrets detected</b><div class="muted small">(Heuristic scan. Verify before acting.)</div><pre>${htmlEscape(JSON.stringify(findings.secretHits, null, 2))}</pre></div>`
    : '';

  const deps = findings.depEvidence?.length
    ? `<div class="card" style="margin-top:14px"><b>Dependency checks</b>
        <div class="muted small">We validate npm/PyPI packages referenced in changed dependency files by hitting their public registries.</div>
        <pre>${htmlEscape(JSON.stringify({ depEvidence: findings.depEvidence, invalidDeps: findings.invalidDeps.slice(0, 50) }, null, 2))}</pre>
      </div>`
    : '';

  const md = htmlEscape(markdown);

  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>SlopSieve report — ${htmlEscape(findings.repo)} #${findings.pr}</title>${baseStyles()}</head>
    <body><div class="wrap">
      <div class="card">
        <div class="row" style="align-items:center">
          <div>
            <h1 style="margin:0">${htmlEscape(findings.repo)} #${findings.pr}</h1>
            <div class="muted small"><a href="${htmlEscape(findings.prUrl)}" target="_blank" rel="noreferrer">Open on GitHub</a> · ${htmlEscape(findings.prTitle)} · by ${htmlEscape(findings.author || '')}</div>
          </div>
          <div style="text-align:right"><a href="/" class="pill">← New analysis</a></div>
        </div>
        <div style="margin-top:10px" class="kpi">${pills}</div>
        <div class="hr"></div>
        <h3 style="margin:0 0 8px">Copy/paste checklist (Markdown)</h3>
        <pre>${md}</pre>
        ${secret}
        ${deps}
        <div class="footer">SlopSieve is intentionally conservative: it flags review risk, not correctness.</div>
      </div>
    </div></body></html>`;
}


function renderCostGateReport(result) {
  const rows = (result.findings || []).map((f) => `<li style="margin:10px 0"><b>${htmlEscape(f.type)}</b> · ~${f.wasteMinutesMonthly} min/mo<br><span class="muted small">${htmlEscape(f.evidence)}</span><br><span class="small">${htmlEscape(f.recommendation)}</span></li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>SlopSieve Cost Gate</title>${baseStyles()}</head>
    <body><div class="wrap"><div class="card">
      <div class="row" style="align-items:center"><div><h1 style="margin:0">Cost Gate</h1><div class="muted small">Estimated monthly waste: <b>${result.estimatedMonthlyWaste} runner-minutes</b></div></div><div style="text-align:right"><a href="/" class="pill">← Back</a></div></div>
      <div class="hr"></div>
      <h3 style="margin:0 0 8px">Savings recommendations</h3>
      <pre>${htmlEscape((result.recommendations || []).join('\n'))}</pre>
      <h3 style="margin:12px 0 8px">Findings</h3>
      <ul style="list-style:none;padding:0;margin:0">${rows || '<li class="muted">No obvious cost waste patterns found.</li>'}</ul>
      <h3 style="margin:12px 0 8px">Optimized YAML diff</h3>
      <pre>${htmlEscape(result.optimizedDiff || '')}</pre>
    </div></div></body></html>`;
}

function deployGateAnalyze({ service, environment, policy = 'standard', plan }) {
  const normalizedPolicy = ['strict', 'standard', 'dev'].includes(policy) ? policy : 'standard';
  const blob = `${service}\n${environment}\n${plan || ''}`.toLowerCase();
  const blockers = [];
  const warnings = [];
  const positives = [];

  const has = (re) => re.test(blob);
  const prodLike = /prod|production/.test(environment.toLowerCase());

  if (has(/skip[ -]?tests|--no-verify|ci[ -]?skip|skip ci/)) blockers.push('Deployment notes indicate tests/verification are being skipped.');
  if (has(/force[ -]?push|push --force|branch protection disabled|bypass required checks/)) blockers.push('Plan bypasses branch protections or required checks.');
  if (has(/terraform apply .*auto-approve|kubectl apply -f \.|chmod 777/)) blockers.push('High-risk deploy command pattern detected (broad or unsafe execution).');
  if (prodLike && has(/manual hotfix|direct to main|deploy from local/)) blockers.push('Production deploy appears to bypass controlled release path.');
  if (has(/api[_-]?key\s*[:=]|secret\s*[:=]|token\s*[:=]|-----begin .*private key-----/)) blockers.push('Potential secret exposure in deployment notes.');

  if (!has(/rollback|roll back|revert/)) warnings.push('No rollback plan detected.');
  else positives.push('Rollback language detected.');

  if (!has(/canary|blue.?green|staged rollout|gradual rollout/)) warnings.push('No staged rollout/canary strategy detected.');
  else positives.push('Staged rollout strategy detected.');

  if (has(/migration|schema|ddl/) && !has(/backward compatible|expand.?contract|dual write|feature flag/)) {
    warnings.push('DB migration mentioned without backward-compatibility guardrails.');
  }

  if (!has(/monitor|alert|slo|dashboard|error budget|health check/)) warnings.push('Post-deploy monitoring/health checks not explicit.');
  else positives.push('Monitoring/health checks mentioned.');

  if (normalizedPolicy === 'strict') {
    if (!has(/runbook|approval|change request|peer review/)) warnings.push('Strict policy requires explicit human approval/runbook references.');
    if (prodLike && !has(/canary|blue.?green|staged rollout|gradual rollout/)) {
      blockers.push('Strict policy blocks production deploys without staged rollout language.');
    }
  }

  if (normalizedPolicy === 'dev') {
    // Dev policy still blocks dangerous patterns, but softens rollout/monitoring requirements.
    const relaxed = new Set([
      'No staged rollout/canary strategy detected.',
      'Post-deploy monitoring/health checks not explicit.'
    ]);
    const keptWarnings = warnings.filter((w) => !relaxed.has(w));
    const removed = warnings.length - keptWarnings.length;
    warnings.length = 0;
    warnings.push(...keptWarnings);
    if (removed > 0) positives.push('Dev policy relaxed rollout/observability warnings.');
  }

  const score = Math.max(0, Math.min(100, blockers.length * 34 + warnings.length * 10 - positives.length * 4));
  const reviewThreshold = normalizedPolicy === 'strict' ? 2 : 3;
  const gate = blockers.length ? 'BLOCK' : (warnings.length >= reviewThreshold ? 'REVIEW' : 'ALLOW');

  const checklist = [
    '# SlopSieve Deploy Gate checklist',
    '',
    `**Decision:** ${gate} (${score}/100 risk)`,
    '',
    '## Required before production',
    '- [ ] CI green on target commit',
    '- [ ] Rollback command documented and tested in staging',
    '- [ ] Deployment uses staged rollout (canary/blue-green) when user-impacting',
    '- [ ] Observability checks defined (errors, latency, saturation)',
    '- [ ] DB migrations are backward compatible',
    '- [ ] No secrets in logs, PRs, or deployment notes',
    '',
    '## Context',
    `- Service: ${service}`,
    `- Environment: ${environment}`,
    `- Policy: ${normalizedPolicy}`
  ].join('\n');

  return { service, environment, policy: normalizedPolicy, gate, score, blockers, warnings, positives, checklist };
}

function renderDeployGateReport(result) {
  const cls = result.gate === 'BLOCK' ? 'bad' : (result.gate === 'REVIEW' ? 'warn' : 'ok');
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>SlopSieve Deploy Gate — ${htmlEscape(result.service)}</title>${baseStyles()}</head>
    <body><div class="wrap"><div class="card">
      <div class="row" style="align-items:center">
        <div><h1 style="margin:0">Deploy Gate: ${htmlEscape(result.service)}</h1><div class="muted small">Environment: ${htmlEscape(result.environment)} · Policy: ${htmlEscape(result.policy || 'standard')}</div></div>
        <div style="text-align:right"><a href="/" class="pill">← Back</a></div>
      </div>
      <div style="margin-top:10px" class="kpi"><span class="pill ${cls}">${result.gate} · ${result.score}/100</span></div>
      <div class="hr"></div>
      <div class="row">
        <div class="card" style="flex:1"><b>Blockers</b><pre>${htmlEscape(JSON.stringify(result.blockers, null, 2))}</pre></div>
        <div class="card" style="flex:1"><b>Warnings</b><pre>${htmlEscape(JSON.stringify(result.warnings, null, 2))}</pre></div>
        <div class="card" style="flex:1"><b>Positives</b><pre>${htmlEscape(JSON.stringify(result.positives, null, 2))}</pre></div>
      </div>
      <div class="card" style="margin-top:14px"><b>Checklist (Markdown)</b><pre>${htmlEscape(result.checklist)}</pre></div>
    </div></div></body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/') {
      return page(res, 200, landing());
    }

    if (req.method === 'GET' && url.pathname === '/healthz') {
      return json(res, 200, { ok: true, name: 'slopsieve', port: PORT });
    }

    if (req.method === 'POST' && (url.pathname === '/analyze' || url.pathname === '/api/analyze')) {
      const raw = await readBody(req);
      const body = parseRequestBody(req, raw);
      const repo = String(body.repo || '').trim();
      const pr = String(body.pr || '').trim();
      const token = String(body.token || '').trim();

      const result = await analyzePR({ repo, pr, token });

      if (url.pathname === '/api/analyze') return json(res, 200, result);
      return page(res, 200, renderReport(result));
    }

    if (req.method === 'POST' && (url.pathname === '/list' || url.pathname === '/api/list')) {
      const raw = await readBody(req);
      const body = parseRequestBody(req, raw);
      const repo = String(body.repo || '').trim();
      const token = String(body.token || '').trim();
      const [owner, name] = repo.split('/');
      if (!owner || !name) throw new Error('Repo must look like owner/name');
      const prs = await ghFetch(`https://api.github.com/repos/${owner}/${name}/pulls?state=open&per_page=30`, token);
      if (url.pathname === '/api/list') return json(res, 200, { repo, prs });
      return page(res, 200, renderList({ repo, prs, token }));
    }

    if (req.method === 'POST' && (url.pathname === '/deploy-gate' || url.pathname === '/api/deploy-gate')) {
      const raw = await readBody(req);
      const body = parseRequestBody(req, raw);
      const service = String(body.service || '').trim();
      const environment = String(body.environment || 'production').trim();
      const policy = String(body.policy || 'standard').trim().toLowerCase();
      const plan = String(body.plan || '').trim();
      if (!service) throw new Error('Service is required');
      if (!plan) throw new Error('Deployment plan is required');
      const result = deployGateAnalyze({ service, environment, policy, plan });
      if (url.pathname === '/api/deploy-gate') return json(res, 200, result);
      return page(res, 200, renderDeployGateReport(result));
    }

    if (req.method === 'POST' && (url.pathname === '/cost-gate' || url.pathname === '/api/cost-gate')) {
      const raw = await readBody(req);
      const body = parseRequestBody(req, raw);
      const workflow = String(body.workflow || body.yaml || body.ciLog || body.content || '').trim();
      if (!workflow) throw new Error('Workflow YAML/CI log is required');
      const result = analyzeWorkflowCost(workflow);
      if (url.pathname === '/api/cost-gate') return json(res, 200, result);
      return page(res, 200, renderCostGateReport(result));
    }

    if (req.method === 'GET' && url.pathname === '/robots.txt') {
      return text(res, 200, 'User-agent: *\nDisallow: /\n');
    }

    return text(res, 404, 'Not found');
  } catch (e) {
    const msg = String(e?.message || e);
    if (req.url?.startsWith('/api/')) return json(res, 400, { ok: false, error: msg });
    return page(res, 400, landing({ error: msg }));
  }
});

server.listen(PORT, () => {
  console.log(`SlopSieve running on http://localhost:${PORT}`);
});
