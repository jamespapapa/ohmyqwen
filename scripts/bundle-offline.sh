#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/release"
STAGE_DIR="$RELEASE_DIR/ohmyqwen-offline"
VERSION="$(node -e "console.log(require('./package.json').version)")"
ARCHIVE_NAME="ohmyqwen-offline-v${VERSION}.tar.gz"

copy_if_exists() {
  local src="$1"
  local dest="$2"
  if [ -e "$src" ]; then
    mkdir -p "$(dirname "$dest")"
    cp -R "$src" "$dest"
  fi
}

cd "$ROOT_DIR"

pnpm run build

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

copy_if_exists "package.json" "$STAGE_DIR/package.json"
copy_if_exists "pnpm-lock.yaml" "$STAGE_DIR/pnpm-lock.yaml"
copy_if_exists "README.md" "$STAGE_DIR/README.md"
copy_if_exists "dist" "$STAGE_DIR/dist"
copy_if_exists "config" "$STAGE_DIR/config"
copy_if_exists "vendor/qmd/dist" "$STAGE_DIR/vendor/qmd/dist"

pnpm install --prod --frozen-lockfile --dir "$STAGE_DIR"

if [ -d ".ohmyqwen/runtime/qmd/models" ]; then
  mkdir -p "$STAGE_DIR/.ohmyqwen/runtime/qmd"
  cp -R ".ohmyqwen/runtime/qmd/models" "$STAGE_DIR/.ohmyqwen/runtime/qmd/"
fi

if [ -n "${OHMYQWEN_NODE_RUNTIME_DIR:-}" ] && [ -d "${OHMYQWEN_NODE_RUNTIME_DIR}" ]; then
  cp -R "${OHMYQWEN_NODE_RUNTIME_DIR}" "$STAGE_DIR/node-runtime"
fi

cat > "$STAGE_DIR/serve-ohmyqwen.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"
export OHMYQWEN_SERVER_TRACE="${OHMYQWEN_SERVER_TRACE:-1}"
export OHMYQWEN_QMD_RUNTIME_ROOT="${OHMYQWEN_QMD_RUNTIME_ROOT:-$ROOT_DIR/.ohmyqwen/runtime/qmd}"
export OHMYQWEN_QMD_VENDOR_ROOT="${OHMYQWEN_QMD_VENDOR_ROOT:-$ROOT_DIR/vendor/qmd}"
export OHMYQWEN_QMD_MODELS_DIR="${OHMYQWEN_QMD_MODELS_DIR:-$ROOT_DIR/.ohmyqwen/runtime/qmd/models}"
echo "[serve-ohmyqwen] OHMYQWEN_SERVER_TRACE=${OHMYQWEN_SERVER_TRACE}"
echo "[serve-ohmyqwen] OHMYQWEN_QMD_RUNTIME_ROOT=${OHMYQWEN_QMD_RUNTIME_ROOT}"
echo "[serve-ohmyqwen] OHMYQWEN_QMD_VENDOR_ROOT=${OHMYQWEN_QMD_VENDOR_ROOT}"
echo "[serve-ohmyqwen] OHMYQWEN_QMD_MODELS_DIR=${OHMYQWEN_QMD_MODELS_DIR}"
if [ -x "$ROOT_DIR/node-runtime/bin/node" ]; then
  exec "$ROOT_DIR/node-runtime/bin/node" "$ROOT_DIR/dist/cli.js" serve
fi
exec node "$ROOT_DIR/dist/cli.js" serve
EOF
chmod +x "$STAGE_DIR/serve-ohmyqwen.sh"

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
