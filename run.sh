#!/usr/bin/env bash
set -euo pipefail
export PORT="${PORT:-3028}"
node server.js
