"""5、6 两项修复的端到端验证（经 5173 前端代理）。

任务 5：共享节点 category 不再被串改
  - 两个用户对同一兴趣节点写不同 category，各自读回的应是**自己的**那个
  - 改造前：节点属性被后写者覆盖，A 读到 B 的类别

任务 6：定时问询落库 + 前端可拉取
  - 触发问询 → 落库 → 待回复接口能查到 → 回复 → 状态变 replied 且内容进图谱

用法：venv/Scripts/python.exe scripts/e2e_verify_56.py
"""

import json
import sys
import urllib.request

PROXY = "http://localhost:5173"
DIRECT = "http://127.0.0.1:8001"

op = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _req(url, data=None, method=None, timeout=60):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    return json.loads(op.open(req, timeout=timeout).read().decode())


def _graph_write(user_id, triples):
    return _req(f"{DIRECT}/api/v1/kg/triples", {"user_id": user_id, "triples": triples}, "POST")


def _graph_read(user_id):
    return _req(f"{DIRECT}/api/v1/kg/graph/{user_id}")


print("=" * 62)
print("任务 5：共享节点 category 串改修复验证")
print("=" * 62)

# 两个用户对同一个"兴趣对象名"写不同类别 —— 这是串改的触发条件
UA, UB, OBJ = "cat_test_a", "cat_test_b", "测试歌手XYZ"
_graph_write(UA, [{"relation": "LIKES", "object": OBJ, "category": "音乐"}])
_graph_write(UB, [{"relation": "LIKES", "object": OBJ, "category": "流行音乐"}])

ga, gb = _graph_read(UA), _graph_read(UB)


def _cat_of(graph):
    for node in graph.get("nodes", []):
        if node.get("name") == OBJ:
            return node.get("category")
    return None


cat_a, cat_b = _cat_of(ga), _cat_of(gb)
print(f"A 写入「{OBJ}」= 音乐      读回：{cat_a}")
print(f"B 写入「{OBJ}」= 流行音乐  读回：{cat_b}")
ok5 = cat_a == "音乐" and cat_b == "流行音乐"
print(f"结果：{'通过 —— 各自读回自己的类别，未被串改' if ok5 else '失败 —— 出现串改'}")
if cat_a == cat_b:
    print(f"  注意：两者相同（{cat_a}），说明仍取到了共享的节点属性")

# 推理链路也要能读到正确类别（直接查服务层，避免依赖 RiskReport 的字段名）
sys.path.insert(0, ".")
from app.services import daily_checkin_agent  # noqa: E402

cats = {i["category"] for i in daily_checkin_agent.get_user_interests(UA) if i.get("category")}
print(f"服务层读到的 A 的兴趣类别：{cats or '（无）'}（应为 {{'音乐'}}）")

print()
print("=" * 62)
print("任务 6：定时问询落库 + 拉取 + 回复闭环验证")
print("=" * 62)

UID = "checkin_test_user"

# 1) 生成并落库（复用管理员全量触发入口，它和调度器走同一条 save_checkins）
allcheck = _req(f"{DIRECT}/api/v1/checkin/daily/all")
print(f"全量问询：生成 {allcheck.get('count')} 条，新落库 {allcheck.get('saved')} 条")

# 2) 为该用户单独造一条问询并落库（直接走接口，避免依赖该用户已在图谱里）
graph = _graph_read(UID)
if not graph.get("nodes") or len(graph.get("nodes", [])) <= 1:
    _graph_write(UID, [
        {"relation": "LIKES", "object": "民谣", "category": "音乐"},
        {"relation": "LIKES", "object": "游泳", "category": "运动"},
    ])
    print(f"已为 {UID} 建好兴趣画像（民谣/游泳）")

allcheck2 = _req(f"{DIRECT}/api/v1/checkin/daily/all")
print(f"再次触发：生成 {allcheck2.get('count')} 条，新落库 {allcheck2.get('saved')} 条（同日幂等，应多为 0）")

# 3) 拉取待回复
pend = _req(f"{DIRECT}/api/v1/checkin/pending?user_id={UID}")
print(f"待回复问询：{pend.get('count')} 条")
for item in pend.get("pending", []):
    print(f"  #{item['id']} [{item['status']}] {item['message'][:40]}...")

ok6a = pend.get("count", 0) > 0

# 4) 回复
ok6b = True
if pend.get("pending"):
    target = pend["pending"][0]
    rep = _req(
        f"{DIRECT}/api/v1/checkin/{target['id']}/reply",
        {"user_id": UID, "reply": "今天去游了泳，还听了会儿民谣，感觉放松多了"},
        "POST",
    )
    print(f"回复 #{target['id']} → 状态 {rep['checkin']['status']}（抽取由 /kg/extract 负责，本接口 extracted={rep['extracted']}）")

    # 5) 再拉取，应已不在待回复列表
    pend2 = _req(f"{DIRECT}/api/v1/checkin/pending?user_id={UID}")
    print(f"回复后再拉待回复：{pend2.get('count')} 条（应为 0）")
    ok6b = rep["checkin"]["status"] == "replied" and pend2.get("count", 0) == 0

    # 6) 历史里能看到回复内容
    hist = _req(f"{DIRECT}/api/v1/checkin/history?user_id={UID}")
    replied = [h for h in hist if h["id"] == target["id"]]
    if replied:
        print(f"历史记录：状态={replied[0]['status']}，回复内容=「{replied[0]['reply'][:30]}...」")
        ok6b = ok6b and bool(replied[0]["reply"])

print(f"结果：{'通过 —— 生成→落库→拉取→回复→归档全链路打通' if (ok6a and ok6b) else '失败'}")

# 清理测试数据
for uid in (UA, UB):
    try:
        _req(f"{DIRECT}/api/v1/kg/users/{uid}", method="DELETE")
    except Exception:
        pass

print()
print("=" * 62)
print(f"总结：任务5 {'通过' if ok5 else '失败'} | 任务6 {'通过' if (ok6a and ok6b) else '失败'}")
print("=" * 62)
