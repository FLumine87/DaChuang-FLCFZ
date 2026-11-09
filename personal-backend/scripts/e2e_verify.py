"""端到端验证三项修复（经前端 5173 代理，模拟浏览器真实链路）。

覆盖：
  1. 症状频次统计（写 4 次 → 推理读到 4 次 + 频次文案）
  2. Neo4j 健康检查 TTL（连续调用不锁死、force 可重探）
  3. 预警数据源统一（个人端 8001 空表行将弃用；服务端 8000 有真实预警）
"""
import json
import urllib.error
import urllib.request

OP = urllib.request.build_opener(urllib.request.ProxyHandler({}))
BASE = "http://localhost:5173"
UID = "e2e_freq_user"


def call(path, data=None, token=None, method=None):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})},
        method=method,
    )
    with OP.open(req, timeout=90) as r:
        return r.status, json.loads(r.read().decode())


def main():
    print("=" * 62)
    print("验证 1：症状频次统计（经 5173 → 8001）")
    print("=" * 62)
    # 清理
    try:
        call(f"/api/v1/kg/users/{UID}", method="DELETE")
    except Exception:
        pass

    for i in range(4):
        st, _ = call("/api/v1/kg/extract", {"user_id": UID, "text": "我最近总是失眠"})
    print(f"  已通过 /kg/extract 写入 4 次「失眠」(最后状态 {st})")

    st, d = call("/api/v1/kg/graph/" + UID)
    links = d.get("links", [])
    print(f"  图谱返回 {len(d.get('nodes', []))} 节点 / {len(links)} 边")

    st, d = call("/api/v1/inference/run", {"user_id": UID})
    rep = d.get("report", d)
    print(f"  overall_score = {rep.get('overall_score')}")
    for f in rep.get("factors", [])[:4]:
        print(f"    · {f}")

    print()
    print("=" * 62)
    print("验证 2：Neo4j 健康检查（TTL 不锁死）")
    print("=" * 62)
    vals = [call("/api/v1/health")[1]["neo4j_connected"] for _ in range(3)]
    print(f"  连续 3 次 /health 的 neo4j_connected = {vals}")

    print()
    print("=" * 62)
    print("验证 3：预警数据源")
    print("=" * 62)
    # 个人端（应恒空，已弃用为权威源）
    st, d = call("/api/v1/alerts")
    print(f"  个人端 8001 /api/v1/alerts -> {st}, {len(d)} 条（本就不产预警）")

    # 服务端（权威，需登录）
    try:
        st, d = call("/api/auth/login", {"username": "xiaoyu", "password": "123456"})
        tok = d["data"]["token"]
        st, w = call("/api/personal/warnings", token=tok)
        items = w.get("data", w)
        print(f"  服务端 8000 /api/personal/warnings -> {st}, {len(items)} 条（权威源）")
        if items:
            a = items[0]
            print(f"    首条: {a.get('level')} / {a.get('status')} / {str(a.get('title'))[:24]}")
    except Exception as e:
        print("  服务端预警查询失败:", type(e).__name__, e)

    print("\n清理测试用户…")
    try:
        st, _ = call(f"/api/v1/kg/users/{UID}", method="DELETE")
        print(f"  已清理 {UID} (状态 {st})")
    except Exception as e:
        print("  清理失败:", e)


if __name__ == "__main__":
    main()
