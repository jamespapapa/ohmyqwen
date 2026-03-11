#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONSOLE_DIR="$ROOT_DIR/console-next"
RELEASE_DIR="$ROOT_DIR/release"
STAGE_DIR="$RELEASE_DIR/ohmyqwen-console-offline"
VERSION="$(node -e "console.log(require('./console-next/package.json').version)")"
ARCHIVE_NAME="ohmyqwen-console-offline-v${VERSION}.tar.gz"

copy_if_exists() {
  local src="$1"
  local dest="$2"
  if [ -e "$src" ]; then
    mkdir -p "$(dirname "$dest")"
    cp -R "$src" "$dest"
  fi
}

cd "$ROOT_DIR"

pnpm --dir console-next build

rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

copy_if_exists "console-next/package.json" "$STAGE_DIR/package.json"
copy_if_exists "console-next/next.config.mjs" "$STAGE_DIR/next.config.mjs"
copy_if_exists "console-next/.next" "$STAGE_DIR/.next"
copy_if_exists "console-next/public" "$STAGE_DIR/public"
copy_if_exists "console-next/README.md" "$STAGE_DIR/README.md"

pushd "$STAGE_DIR" >/dev/null
npm install --omit=dev
popd >/dev/null

if [ -n "${OHMYQWEN_NODE_RUNTIME_DIR:-}" ] && [ -d "${OHMYQWEN_NODE_RUNTIME_DIR}" ]; then
  cp -R "${OHMYQWEN_NODE_RUNTIME_DIR}" "$STAGE_DIR/node-runtime"
fi

cat > "$STAGE_DIR/.env.example" <<'EOF'
BACKEND_BASE_URL=http://127.0.0.1:4311
PORT=3005
EOF

cat > "$STAGE_DIR/serve-console.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PORT="${PORT:-3005}"
export BACKEND_BASE_URL="${BACKEND_BASE_URL:-http://127.0.0.1:4311}"
if [ -x "$ROOT_DIR/node-runtime/bin/node" ]; then
  exec "$ROOT_DIR/node-runtime/bin/node" "$ROOT_DIR/node_modules/next/dist/bin/next" start -p "$PORT"
fi
exec node "$ROOT_DIR/node_modules/next/dist/bin/next" start -p "$PORT"
EOF
chmod +x "$STAGE_DIR/serve-console.sh"

(
  cd "$RELEASE_DIR"
  rm -f "$ARCHIVE_NAME"
  tar -czf "$ARCHIVE_NAME" ohmyqwen-console-offline
)

echo "Created frontend offline bundle: $RELEASE_DIR/$ARCHIVE_NAME"
