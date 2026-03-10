#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/release"
STAGE_DIR="$RELEASE_DIR/ohmyqwen-offline"
VERSION="$(node -e "console.log(require('./package.json').version)")"
ARCHIVE_NAME="ohmyqwen-offline-v${VERSION}.tar.gz"

cd "$ROOT_DIR"

pnpm run build

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

cp -R dist "$STAGE_DIR/"
cp -R docs "$STAGE_DIR/"
cp -R schemas "$STAGE_DIR/"
cp -R samples "$STAGE_DIR/"
cp -R src "$STAGE_DIR/"
cp -R tests "$STAGE_DIR/"
cp -R vendor "$STAGE_DIR/"
cp -R node_modules "$STAGE_DIR/"
if [ -d ".ohmyqwen/runtime/qmd/models" ]; then
  mkdir -p "$STAGE_DIR/.ohmyqwen/runtime/qmd"
  cp -R ".ohmyqwen/runtime/qmd/models" "$STAGE_DIR/.ohmyqwen/runtime/qmd/"
fi
cp package.json "$STAGE_DIR/"
cp pnpm-lock.yaml "$STAGE_DIR/"
cp tsconfig.json "$STAGE_DIR/"
cp README.md "$STAGE_DIR/"
cp .gitignore "$STAGE_DIR/"

if [ -n "${OHMYQWEN_NODE_RUNTIME_DIR:-}" ] && [ -d "${OHMYQWEN_NODE_RUNTIME_DIR}" ]; then
  cp -R "${OHMYQWEN_NODE_RUNTIME_DIR}" "$STAGE_DIR/node-runtime"
fi

(
  cd "$RELEASE_DIR"
  rm -f "$ARCHIVE_NAME"
  tar -czf "$ARCHIVE_NAME" ohmyqwen-offline
)

echo "Created offline bundle: $RELEASE_DIR/$ARCHIVE_NAME"
echo "Closed network run:"
echo "  tar -xzf $ARCHIVE_NAME"
echo "  cd ohmyqwen-offline"
if [ -n "${OHMYQWEN_NODE_RUNTIME_DIR:-}" ] && [ -d "${OHMYQWEN_NODE_RUNTIME_DIR}" ]; then
  echo "  ./node-runtime/bin/node dist/cli.js serve"
else
  echo "  node dist/cli.js serve"
fi
echo ""
echo "Requirements:"
echo "  - bundle must be created on Windows x64 for Windows x64 deployment"
echo "  - .ohmyqwen/runtime/qmd/models must contain local GGUF files when offlineStrict=1"
