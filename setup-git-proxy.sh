#!/bin/bash
# Detect the local VPN/proxy port and configure git to use it.
#
# Usage:
#   ./setup-git-proxy.sh          auto-detect (really verifies it can reach GitHub)
#   ./setup-git-proxy.sh 7890     use a specific port
#   ./setup-git-proxy.sh off      clear the proxy config
set -u

if [ "${1:-auto}" = "off" ]; then
  git config --global --unset http.proxy 2>/dev/null
  git config --global --unset https.proxy 2>/dev/null
  echo "[OK] git proxy config cleared"
  exit 0
fi

TEST_URL="https://api.github.com"
PORT="${1:-auto}"

proxy_works() {
  local p="$1"
  local code
  code=$(curl -s -m 8 -x "http://127.0.0.1:$p" -o /dev/null -w "%{http_code}" "$TEST_URL" 2>/dev/null)
  [ "$code" = "200" ]
}

if [ "$PORT" = "auto" ]; then
  SYS_PORT=$(scutil --proxy 2>/dev/null | awk -F': ' '/HTTPPort/{print $2; exit}')
  CANDIDATES="$SYS_PORT 12450 7890 7897 7891 1087 1080 8080 10809 6152 33210"
  echo "candidates: $CANDIDATES"
  PORT=""
  for p in $CANDIDATES; do
    [ -z "$p" ] && continue
    printf "  testing 127.0.0.1:%-6s ... " "$p"
    if proxy_works "$p"; then
      echo "OK"
      PORT="$p"
      break
    else
      echo "no"
    fi
  done
  if [ -z "$PORT" ]; then
    echo
    echo "[FAIL] no usable proxy port found."
    echo "       A port may be listening but still unable to reach GitHub,"
    echo "       which means the VPN client has no working node selected."
    echo "       Pick a node in your VPN client, then rerun this script."
    exit 1
  fi
  echo "[OK] usable proxy port: $PORT"
fi

git config --global http.proxy "http://127.0.0.1:$PORT"
git config --global https.proxy "http://127.0.0.1:$PORT"
echo "written:"
echo "  http.proxy  = $(git config --global --get http.proxy)"
echo "  https.proxy = $(git config --global --get https.proxy)"

echo
echo "verifying git can reach GitHub ..."
if git ls-remote --heads https://github.com/FLumine87/DaChuang-FLCFZ.git >/dev/null 2>&1; then
  echo "  [OK] git connected to GitHub"
else
  echo "  [FAIL] git still cannot reach GitHub"
fi
