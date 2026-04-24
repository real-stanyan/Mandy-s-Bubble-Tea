#!/usr/bin/env bash
# One-click install for the printer client LaunchAgent.
# Run from anywhere:
#   bash ~/Github/Mandy-s-Bubble-Tea/printer-client/deploy/install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$PKG_DIR/.." && pwd)"
LABEL="com.mandysbubbletea.printer-client"
TEMPLATE="$SCRIPT_DIR/$LABEL.plist"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "==> repo:     $REPO_DIR"
echo "==> package:  $PKG_DIR"

# 1. Pick a stable node binary. Prefer homebrew over nvm — nvm paths change
#    on node upgrades, which silently breaks launchd.
NODE_BIN=""
for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
  if [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: no stable node found at /opt/homebrew/bin/node or /usr/local/bin/node."
  echo "Install via homebrew:  brew install node@20"
  exit 1
fi
echo "==> node:     $NODE_BIN ($("$NODE_BIN" -v))"

# 2. Sanity checks.
if [ ! -f "$PKG_DIR/.env.local" ]; then
  echo "ERROR: $PKG_DIR/.env.local is missing. Copy .env.local.example and fill it in."
  exit 1
fi
if [ ! -f "$TEMPLATE" ]; then
  echo "ERROR: plist template not found at $TEMPLATE"
  exit 1
fi

# 3. Build.
echo "==> npm install && npm run build"
cd "$PKG_DIR"
npm install
npm run build
if [ ! -f "$PKG_DIR/dist/index.js" ]; then
  echo "ERROR: build did not produce dist/index.js"
  exit 1
fi

# 4. Render plist from template.
echo "==> writing $TARGET"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
sed \
  -e "s|REPLACE_NODE|$NODE_BIN|g" \
  -e "s|REPLACE_REPO|$REPO_DIR|g" \
  -e "s|REPLACE_HOME|$HOME|g" \
  "$TEMPLATE" > "$TARGET"

# 5. Reload LaunchAgent.
if launchctl list | grep -q "$LABEL"; then
  echo "==> unloading existing agent"
  launchctl unload "$TARGET" || true
fi
echo "==> loading agent"
launchctl load -w "$TARGET"

# 6. Verify.
sleep 2
if launchctl list | grep -q "$LABEL"; then
  echo "==> installed. tail logs with:"
  echo "    tail -f $HOME/Library/Logs/mandy-printer-client.out.log"
else
  echo "ERROR: launchctl list does not show $LABEL. Check $HOME/Library/Logs/mandy-printer-client.err.log"
  exit 1
fi
