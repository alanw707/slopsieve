## Quick start

- `PORT=3028 node server.js`
- Analyze a PR like `owner/repo #123`.

## Architecture

Single-file Node HTTP server + GitHub REST API + public registries (npm, PyPI). No DB, no sessions.
