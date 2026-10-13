#!/usr/bin/env bash
# 同步静态镜像页：最新版放桌面，一改/二改归档到 docs/versions/。
# 用法：bash scripts/sync-html-to-desktop.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/frontend/public/login.html"
DESK="$HOME/Desktop"

[ -f "$SRC" ] || { echo "  ❌ 找不到 $SRC"; exit 1; }

sync_one() {
  local out="$1" label="$2" sub="$3" color="$4" with_badge="$5"
  if [ "$with_badge" = "yes" ]; then
    python3 - "$SRC" "$out" "$label" "$sub" "$color" <<'PY'
import sys, pathlib
src, out, label, sub, color = sys.argv[1:6]
html = pathlib.Path(src).read_text(encoding="utf-8")
badge = f'''
  <div style="position:fixed;right:14px;bottom:14px;z-index:99999;pointer-events:none;display:flex;align-items:center;gap:8px;padding:7px 14px;border-radius:999px;background:{color};color:#fff;font:500 13px/1.4 -apple-system,'PingFang SC',sans-serif;box-shadow:0 8px 24px rgba(16,24,40,.3)">
    <span style="font-weight:600">{label}</span><span style="opacity:.75">{sub}</span>
  </div>
</body>'''
html = html.replace("</body>", badge, 1).replace("<title>", f"<title>[{label}] ", 1)
pathlib.Path(out).write_text(html, encoding="utf-8")
PY
  else
    cp "$SRC" "$out"
  fi
  printf "  ✅ %-44s %s\n" "$(basename "$out")" "$(du -h "$out" | cut -f1)"
}

echo "  源文件: frontend/public/login.html"

# 一改版是历史留存：从 git 里的旧提交取出，绝不用当前文件覆盖
SYNC_OLD="yes"
if [ "${SKIP_OLD:-no}" = "yes" ]; then SYNC_OLD="no"; fi
if [ "$SYNC_OLD" = "yes" ]; then
  git -C "$ROOT" show "${OLD_COMMIT:-0ec5bf5}:frontend/public/login.html" > /tmp/_old_login.html 2>/dev/null \
    && { python3 - /tmp/_old_login.html "$ROOT/docs/versions/心理筛查预警-一改-1012版.html" "一改" "10-12 版 · 登录页初版" "#b42318" <<'PY'
import sys, pathlib
src, out, label, sub, color = sys.argv[1:6]
html = pathlib.Path(src).read_text(encoding="utf-8")
badge = f"""
  <div style="position:fixed;right:14px;bottom:14px;z-index:99999;pointer-events:none;display:flex;align-items:center;gap:8px;padding:7px 14px;border-radius:999px;background:{color};color:#fff;font:500 13px/1.4 -apple-system,'PingFang SC',sans-serif;box-shadow:0 8px 24px rgba(16,24,40,.3)">
    <span style="font-weight:600">{label}</span><span style="opacity:.75">{sub}</span>
  </div>
</body>"""
html = html.replace("</body>", badge, 1).replace("<title>", f"<title>[{label}] ", 1)
pathlib.Path(out).write_text(html, encoding="utf-8")
PY
      printf "  ✅ %-44s %s\n" "docs/versions/心理筛查预警-一改-1012版.html" "$(du -h "$ROOT/docs/versions/心理筛查预警-一改-1012版.html" | cut -f1)"; } \
    || echo "  ⚠️ 一改版恢复失败（git 取不到 0ec5bf5），已跳过"
fi

sync_one "$ROOT/docs/versions/心理筛查预警-二改-1013版.html" "二改" "10-13 版 · 主页 + 登录页拆分" "#067647" "yes"
sync_one "$DESK/心理筛查预警-最新版.html"        "最新" "$(date +%m-%d) 版 · 与仓库同步"  "#465fff" "yes"
echo "  桌面只保留最新版；一改/二改已归档到 docs/versions/"
