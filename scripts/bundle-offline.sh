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
cp -R node_modules "$STAGE_DIR/"
cp package.json "$STAGE_DIR/"
cp pnpm-lock.yaml "$STAGE_DIR/"
cp tsconfig.json "$STAGE_DIR/"
cp README.md "$STAGE_DIR/"
cp .gitignore "$STAGE_DIR/"

(
  cd "$RELEASE_DIR"
  rm -f "$ARCHIVE_NAME"
  tar -czf "$ARCHIVE_NAME" ohmyqwen-offline
)

echo "Created offline bundle: $RELEASE_DIR/$ARCHIVE_NAME"
echo "Closed network run:"
echo "  tar -xzf $ARCHIVE_NAME"
echo "  cd ohmyqwen-offline"
echo "  npx --no-install ohmyqwen run"
