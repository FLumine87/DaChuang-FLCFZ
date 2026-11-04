"""集成路由的端到端验证：走真实接口层 perform_search。

对比「集成前」与「集成后」：
  集成前  图搜文走主引擎（0.2231）
  集成后  图搜文走文-图桥接（0.5776）
本脚本直接调 handlers.retrieval.perform_search，验证路由真的生效。
"""
import asyncio
import json
import os
import sqlite3
import sys
import time

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.engines.hashing import features as F              # noqa: E402
from app.engines.hashing import real_features as RF         # noqa: E402
from app.engines.hashing.fer_encoder import FerEncoder      # noqa: E402
from app.handlers import retrieval                          # noqa: E402
import sqlite3  # noqa: E402

CORPUS = os.path.join(BACKEND, "data", "hashing", "real_corpus.db")
TOP_K = 10


def _norm(x):
    if isinstance(x, str):
        try:
            x = json.loads(x)
        except Exception:
            x = [x]
    return x or []


def _jac(a, b):
    a, b = set(_norm(a)), set(_norm(b))
    u = a | b
    return len(a & b) / len(u) if u else 0.0


def _ap(ranked, rel, k):
    hits = 0
    total = 0.0
    for i, rid in enumerate(ranked[:k], 1):
        if rel(rid):
            hits += 1
            total += hits / i
    n_rel = sum(1 for rid in ranked if rel(rid))
    return total / min(n_rel, k) if n_rel else 0.0


def load():
    conn = sqlite3.connect(CORPUS)
    conn.row_factory = sqlite3.Row
    recs = {r["record_id"]: json.loads(r["themes"] or "[]")
            for r in conn.execute("SELECT record_id, themes FROM records")}
    queries = [dict(r) for r in conn.execute("SELECT * FROM queries")]
    conn.close()
    return recs, queries


async def main():
    recs, queries = load()
    img_q = [q for q in queries if q["modality"] == "image"]
    txt_q = [q for q in queries if q["modality"] == "text"]
    print(f"查询：图 {len(img_q)} 条 / 文 {len(txt_q)} 条\n")

    # --- 图搜文：走接口，modality_filter=text 应命中桥接 ---
    aps, routes = [], {}
    for q in img_q:
        path = q.get("media_path")
        if not path or not os.path.exists(path):
            continue
        with open(path, "rb") as f:
            b64 = _b64(f.read())
        data = {"query": q.get("text") or "", "modality": "image",
                "modality_filter": "text", "top_k": TOP_K,
                "media_base64": b64, "media_name": os.path.basename(path)}
        results, info, modality, mf = await retrieval.perform_search(
            data, default_top_k=TOP_K, viewer=None)
        routes[info.get("route", "?")] = routes.get(info.get("route", "?"), 0) + 1
        ranked, seen = [], set()
        for r in results:
            rid = r.get("record_id")
            if rid in seen:
                continue
            seen.add(rid)
            ranked.append(rid)
        th = _norm(q.get("themes"))

        def rel(rid, own=q.get("record_id"), t=th):
            if rid == own:
                return False
            return _jac(t, recs.get(rid) or []) >= 0.5
        aps.append(_ap(ranked, rel, TOP_K))
    m = sum(aps) / len(aps) if aps else 0
    print(f"【图搜文】走接口 mAP@10 = {m:.4f}  ({len(aps)} 查询)")
    print(f"  路由分布: {routes}")
    print(f"  （集成前主引擎基线 0.2231，桥接离线实测 0.5776）\n")

    # --- 文搜文：走接口，应仍然走主引擎 ---
    aps2 = []
    for q in txt_q:
        data = {"query": q.get("text") or "", "modality": "text",
                "modality_filter": "text", "top_k": TOP_K}
        results, info, *_ = await retrieval.perform_search(
            data, default_top_k=TOP_K, viewer=None)
        routes[info.get("route", "main")] = routes.get(info.get("route", "main"), 0) + 1
        ranked, seen = [], set()
        for r in results:
            rid = r.get("record_id")
            if rid in seen:
                continue
            seen.add(rid)
            ranked.append(rid)
        th = _norm(q.get("themes"))

        def rel(rid, own=q.get("record_id"), t=th):
            if rid == own:
                return False
            return _jac(t, recs.get(rid) or []) >= 0.5
        aps2.append(_ap(ranked, rel, TOP_K))
    m2 = sum(aps2) / len(aps2) if aps2 else 0
    print(f"【文搜文】走接口 mAP@10 = {m2:.4f}  ({len(aps2)} 查询)")
    print(f"  （主引擎基线 0.6394，应基本不变）")
    print(f"\n  路由汇总: {routes}")

    # --- 图查询 + 「全部模态」（前端默认）→ 应走多通道合并 ---
    aps3, routes3 = [], {}
    for q in img_q:
        path = q.get("media_path")
        if not path or not os.path.exists(path):
            continue
        with open(path, "rb") as f:
            b64 = _b64(f.read())
        data = {"query": q.get("text") or "", "modality": "image",
                "top_k": TOP_K, "media_base64": b64,
                "media_name": os.path.basename(path)}
        results, info, *_ = await retrieval.perform_search(
            data, default_top_k=TOP_K, viewer=None)
        r = info.get("route", "?")
        routes3[r] = routes3.get(r, 0) + 1
        ranked, seen = [], set()
        for h in results:
            rid = h.get("record_id")
            if rid in seen:
                continue
            seen.add(rid)
            ranked.append(rid)
        th = _norm(q.get("themes"))

        def rel(rid, own=q.get("record_id"), t=th):
            if rid == own:
                return False
            return _jac(t, recs.get(rid) or []) >= 0.5
        aps3.append(_ap(ranked, rel, TOP_K))
    m3 = sum(aps3) / len(aps3) if aps3 else 0
    print(f"\n【图查询 + 全部模态】走接口 mAP@10 = {m3:.4f}  ({len(aps3)} 查询)")
    print(f"  路由分布: {routes3}")
    print(f"  （集成前主引擎 0.2231；桥接离线 0.5776）")


def _b64(data: bytes) -> str:
    import base64
    return base64.b64encode(data).decode()


if __name__ == "__main__":
    asyncio.run(main())
