import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 3026);

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

      <div class="footer">No data is stored server-side. Token is only used for GitHub API calls during the request.</div>
    </div>
  </body></html>`;
}

function authHeaders(token) {
  const h = {
    'accept': 'application/vnd.github+json',
    'user-agent': 'slopsieve/0.1'
  };
  if (token && token.trim()) h['authorization'] = `Bearer ${token.trim()}`;
  return h;
}

async function ghFetch(url, token) {
  const resp = await fetch(url, { headers: authHeaders(token) });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`GitHub ${resp.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : null;
}

function sumFilesStats(files) {
  let additions = 0, deletions = 0, filesChanged = 0;
  for (const f of files) {
    additions += Number(f.additions || 0);
    deletions += Number(f.deletions || 0);
    filesChanged += 1;
  }
  return { additions, deletions, filesChanged, changes: additions + deletions };
}

function pathLooksLikeTest(p = '') {
  const s = p.toLowerCase();
  return s.includes('/test/') || s.includes('/tests/') || s.includes('__tests__') || s.endsWith('.spec.js') || s.endsWith('.test.js') || s.endsWith('.spec.ts') || s.endsWith('.test.ts') || s.includes('pytest') || s.includes('spec/');
}

function pathLooksLikeDocs(p = '') {
  const s = p.toLowerCase();
  return s.startsWith('docs/') || s.includes('/docs/') || s.endsWith('.md') || s.endsWith('.mdx') || s.includes('readme');
}

function pathLooksLikeCode(p = '') {
  const s = p.toLowerCase();
  const exts = ['.js','.ts','.tsx','.jsx','.py','.go','.rs','.java','.kt','.cs','.cpp','.c','.h','.hpp','.php','.rb'];
  return exts.some(e => s.endsWith(e));
}

function findSecretHits(textBlob = '') {
  const hits = [];
  const rules = [
    { name: 'private-key', re: /-----BEGIN (RSA|EC|OPENSSH|DSA) PRIVATE KEY-----/g },
    { name: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/g },
    { name: 'generic-api-key', re: /(api[_-]?key|secret|token)\s*[:=]\s*['\"][A-Za-z0-9_\-]{16,}['\"]/gi },
    { name: 'jwt', re: /eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g }
  ];
  for (const r of rules) {
    const m = textBlob.match(r.re);
    if (m && m.length) hits.push({ rule: r.name, count: Math.min(m.length, 20) });
  }
  return hits;
}

function aiSignature(textBlob = '') {
  const re = /(chatgpt|claude|copilot|generated by|as an ai|llm|openai)/i;
  return re.test(textBlob);
}

async function validateNpmPackages(pkgNames = []) {
  const out = [];
  const unique = [...new Set(pkgNames)].slice(0, 30);
  for (const name of unique) {
    try {
      const resp = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { headers: { 'user-agent': 'slopsieve/0.1' } });
      out.push({ name, ok: resp.ok, status: resp.status });
    } catch (e) {
      out.push({ name, ok: false, status: 0, error: String(e.message || e) });
    }
  }
  return out;
}

async function validatePyPiPackages(pkgNames = []) {
  const out = [];
  const unique = [...new Set(pkgNames)].slice(0, 30);
  for (const name of unique) {
    const safe = name.replace(/[^A-Za-z0-9_.-]/g, '');
    if (!safe) continue;
    try {
      const resp = await fetch(`https://pypi.org/pypi/${encodeURIComponent(safe)}/json`, { headers: { 'user-agent': 'slopsieve/0.1' } });
      out.push({ name: safe, ok: resp.ok, status: resp.status });
    } catch (e) {
      out.push({ name: safe, ok: false, status: 0, error: String(e.message || e) });
    }
  }
  return out;
}

function parseRequirements(txt = '') {
  return txt
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('-'))
    .map(l => l.split(/[<>=!~\[]/)[0].trim())
    .filter(Boolean)
    .slice(0, 200);
}

function computeScore({ stats, testChangeRatio, hasDepFiles, invalidDepsCount, secretHitsCount, hasAiSig, hasDocsChange, hasCodeChange }) {
  let score = 0;
  if (stats.filesChanged > 25) score += 18;
  else if (stats.filesChanged > 12) score += 10;

  if (stats.changes > 2000) score += 22;
  else if (stats.changes > 1000) score += 15;
  else if (stats.changes > 400) score += 8;

  if (hasCodeChange && !hasDocsChange) score += 6;

  if (hasCodeChange && testChangeRatio < 0.05) score += 16;
  else if (hasCodeChange && testChangeRatio < 0.12) score += 8;

  if (hasDepFiles && invalidDepsCount > 0) score += 28;

  if (secretHitsCount > 0) score += 35;

  if (hasAiSig) score += 8;

  return Math.max(0, Math.min(100, score));
}

function riskLabel(score) {
  if (score >= 65) return { label: 'HIGH', cls: 'bad' };
  if (score >= 35) return { label: 'MEDIUM', cls: 'warn' };
  return { label: 'LOW', cls: 'ok' };
}

function mdChecklist(findings) {
  const lines = [];
  lines.push(`# SlopSieve checklist`);
  lines.push('');
  lines.push(`**Risk:** ${findings.risk.label} (${findings.score}/100)`);
  lines.push('');
  lines.push('## Quick checks');
  lines.push('- [ ] Pull branch locally + run full test suite');
  lines.push('- [ ] Run linter/formatter + ensure CI is green');
  if (findings.secretHits?.length) {
    lines.push('- [ ] **BLOCKER:** Potential secret(s) detected — remove, rotate, and invalidate exposed credentials');
  }
  if (findings.invalidDeps?.length) {
    lines.push('- [ ] **BLOCKER:** Validate new/changed dependencies exist and are legitimate');
  }
  if (findings.hasAiSig) {
    lines.push('- [ ] Treat as AI-assisted: scrutinize error handling, edge cases, and overconfident logic');
  }
  if (findings.testChangeRatio < 0.05 && findings.hasCodeChange) {
    lines.push('- [ ] Ask for tests: changes are mostly code with little/no test coverage');
  }
  lines.push('- [ ] Confirm docs/README updates if behavior changed');
  lines.push('- [ ] Spot-check security: input validation, authz, injection, path traversal');
  lines.push('');
  lines.push('## Context');
  lines.push(`- Repo: ${findings.repo}`);
  lines.push(`- PR: #${findings.pr} — ${findings.prTitle}`);
  lines.push(`- Files changed: ${findings.stats.filesChanged}, Lines changed: ${findings.stats.changes} (+${findings.stats.additions}/-${findings.stats.deletions})`);
  return lines.join('\n');
}

async function analyzePR({ repo, pr, token }) {
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error('Repo must look like owner/name');
  const prNum = Number(pr);
  if (!Number.isFinite(prNum) || prNum <= 0) throw new Error('PR must be a positive number');

  const prData = await ghFetch(`https://api.github.com/repos/${owner}/${name}/pulls/${prNum}`, token);
  const commits = await ghFetch(`https://api.github.com/repos/${owner}/${name}/pulls/${prNum}/commits?per_page=100`, token);

  // Pull files (paginate)
  let files = [];
  for (let page = 1; page <= 10; page++) {
    const chunk = await ghFetch(`https://api.github.com/repos/${owner}/${name}/pulls/${prNum}/files?per_page=100&page=${page}`, token);
    files = files.concat(chunk);
    if (!chunk.length || chunk.length < 100) break;
  }

  const stats = sumFilesStats(files);
  const hasCodeChange = files.some(f => pathLooksLikeCode(f.filename));
  const hasDocsChange = files.some(f => pathLooksLikeDocs(f.filename));
  const testFiles = files.filter(f => pathLooksLikeTest(f.filename));
  const testChanges = testFiles.reduce((a, f) => a + Number(f.additions || 0) + Number(f.deletions || 0), 0);
  const testChangeRatio = stats.changes ? (testChanges / stats.changes) : 0;

  const patchesBlob = files.map(f => `FILE:${f.filename}\n${f.patch || ''}`).join('\n\n');
  const secretHits = findSecretHits(patchesBlob);
  const hasAiSig = aiSignature((prData.body || '') + '\n' + commits.map(c => c.commit?.message || '').join('\n'));

  // dependency hallucination checks (only when dep files changed)
  const depFiles = files.filter(f => ['package.json', 'requirements.txt', 'pyproject.toml'].includes(f.filename.split('/').pop()));
  const hasDepFiles = depFiles.length > 0;

  let invalidDeps = [];
  const depEvidence = [];

  for (const f of depFiles) {
    const base = f.filename.split('/').pop();
    if (base === 'package.json' && f.raw_url) {
      const raw = await fetch(f.raw_url, { headers: { 'user-agent': 'slopsieve/0.1' } }).then(r => r.text());
      try {
        const parsed = JSON.parse(raw);
        const deps = Object.keys({ ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) }).slice(0, 200);
        const checks = await validateNpmPackages(deps);
        const bad = checks.filter(x => !x.ok);
        invalidDeps.push(...bad.map(b => ({ ecosystem: 'npm', name: b.name, status: b.status })));
        depEvidence.push({ file: f.filename, ecosystem: 'npm', checked: checks.length, invalid: bad.length });
      } catch {
        depEvidence.push({ file: f.filename, ecosystem: 'npm', error: 'Failed to parse package.json' });
      }
    }

    if (base === 'requirements.txt' && f.raw_url) {
      const raw = await fetch(f.raw_url, { headers: { 'user-agent': 'slopsieve/0.1' } }).then(r => r.text());
      const pkgs = parseRequirements(raw);
      const checks = await validatePyPiPackages(pkgs);
      const bad = checks.filter(x => !x.ok);
      invalidDeps.push(...bad.map(b => ({ ecosystem: 'pypi', name: b.name, status: b.status })));
      depEvidence.push({ file: f.filename, ecosystem: 'pypi', checked: checks.length, invalid: bad.length });
    }
  }

  const score = computeScore({
    stats,
    testChangeRatio,
    hasDepFiles,
    invalidDepsCount: invalidDeps.length,
    secretHitsCount: secretHits.reduce((a, x) => a + x.count, 0),
    hasAiSig,
    hasDocsChange,
    hasCodeChange
  });

  const risk = riskLabel(score);

  const findings = {
    repo,
    pr: prNum,
    prTitle: prData.title,
    prUrl: prData.html_url,
    author: prData.user?.login,
    createdAt: prData.created_at,
    updatedAt: prData.updated_at,
    stats,
    testChangeRatio,
    hasAiSig,
    secretHits,
    invalidDeps,
    depEvidence,
    score,
    risk,
    hasDocsChange,
    hasCodeChange
  };

  return {
    findings,
    markdown: mdChecklist(findings)
  };
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
      const params = new URLSearchParams(raw);
      const repo = (params.get('repo') || '').trim();
      const pr = (params.get('pr') || '').trim();
      const token = (params.get('token') || '').trim();

      const result = await analyzePR({ repo, pr, token });

      if (url.pathname === '/api/analyze') return json(res, 200, result);
      return page(res, 200, renderReport(result));
    }

    if (req.method === 'POST' && (url.pathname === '/list' || url.pathname === '/api/list')) {
      const raw = await readBody(req);
      const params = new URLSearchParams(raw);
      const repo = (params.get('repo') || '').trim();
      const token = (params.get('token') || '').trim();
      const [owner, name] = repo.split('/');
      if (!owner || !name) throw new Error('Repo must look like owner/name');
      const prs = await ghFetch(`https://api.github.com/repos/${owner}/${name}/pulls?state=open&per_page=30`, token);
      if (url.pathname === '/api/list') return json(res, 200, { repo, prs });
      return page(res, 200, renderList({ repo, prs, token }));
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
