# SlopSieve

PR triage dashboard to spot AI-slop risk patterns (dependency hallucinations, missing tests, leaked secrets, oversized diffs) and generate a human verification checklist.

## Why
Maintainers are getting flooded with low-quality AI-assisted PRs. The bottleneck isn't writing code anymore — it's **review bandwidth**.

SlopSieve is intentionally **not an AI reviewer**. It's a conservative heuristic tool that:
- flags review risk quickly
- highlights specific things to verify
- generates a copy/paste checklist for maintainers

## Run

```bash
PORT=3028 node server.js
# open http://localhost:3028
```

Optional (recommended):

```bash
export GITHUB_TOKEN=...   # higher GitHub rate limits
```

## CLI

```bash
node cli.js owner/repo 123 --token=YOUR_TOKEN
```

## What it checks (today)
### PR Triage Mode
- PR size (files + lines changed)
- Test change ratio (are tests moving with code?)
- Basic secret patterns in patches (heuristic)
- AI signature in PR body / commit messages (heuristic)
- Dependency file changes + registry existence checks (npm + PyPI)

### Deploy Gate Mode (new)
- Flags deploy blockers (test bypass, branch-protection bypass, risky broad commands, secret leakage)
- Adds rollout warnings (missing rollback, canary/staged rollout, migration safety, observability)
- Supports policy profiles: `strict`, `standard`, `dev`
- Returns decision: `ALLOW`, `REVIEW`, or `BLOCK`
- Generates copy/paste markdown release checklist

API endpoint:
```bash
curl -s -X POST http://localhost:3028/api/deploy-gate \
  -d 'service=payments-api' \
  -d 'environment=production' \
  -d 'policy=strict' \
  --data-urlencode 'plan=Deploy commit abc123 via GitHub Actions. Canary 10% for 15m, rollback via workflow_dispatch rollback.yml. Monitor error rate and p95 latency.'
```

## Roadmap (easy upgrades)
- Add GitHub webhook mode for auto-commenting (maintainer-controlled)
- Add language-specific lint/test runners (optional Docker)
- Add "review queue" sorting by risk score
- Deploy Gate policy profiles (strict/standard/dev)
