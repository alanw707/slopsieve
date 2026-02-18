#!/usr/bin/env bash
set -euo pipefail
export PORT="${PORT:-3026}"
node server.js
