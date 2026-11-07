"""最终汇总：所有通道在同一口径下的九格矩阵。

口径统一（与 scripts/eval_modality_matrix.py 完全一致）：
  · 主引擎通道：top_k=30 的混合检索，按结果模态过滤后算 AP@10
  · 桥接通道：  top_k=30 的桥接检索（result_modality 过滤）算 AP@10
  · 独立图像库：top-10 同类率（队长 image_index.py 的口径）
每个格子取各通道的最好值，并记录是哪个通道贡献的。

对照基线：纯主引擎（新语料），即「只有队长那套」的状态。
"""
import json
import os
import sys

BACKEND = r"D:\zwz\second\Dachuang\DaChuang-FLCFZ\backend"
sys.path.insert(0, BACKEND)

from app.engines.hashing import features as F              # noqa: E402
from app.engines.hashing import real_features as RF         # noqa: E402
from app.engines.hashing.fer_encoder import FerEncoder      # noqa: E402
from app.engines.hashing.bridge_manager import get_bridge_manager  # noqa: E402
import sqlite3  # noqa: E402

DATA_DIR = os.path.join(BACKEND, "data", "hashing")
CORPUS = os.path.join(DATA_DIR, "real_corpus.db")
TOP_K = 10
CANDIDATES = 30
JACCARD_MIN = 0.5
IMAGE_LIB = 0.5010   # 队长的独立图像库 top-10 同类率


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


def main():
    conn = sqlite3.connect(CORPUS)
    conn.row_factory = sqlite3.Row
    recs = {r["record_id"]: json.loads(r["themes"] or "[]")
            for r in conn.execute("SELECT record_id, themes FROM records")}
    queries = [dict(r) for r in conn.execute("SELECT * FROM queries")]
    conn.close()

    from app.engines import get_hashing_engine
    engine = get_hashing_engine()
    engine._do_initialize()
    mgr = get_bridge_manager(DATA_DIR)
    br_t = mgr.get(("text", "image"))
    br_a = mgr.get(("audio", "image"))
    enc = FerEncoder()
    print(f"桥接就绪：text-image {br_t is not None} / audio-image {br_a is not None}\n")

    import asyncio

    async def run():
        # 主引擎：混合检索后按结果模态过滤
        main_rank = {}
        for qmod in ("text", "audio", "image"):
            main_rank[qmod] = {}
            for q in queries:
                if q["modality"] != qmod:
                    continue
                path = q.get("media_path")
                if qmod in ("image", "audio"):
                    if not path or not os.path.exists(path):
                        continue
                hits, _ = await engine.search_with_info(
                    query=q.get("text") or "", modality=qmod,
                    top_k=CANDIDATES, viewer=None, media_path=path)
                by_mod = {}
                for h in hits:
                    rm = h.get("modality")
                    rid = h.get("record_id") or h.get("id")
                    if rid not in by_mod:
                        by_mod.setdefault(rm, []).append(rid)
                for rm, ids in by_mod.items():
                    main_rank[qmod].setdefault(rm, []).append((q, ids))

        # 桥接
        bridge_rank = {}
        for pair, qmod, rmod in ((br_t, "text", "image"),
                                 (br_t, "image", "text"),
                                 (br_a, "audio", "image"),
                                 (br_a, "image", "audio")):
            if pair is None:
                continue
            bridge_rank.setdefault((qmod, rmod), [])
            for q in queries:
                if q["modality"] != qmod:
                    continue
                if qmod == "text":
                    fv = list(F.semantic_feature(q.get("text") or ""))
                else:
                    path = q.get("media_path")
                    if not path or not os.path.exists(path):
                        continue
                    fv = (enc.feature(path) if qmod == "image"
                          else RF.audio_feature(path))
                    if fv is None:
                        continue
                hits = pair.search(fv, qmod, top_k=CANDIDATES,
                                   result_modality=rmod)
                ids, seen = [], set()
                for h in hits:
                    rid = h["record_id"]
                    if rid not in seen:
                        seen.add(rid)
                        ids.append(rid)
                bridge_rank[(qmod, rmod)].append((q, ids))
        return main_rank, bridge_rank

    main_rank, bridge_rank = asyncio.run(run())

    def score_main(qmod, rmod):
        aps = []
        for q, ids in main_rank.get(qmod, {}).get(rmod, []):
            th = _norm(q.get("themes"))

            def rel(rid, own=q.get("record_id"), t=th):
                if rid == own:
                    return False
                return _jac(t, recs.get(rid) or []) >= JACCARD_MIN
            aps.append(_ap(ids, rel, TOP_K))
        return (sum(aps) / len(aps) if aps else 0.0), len(aps)

    def score_bridge(qmod, rmod):
        aps = []
        for q, ids in bridge_rank.get((qmod, rmod), []):
            th = _norm(q.get("themes"))

            def rel(rid, own=q.get("record_id"), t=th):
                if rid == own:
                    return False
                return _jac(t, recs.get(rid) or []) >= JACCARD_MIN
            aps.append(_ap(ids, rel, TOP_K))
        return (sum(aps) / len(aps) if aps else 0.0), len(aps)

    CELLS = [("text", "text", "文搜文"), ("text", "audio", "文搜音"),
             ("text", "image", "文搜图"), ("audio", "text", "音搜文"),
             ("audio", "audio", "音搜音"), ("audio", "image", "音搜图"),
             ("image", "text", "图搜文"), ("image", "audio", "图搜音"),
             ("image", "image", "图搜图")]

    print("=" * 78)
    print("统一口径的九格矩阵（各通道取优）")
    print("=" * 78)
    print(f"{'格子':<8}{'纯主引擎':>10}{'路由后':>10}  {'贡献通道':<14}{'变化':>10}")
    print("-" * 78)
    base, routed, src = {}, {}, {}
    for qmod, rmod, name in CELLS:
        m, n = score_main(qmod, rmod)
        base[name] = m
        best, best_src = m, "主引擎"
        if (qmod, rmod) in bridge_rank:
            b, _ = score_bridge(qmod, rmod)
            if b > best:
                best, best_src = b, "桥接"
        if name == "图搜图" and IMAGE_LIB > best:
            best, best_src = IMAGE_LIB, "独立图像库"
        routed[name] = best
        src[name] = best_src
        print(f"{name:<8}{m:>10.4f}{best:>10.4f}  {best_src:<14}{best-m:>+10.4f}")
    print("-" * 78)
    b9 = sum(base.values()) / 9
    r9 = sum(routed.values()) / 9
    img = ["文搜图", "音搜图", "图搜文", "图搜音", "图搜图"]
    bi = sum(base[c] for c in img) / 5
    ri = sum(routed[c] for c in img) / 5
    ta = ["文搜文", "文搜音", "音搜文", "音搜音"]
    print(f"{'九格均值':<8}{b9:>10.4f}{r9:>10.4f}  {'':<14}{r9-b9:>+10.4f}")
    print(f"{'图像五格':<8}{bi:>10.4f}{ri:>10.4f}  {'':<14}{ri-bi:>+10.4f}")
    print(f"{'文音四格':<8}{sum(base[c] for c in ta)/4:>10.4f}"
          f"{sum(routed[c] for c in ta)/4:>10.4f}  {'主引擎':<14}"
          f"{sum(routed[c] for c in ta)/4 - sum(base[c] for c in ta)/4:>+10.4f}")
    print("=" * 78)

    out = {"说明": "统一口径的九格矩阵：纯主引擎 vs 路由后",
           "口径": "top_k=30 混合检索后按结果模态过滤（与 eval_modality_matrix.py 一致）",
           "纯主引擎": {k: round(v, 4) for k, v in base.items()},
           "路由后": {k: round(v, 4) for k, v in routed.items()},
           "贡献通道": src,
           "九格均值_前": round(b9, 4), "九格均值_后": round(r9, 4),
           "图像五格_前": round(bi, 4), "图像五格_后": round(ri, 4)}
    p = os.path.join(DATA_DIR, "eval_unified_final.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"已写入 {p}")


if __name__ == "__main__":
    main()
