#!/bin/bash
# One-shot status board: is the network ready, is the repo ready, what is left to do.
# Usage: ./check-status.sh
set -u
REPO="/Users/jiaxuan/Documents/DaChuang-FLCFZ"
cd "$REPO" || exit 1

ok()   { printf "  [ OK ] %s\n" "$1"; }
bad()  { printf "  [FAIL] %s\n" "$1"; }
warn() { printf "  [WARN] %s\n" "$1"; }

echo "=============== 1. VPN / proxy ==============="
SYS_PORT=$(scutil --proxy 2>/dev/null | awk -F': ' '/HTTPPort/{print $2; exit}')
echo "  system proxy port: ${SYS_PORT:-none}"
echo "  DNS github.com  -> $(dscacheutil -q host -a name github.com 2>/dev/null | awk '/ip_address/{print $2; exit}')"

PROXY_OK=""
for p in $SYS_PORT 12450 7890 7897 7891 1087 1080 8080 10809 6152 33210; do
  [ -z "$p" ] && continue
  code=$(curl -s -m 6 -x "http://127.0.0.1:$p" -o /dev/null -w "%{http_code}" https://api.github.com 2>/dev/null)
  if [ "$code" = "200" ]; then PROXY_OK="$p"; break; fi
done

if [ -n "$PROXY_OK" ]; then
  ok "proxy works, port $PROXY_OK can reach GitHub"
else
  bad "no working proxy -- GitHub unreachable"
  echo "         -> open your VPN client, SELECT A NODE, test latency"
  echo "         -> verify with: open https://www.google.com"
fi

echo
echo "=============== 2. git proxy config ==============="
GP=$(git config --global --get http.proxy || true)
if [ -n "$GP" ]; then
  ok "http.proxy = $GP"
else
  warn "git has no proxy configured (run ./setup-git-proxy.sh once VPN works)"
fi

echo
echo "=============== 3. local repo ==============="
ok "branch      = $(git rev-parse --abbrev-ref HEAD)"
ok "HEAD        = $(git rev-parse --short HEAD)"
echo "  remotes:"
git remote -v | sed 's/^/         /'
if git remote | grep -qx origin; then
  ok "origin is configured"
else
  bad "origin NOT configured yet -- need the new private repo URL"
fi
AHEAD=$(git rev-list --count old-origin/main..HEAD 2>/dev/null || echo "?")
echo "  commits ahead of old-origin/main: $AHEAD"
if [ "$AHEAD" != "0" ] && [ "$AHEAD" != "?" ]; then
  warn "$AHEAD commits are still UNPUSHED"
fi

echo
echo "=============== 4. branches to push ==============="
for b in main feature/frontend-redesign codex/react-frontend-20261011; do
  if git show-ref --verify --quiet "refs/heads/$b"; then
    printf "  [ OK ] %-34s %s\n" "$b" "$(git rev-parse --short "$b")"
  else
    printf "  [FAIL] %-34s missing\n" "$b"
  fi
done
echo "  tag mobile-v1.0.2: $(git tag -l mobile-v1.0.2 | head -1 || echo missing)"

echo
echo "=============== summary ==============="
if [ -n "$PROXY_OK" ] && git remote | grep -qx origin; then
  echo "  Everything looks ready. Run: ./push-to-new-repo.command <URL>"
else
  echo "  Still blocked. See the FAIL lines above."
fi
