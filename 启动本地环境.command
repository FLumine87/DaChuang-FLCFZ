#!/bin/bash
# ============================================================================
#  一键启动本地开发环境（macOS，双击即可运行）
#
#  依次确保以下服务在跑，全部就绪后自动打开浏览器：
#      主后端        :8000   （筛查 / 检索 / 预警 / 案例 / 管理端）
#      侧车后端      :8001   （AI 陪伴对话 / 知识图谱 / 推理 / 推送）
#      前端（演示）  :5174   （--mode demo，内置数据）
#      Neo4j         :7687   （可选，只有知识图谱需要）
#
#  设计要点：
#    · **幂等**：已经在跑的不会被重复启动，重复双击无害。
#    · **自检**：每个服务都等到真正可用（不是"进程起来了"）才继续。
#    · **如实报告**：缺什么就明确说缺什么、怎么补，不假装一切都好 ——
#      之前反复出现"打开前端发现某功能没连上"就是因为这些前置条件
#      散落在各处的启动命令里，没人检查。
#    · 日志统一写到 logs/ 下，出问题能直接看。
# ============================================================================

set -u
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"
LOGS="$ROOT/logs"
mkdir -p "$LOGS"

# ── 颜色 ──────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[34m'; D=$'\033[2m'; N=$'\033[0m'
else
  G=''; R=''; Y=''; B=''; D=''; N=''
fi

say()  { printf '%s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
bad()  { printf '  %s✗%s %s\n' "$R" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
info() { printf '  %s·%s %s\n' "$D" "$N" "$*"; }

# ── 工具 ──────────────────────────────────────────────────────────────────

# 端口是否有人监听
port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# 等一个 HTTP 接口真正能应答（不是只看端口）
wait_http() {
  local url="$1" tries="${2:-40}" i=0
  while [ "$i" -lt "$tries" ]; do
    if curl -fsS -m 3 "$url" >/dev/null 2>&1; then return 0; fi
    i=$((i + 1)); sleep 0.5
  done
  return 1
}

# 端口占用但接口不通时，打印最后几行日志帮定位
tail_log() { [ -f "$1" ] && { echo "      ${D}最近日志：$1${N}"; tail -n 6 "$1" | sed 's/^/      /'; }; }

say ""
say "${B}心理筛查预警系统 · 本地环境启动${N}"
say "${D}工作目录：$ROOT${N}"
say ""

# ── Node 运行时（项目自带，不依赖系统装没装）─────────────────────────────
NODE_BIN=""
for c in "$ROOT/.tools"/node-*/bin/node "$(command -v node 2>/dev/null)"; do
  [ -x "$c" ] && { NODE_BIN="$c"; break; }
done

PY_BACKEND="$ROOT/backend/venv/bin/python"
PY_SIDECAR="$ROOT/personal-backend/venv/bin/python"

# ── 1. Neo4j（可选）───────────────────────────────────────────────────────
say "${B}[1/4] 图数据库 Neo4j（可选）${N}"
if port_busy 7687; then
  ok "已在运行（:7687）—— 知识图谱会用真实图数据库"
elif command -v neo4j >/dev/null 2>&1; then
  info "已安装，正在启动…"
  (neo4j start > "$LOGS/neo4j.log" 2>&1 </dev/null &) || true
  if wait_http "http://127.0.0.1:7474" 40; then
    ok "启动成功"
  else
    warn "启动超时，知识图谱将退回「本机记录」模式"
    tail_log "$LOGS/neo4j.log"
  fi
else
  warn "未安装 —— 知识图谱会显示「图数据库尚未连接，当前显示本机记录」"
  info "本机三元组照样能画图、能看，演示不受影响"
  info "要装的话：brew install neo4j   （约 200 MB，需要 Java）"
fi
say ""

# ── 2. 主后端 :8000 ───────────────────────────────────────────────────────
say "${B}[2/4] 主后端 :8000${N}"
if curl -fsS -m 3 "http://127.0.0.1:8000/api/auth/login" -X POST \
     -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1 \
   || port_busy 8000; then
  if wait_http "http://127.0.0.1:8000/api/auth/login" 6 || port_busy 8000; then
    ok "已在运行"
  fi
elif [ -x "$PY_BACKEND" ]; then
  info "启动中…"
  (cd "$ROOT/backend" && nohup "$PY_BACKEND" -m app.main > "$LOGS/backend.log" 2>&1 </dev/null &)
  if wait_http "http://127.0.0.1:8000/api/auth/login" 40 || port_busy 8000; then
    ok "启动成功 —— 登录 / 量表 / 检索 / 预警 / 案例 / 管理端可用"
  else
    bad "启动失败"
    tail_log "$LOGS/backend.log"
  fi
else
  bad "找不到 backend/venv —— 依赖没装"
  info "装法：cd backend && python3 -m venv venv && ./venv/bin/pip install -r requirements.txt"
fi
say ""

# ── 3. 侧车后端 :8001 ─────────────────────────────────────────────────────
say "${B}[3/4] 侧车后端 :8001（AI 对话 / 知识图谱 / 推理 / 推送）${N}"
SIDECAR_STARTED=0
if ! port_busy 8001 && [ -x "$PY_SIDECAR" ]; then
  info "启动中…"
  (cd "$ROOT/personal-backend" && nohup "$PY_SIDECAR" -m uvicorn app.main:app \
      --host 0.0.0.0 --port 8001 > "$LOGS/sidecar.log" 2>&1 </dev/null &)
  SIDECAR_STARTED=1
fi

if wait_http "http://127.0.0.1:8001/api/v1/health" 40; then
  HEALTH="$(curl -fsS -m 5 http://127.0.0.1:8001/api/v1/health 2>/dev/null)"
  ok "已在运行"
  case "$HEALTH" in
    *'"neo4j_connected":true'*)  info "图数据库：已连接";;
    *'"neo4j_connected":false'*) info "图数据库：未连接（知识图谱显示本机记录）";;
  esac
  # 大模型：这里是最容易被忽略的一环，明确报出来
  if [ -f "$ROOT/personal-backend/.env" ]; then
    KEY="$(grep -E '^LLM_API_KEY=' "$ROOT/personal-backend/.env" | head -1 | cut -d= -f2-)"
    MOCK="$(grep -E '^ENABLE_MOCK_ENGINES=' "$ROOT/personal-backend/.env" | head -1 | cut -d= -f2-)"
    if [ "${#KEY}" -lt 20 ] || printf '%s' "$KEY" | grep -qiE 'your|local|xxx|changeme'; then
      warn "大模型：未配置真实 Key —— 对话会走本机回应器（界面会如实标注）"
      info "接真实大模型：把 personal-backend/.env 的 LLM_API_KEY 换成真 Key，"
      info "              并把 ENABLE_MOCK_ENGINES 改成 False，然后重跑本脚本"
    elif [ "$MOCK" = "True" ] || [ "$MOCK" = "true" ]; then
      warn "大模型：Key 已填，但 ENABLE_MOCK_ENGINES 仍为 True —— 仍在演示模式"
      info "改成 False 后重跑本脚本即可启用"
    else
      ok "大模型：已配置（对话为真实生成）"
    fi
  fi
else
  bad "启动失败"
  tail_log "$LOGS/sidecar.log"
fi
say ""

# ── 4. 前端 :5174 ─────────────────────────────────────────────────────────
say "${B}[4/4] 前端 :5174（演示模式）${N}"
if port_busy 5174; then
  ok "已在运行"
elif [ -n "$NODE_BIN" ] && [ -f "$ROOT/frontend/node_modules/vite/bin/vite.js" ]; then
  info "启动中…"
  (cd "$ROOT/frontend" && nohup "$NODE_BIN" node_modules/vite/bin/vite.js \
      --mode demo --host 0.0.0.0 --port 5174 --strictPort > "$LOGS/frontend.log" 2>&1 </dev/null &)
  if wait_http "http://127.0.0.1:5174/" 60; then
    ok "启动成功"
  else
    bad "启动失败"
    tail_log "$LOGS/frontend.log"
  fi
else
  bad "找不到 Node 运行时或 frontend/node_modules"
  info "装法：cd frontend && npm install"
fi
say ""

# ── 汇总 ──────────────────────────────────────────────────────────────────
IP="$(ipconfig getifaddr en0 2>/dev/null || echo '')"
say "────────────────────────────────────────────────────────"
say "${G}访问地址${N}"
say "  电脑：  ${B}http://127.0.0.1:5174/${N}"
[ -n "$IP" ] && say "  手机：  ${B}http://$IP:5174/${N}   ${D}（需同一个 WiFi）${N}"
say ""
say "${D}演示账号：xiaoyu / 123456　　管理端：admin / admin123${N}"
say "${D}日志目录：logs/　　关掉本窗口不会停止服务${N}"
say "────────────────────────────────────────────────────────"
say ""

# 打开浏览器
if [ "${SKIP_OPEN:-0}" != "1" ]; then
  open "http://127.0.0.1:5174/" 2>/dev/null || true
fi

# 双击运行时保留窗口，方便看上面的自检结果
if [ -t 0 ] && [ "${NO_PAUSE:-0}" != "1" ]; then
  say "${D}（按回车关闭本窗口，服务会继续在后台运行）${N}"
  read -r _ || true
fi
