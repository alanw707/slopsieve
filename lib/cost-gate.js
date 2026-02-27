function splitJobs(workflowText = '') {
  const lines = String(workflowText || '').replace(/\r\n/g, '\n').split('\n');
  const jobsIdx = lines.findIndex((l) => /^\s*jobs\s*:\s*$/.test(l));
  if (jobsIdx < 0) return [];

  const jobs = [];
  let i = jobsIdx + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\S/.test(line) && !/^\s*#/.test(line)) break;

    const m = line.match(/^\s{2}([A-Za-z0-9_.-]+)\s*:\s*$/);
    if (!m) {
      i += 1;
      continue;
    }

    const name = m[1];
    const block = [line];
    i += 1;
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s{2}[A-Za-z0-9_.-]+\s*:\s*$/.test(l)) break;
      if (/^\S/.test(l) && !/^\s*#/.test(l)) break;
      block.push(l);
      i += 1;
    }

    jobs.push({ name, block: block.join('\n') });
  }

  return jobs;
}

function estimateRunFrequency(text = '') {
  const t = text.toLowerCase();
  if (t.includes('schedule:')) return 120;
  if (t.includes('pull_request') && t.includes('push')) return 180;
  if (t.includes('pull_request')) return 120;
  if (t.includes('push')) return 100;
  return 60;
}

function detectDuplicateJobs(jobs, runFreq) {
  const signatures = new Map();
  for (const job of jobs) {
    const sig = job.block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('uses:') || l.startsWith('run:'))
      .join('|');
    if (!sig) continue;
    if (!signatures.has(sig)) signatures.set(sig, []);
    signatures.get(sig).push(job.name);
  }

  const findings = [];
  for (const group of signatures.values()) {
    if (group.length >= 2) {
      findings.push({
        type: 'duplicate_jobs',
        wasteMinutesMonthly: (group.length - 1) * runFreq * 3,
        evidence: `Similar step signatures across jobs: ${group.join(', ')}`,
        recommendation: 'Extract shared setup into a reusable workflow or composite action; keep only unique steps in each job.'
      });
    }
  }
  return findings;
}

function estimateFromLogs(text, runFreq) {
  const lower = text.toLowerCase();
  const findings = [];

  const timeoutSignals = (lower.match(/(timed out after|the operation timed out|timeout exceeded)/g) || []).length;
  if (timeoutSignals > 0) {
    findings.push({
      type: 'missing_timeout_minutes',
      wasteMinutesMonthly: timeoutSignals * runFreq,
      evidence: `CI logs show ${timeoutSignals} timeout signal(s).`,
      recommendation: 'Set job-level timeout-minutes to bound retries and stuck jobs.'
    });
  }

  const retrySignals = (lower.match(/(retrying|attempt [0-9]+\/[0-9]+|continue-on-error|--retry)/g) || []).length;
  if (retrySignals > 0) {
    findings.push({
      type: 'flaky_retry_patterns',
      wasteMinutesMonthly: retrySignals * runFreq,
      evidence: `CI logs show ${retrySignals} retry signal(s).`,
      recommendation: 'Fix flaky root causes and constrain retries to non-critical transient steps.'
    });
  }

  const npmInstalls = (lower.match(/(npm ci|npm install|pnpm install|yarn install)/g) || []).length;
  const cacheHits = (lower.match(/(cache hit|restored cache|actions\/cache)/g) || []).length;
  if (npmInstalls > 0 && cacheHits === 0) {
    findings.push({
      type: 'missing_cache',
      wasteMinutesMonthly: npmInstalls * runFreq * 2,
      evidence: `CI logs show ${npmInstalls} dependency install run(s) with no cache-hit signal.`,
      recommendation: 'Enable dependency cache (setup-node/setup-python cache or actions/cache).' 
    });
  }

  const dockerPulls = (lower.match(/(docker pull|pulling from|docker buildx build|docker build\s+)/g) || []).length;
  const dockerCacheSignals = (lower.match(/(cache-from|cache-to|using cache|cached)/g) || []).length;
  if (dockerPulls > 0 && dockerCacheSignals === 0) {
    findings.push({
      type: 'docker_no_cache',
      wasteMinutesMonthly: dockerPulls * runFreq * 2,
      evidence: `CI logs show ${dockerPulls} Docker pull/build signal(s) without cache hints.`,
      recommendation: 'Enable Docker layer caching with buildx cache-from/cache-to type=gha.'
    });
  }

  return findings;
}

function buildOptimizedDiff(findings = []) {
  const types = new Set(findings.map((f) => f.type));
  const out = ['--- workflow.yml', '+++ workflow.optimized.yml', '@@ cost-gate suggestions @@'];

  if (types.has('missing_timeout_minutes')) {
    out.push('+# Add per-job timeout to cap runaway cost');
    out.push('+timeout-minutes: 20');
    out.push('+');
  }

  if (types.has('missing_cache')) {
    out.push('+# Add dependency cache');
    out.push('+- uses: actions/setup-node@v4');
    out.push('+  with:');
    out.push('+    node-version: 20');
    out.push('+    cache: npm');
    out.push('+');
  }

  if (types.has('unnecessary_matrix')) {
    out.push('+# Reduce PR matrix; move exhaustive matrix to nightly');
    out.push('+strategy:');
    out.push('+  matrix:');
    out.push('+    node: [20]');
    out.push('+');
  }

  if (types.has('docker_no_cache')) {
    out.push('+# Docker cache');
    out.push('+- uses: docker/build-push-action@v6');
    out.push('+  with:');
    out.push('+    cache-from: type=gha');
    out.push('+    cache-to: type=gha,mode=max');
    out.push('+');
  }

  if (types.has('duplicate_jobs') || types.has('long_sequential_steps')) {
    out.push('+# Split heavy work across smaller jobs and/or reusable workflows');
    out.push('+jobs:');
    out.push('+  lint: ...');
    out.push('+  test: ...');
    out.push('+  build: ...');
    out.push('+');
  }

  if (out.length === 3) {
    out.push('+# No high-confidence patch generated; workflow already looks reasonably cost-aware.');
  }

  return out.join('\n');
}

function analyzeWorkflowCost(input = '') {
  const text = String(input || '');
  const lower = text.toLowerCase();
  const runFreq = estimateRunFrequency(text);
  const jobs = splitJobs(text);

  const findings = [];

  if (jobs.length > 0) {
    findings.push(...detectDuplicateJobs(jobs, runFreq));

    const ubuntuLatestCount = (lower.match(/runs-on:\s*ubuntu-latest/g) || []).length;
    if (ubuntuLatestCount > 0) {
      findings.push({
        type: 'oversized_runners',
        wasteMinutesMonthly: ubuntuLatestCount * runFreq,
        evidence: `${ubuntuLatestCount} job(s) use runs-on: ubuntu-latest.`,
        recommendation: 'Use smaller/self-hosted runners where possible; pin minimal images and split heavyweight jobs.'
      });
    }

    const hasCache = /uses:\s*actions\/cache@/i.test(text) || /cache:\s*npm|cache:\s*pip|setup-node@.*\n.*cache:/is.test(text);
    const dependencyInstalls = (lower.match(/npm ci|npm install|pip install|pnpm install|yarn install/g) || []).length;
    if (dependencyInstalls > 0 && !hasCache) {
      findings.push({
        type: 'missing_cache',
        wasteMinutesMonthly: dependencyInstalls * runFreq * 2,
        evidence: `Found ${dependencyInstalls} dependency install step(s) without explicit caching.`,
        recommendation: 'Add actions/cache or built-in setup-node/setup-python caching for dependency directories.'
      });
    }

    const retryHits = (lower.match(/retry|continue-on-error|--retry|retry-on-error/g) || []).length;
    if (retryHits > 0) {
      findings.push({
        type: 'flaky_retry_patterns',
        wasteMinutesMonthly: retryHits * runFreq,
        evidence: `Found ${retryHits} retry/continue-on-error signal(s).`,
        recommendation: 'Fix flaky root causes, quarantine unstable tests, and limit retries to non-critical transient steps.'
      });
    }

    const matrixBlocks = [...text.matchAll(/matrix\s*:\s*([\s\S]{0,500})/g)];
    if (matrixBlocks.length) {
      let combosSignal = 0;
      for (const m of matrixBlocks) {
        const chunk = m[1] || '';
        combosSignal += (chunk.match(/-\s+/g) || []).length;
      }
      if (combosSignal >= 6) {
        findings.push({
          type: 'unnecessary_matrix',
          wasteMinutesMonthly: Math.round(combosSignal * runFreq * 0.8),
          evidence: `Matrix appears broad (${combosSignal}+ value entries).`,
          recommendation: 'Keep critical OS/runtime combos on PRs and move exhaustive matrix to nightly schedule.'
        });
      }
    }

    for (const job of jobs) {
      const stepCount = (job.block.match(/^\s{4,}-\s+name:/gm) || []).length + (job.block.match(/^\s{4,}-\s+uses:/gm) || []).length + (job.block.match(/^\s{4,}-\s+run:/gm) || []).length;
      const hasTimeout = /timeout-minutes\s*:/i.test(job.block);
      if (!hasTimeout) {
        findings.push({
          type: 'missing_timeout_minutes',
          wasteMinutesMonthly: runFreq,
          evidence: `Job '${job.name}' has no timeout-minutes.`,
          recommendation: 'Set timeout-minutes per job to cap runaway costs.'
        });
      }
      if (stepCount >= 9) {
        findings.push({
          type: 'long_sequential_steps',
          wasteMinutesMonthly: Math.round(runFreq * 1.5),
          evidence: `Job '${job.name}' has ${stepCount} sequential steps.`,
          recommendation: 'Split heavy test/build/lint steps into parallel jobs with needs dependencies.'
        });
      }
    }

    const dockerPulls = (lower.match(/docker pull|docker buildx build|docker build\s+/g) || []).length;
    const dockerCacheMention = /cache-from|cache-to|type=gha|actions\/cache/i.test(text);
    if (dockerPulls > 0 && !dockerCacheMention) {
      findings.push({
        type: 'docker_no_cache',
        wasteMinutesMonthly: dockerPulls * runFreq * 2,
        evidence: `Found ${dockerPulls} docker pull/build step(s) without cache hints.`,
        recommendation: 'Enable Docker layer caching (buildx cache-from/cache-to type=gha) to reduce pull/build time.'
      });
    }
  } else {
    findings.push(...estimateFromLogs(text, runFreq));
  }

  const unique = new Map();
  for (const f of findings) {
    const k = `${f.type}:${f.evidence}`;
    if (!unique.has(k)) unique.set(k, f);
  }
  const deduped = [...unique.values()].sort((a, b) => b.wasteMinutesMonthly - a.wasteMinutesMonthly);
  const estimatedMonthlyWaste = deduped.reduce((a, f) => a + f.wasteMinutesMonthly, 0);

  const recommendations = [...new Set(deduped.map((f) => f.recommendation))].slice(0, 8).map((r) => `- ${r}`);

  return {
    ok: true,
    mode: jobs.length > 0 ? 'workflow' : 'logs',
    runFrequencyMonthly: runFreq,
    estimatedMonthlyWaste,
    findings: deduped,
    recommendations,
    optimizedDiff: buildOptimizedDiff(deduped)
  };
}

export { splitJobs, analyzeWorkflowCost };
