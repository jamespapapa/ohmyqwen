#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "[demo] building project"
pnpm run build

echo "[demo] running dry-run loop"
node dist/cli.js run --input ./samples/request.e2e.json --dry-run

echo "[demo] inspect context"
node dist/cli.js context inspect \
  --task "inspect sample task" \
  --files "src/loop/runner.ts,src/gates/verify.ts" \
  --tier small \
  --budget 1200 \
  --stage PLAN

echo "[demo] done"
