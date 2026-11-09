"""每日问询改造验证（定时 → 登录触发，一天一次）。

验证点：
1. 首次调用 /checkin/ensure → created=True，落库一条 pending；
2. 再次调用（模拟刷新/重复登录）→ created=False，且**不新增记录**
   （这就是"一天只问询一次"的核心断言）；
3. pending 接口能拉到这条 → 回复 → 状态变 replied；
4. 答复后再调 ensure → created=False（今天已有，不再弹窗）；
5. 往日遗留的 pending 会被置为 expired（不积压）。

用法：venv/Scripts/python.exe scripts/verify_login_checkin.py
"""

import json
import sqlite3
import urllib.request
from pathlib import Path

DIRECT = "http://127.0.0.1:8001"
DB = Path(__file__).resolve().parent.parent / "mental_screening.db"
UID = "checkin_login_probe"

op = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _req(url, data=None, method=None, timeout=60):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"}, method=method
    )
    return json.loads(op.open(req, timeout=timeout).read().decode())


def _rows(uid=UID):
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    out = [
        dict(r)
        for r in con.execute(
            "SELECT id,user_id,status,source,checkin_date,message FROM daily_checkins "
            "WHERE user_id=? ORDER BY id",
            (uid,),
        )
    ]
    con.close()
    return out


def _clean(uid=UID):
    con = sqlite3.connect(DB)
    con.execute("DELETE FROM daily_checkins WHERE user_id=?", (uid,))
    con.commit()
    con.close()


_clean()
print("=" * 64)
print("每日问询：登录触发 + 一天一次")
print("=" * 64)

# 1) 首次触发
r1 = _req(f"{DIRECT}/api/v1/checkin/ensure?user_id={UID}", {}, "POST")
rows1 = _rows()
print(f"\n[1] 首次 ensure → created={r1['created']} msg={r1['message'][:34]!r}")
print(f"    落库条数={len(rows1)} status={rows1[0]['status']} source={rows1[0]['source']}")
assert r1["created"] is True, "首次应新建"
assert len(rows1) == 1, "首次应只落 1 条"

# 2) 重复触发（模拟刷新 / 反复登录）
r2 = _req(f"{DIRECT}/api/v1/checkin/ensure?user_id={UID}", {}, "POST")
r3 = _req(f"{DIRECT}/api/v1/checkin/ensure?user_id={UID}", {}, "POST")
rows2 = _rows()
print(f"\n[2] 再调两次 → created={r2['created']}/{r3['created']}")
print(f"    落库条数={len(rows2)}（应仍为 1，一天只问一次）")
assert r2["created"] is False and r3["created"] is False, "重复触发不该新建"
assert len(rows2) == 1, f"重复触发后应仍为 1 条，实际 {len(rows2)}"
assert rows2[0]["message"] == rows1[0]["message"], "复用时应返回同一条（同一文案）"

# 3) pending → reply
pend = _req(f"{DIRECT}/api/v1/checkin/pending?user_id={UID}")
print(f"\n[3] 待回复条数={pend['count']}")
assert pend["count"] == 1, "应能拉到这条待回复问询"
cid = pend["pending"][0]["id"]
rep = _req(
    f"{DIRECT}/api/v1/checkin/{cid}/reply",
    {"user_id": UID, "reply": "今天去操场跑了五公里，感觉挺放松的"},
    "POST",
)
print(f"    回复后 status={rep['checkin']['status']} extracted={rep['extracted']}(恒 0)")
assert rep["checkin"]["status"] == "replied"
assert rep["extracted"] == 0, "reply 不抽三元组（避免 cnt 翻倍）"

# 4) 已回复后再触发：今天已有 → 不再新建、不再弹窗
r4 = _req(f"{DIRECT}/api/v1/checkin/ensure?user_id={UID}", {}, "POST")
rows4 = _rows()
print(f"\n[4] 答复后再 ensure → created={r4['created']} 落库={len(rows4)}")
assert r4["created"] is False, "当天已回复也不该重新问"
assert len(rows4) == 1
assert r4["checkin"] and r4["checkin"]["status"] == "replied", "应复用那条已回复记录"

# 5) 往日遗留 pending → 置为 expired
con = sqlite3.connect(DB)
con.execute(
    "INSERT INTO daily_checkins (user_id,message,status,reply,source,checkin_date,created_at,replied_at)"
    " VALUES (?,?,?,?,?,?,?,?)",
    (UID, "昨天没答的问题", "pending", "", "login", "2000-01-01", "2000-01-01T00:00:00", ""),
)
con.commit()
con.close()
r5 = _req(f"{DIRECT}/api/v1/checkin/ensure?user_id={UID}&force=1", {}, "POST")
rows5 = _rows()
stale = [r for r in rows5 if r["checkin_date"] == "2000-01-01"]
pend_after = _req(f"{DIRECT}/api/v1/checkin/pending?user_id={UID}")
print(f"\n[5] force 重生成 → created={r5['created']} expired={r5.get('expired')}")
print(f"    往日 pending 现状 status={stale[0]['status']}")
print(f"    重生成后 pending 条数={pend_after['count']}（应仅今天的 1 条）")
assert stale[0]["status"] == "expired", "往日 pending 应被置为过期"
assert pend_after["count"] == 1, "待回复列表不该积压往日问题"

print("\n" + "=" * 64)
print("全部断言通过：登录触发 · 一天一次 · 往日不积压")
print("=" * 64)
_clean()
