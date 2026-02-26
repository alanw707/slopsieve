# SlopSieve

PR triage dashboard to spot AI-slop risk patterns (dependency hallucinations, missing tests, leaked secrets, oversized diffs) and generate a human verification checklist.

## CI Integration

Add SlopSieve to any repo in 30 seconds.

When a PR modifies `.github/workflows/*.yml` or `.yaml`, the action now auto-runs **Cost Gate** on those workflow files and appends CI cost findings to the PR comment.

```yaml
name: SlopSieve PR Review
on:
  pull_request:
    types: [opened, synchronize, reopened]
jobs:
  slopsieve:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: alanw707/slopsieve@main
        with:
          fail_on_high: 'true'
          policy: 'standard'
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

**Inputs**

| Input | Description | Default |
| --- | --- | --- |
| `fail_on_high` | Fail the CI check if risk is HIGH | `true` |
| `policy` | Policy profile: strict, standard, or dev | `standard` |
| `github_token` | GitHub token for API access | `${{ github.token }}` |

Note: works on public repos without a token, private repos need `GITHUB_TOKEN` with `pull-requests: write`.

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

## Cost Gate Mode (new)
- Paste GitHub Actions workflow YAML or CI logs
- Detects duplicate jobs, oversized runners, missing cache, flaky retries, broad matrix, long sequential jobs, missing `timeout-minutes`, and Docker cache misses
- Outputs estimated monthly waste (runner-minutes), recommendations, and an optimized YAML diff

API endpoint:
```bash
curl -s -X POST http://localhost:3028/api/cost-gate \
  --data-urlencode 'workflow=name: CI\non: [pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: npm test'
```

## Roadmap (easy upgrades)
- Add GitHub webhook mode for auto-commenting (maintainer-controlled)
- Add language-specific lint/test runners (optional Docker)
- Add "review queue" sorting by risk score
- Cost Gate rule tuning with repo history baselines
