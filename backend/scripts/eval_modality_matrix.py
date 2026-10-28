"""单模态 / 跨模态检索的矩阵评测。

现有 eval_dynamic 只给混合检索的 mAP，看不出"文搜文"和"文搜音"各自水平。
这里用 queries 表（280 条人工查询）按「查询模态 × 结果模态」拆成四个格子：

             结果文本    结果语音
    文本查询   文搜文      文搜音
    语音查询   音搜文      音搜音

相关性判据与 eval_dynamic 一致：两条记录的主题集合 Jaccard >= 0.5 视为相关，
排除查询自身。同时统计同记录「文本码 vs 语音码」的平均汉明距离，作为共享码
空间对齐紧密度的直接指标（越小说明对齐越紧）。

用法：
    python scripts/eval_modality_matrix.py
    python scripts/eval_modality_matrix.py --out data/hashing/eval_matrix.json
"""
import argparse
import asyncio
import json
import os
import sqlite3
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

CORPUS = os.path.join(BACKEND, "data", "hashing", "real_corpus.db")
TOP_K = 10
CANDIDATES = 30          # 先取大候选，再按结果模态过滤后取前 K
JACCARD_MIN = 0.5


def _jaccard(a, b):
    a, b = set(a or []), set(b or [])
    union = a | b
    return len(a & b) / len(union) if union else 0.0


def _ap(ranked, rel, k):
    """ranked: 记录级、已去重、已按分数排序；rel(rid) -> bool"""
    hits = 0
    total = 0
    for i, rid in enumerate(ranked[:k], 1):
        if rel(rid):
            hits += 1
            total += hits / i
    n_rel = sum(1 for rid in ranked if rel(rid))
    return total / min(n_rel, k) if n_rel else 0.0


def load_queries():
    conn = sqlite3.connect(CORPUS)
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute(
        "SELECT query_id, record_id, text, themes, modality, media_path FROM queries")]
    conn.close()
    return rows


def code_distance(engine):
    """同记录文本码与语音码的平均汉明距离。"""
    by_rec = {}
    for meta in engine.units.values():
        rid = meta.get("record_id")
        mod = meta.get("modality")
        code = meta.get("code")
        if rid and code and mod in ("text", "audio"):
            by_rec.setdefault(rid, {})[mod] = list(code)
    dists = []
    for views in by_rec.values():
        t, a = views.get("text"), views.get("audio")
        if t and a and len(t) == len(a):
            dists.append(sum(1 for x, y in zip(t, a) if x != y))
    return round(sum(dists) / len(dists), 2) if dists else None, len(dists)


async def run(engine, queries):
    cells = {("text", "text"): [], ("text", "audio"): [],
             ("audio", "text"): [], ("audio", "audio"): []}
    skipped = 0

    async def ev(q, qmod):
        text = (q.get("text") or "").strip()
        path = q.get("media_path")
        if not text:
            return None
        kw = {"query": text, "modality": qmod, "top_k": CANDIDATES, "viewer": None}
        if qmod == "audio":
            if not path or not os.path.exists(path):
                return None
            kw["media_path"] = path
        hits, _info = await engine.search_with_info(**kw)
        own = q.get("record_id")
        themes = q.get("themes") or []
        if isinstance(themes, str):
            try:
                themes = json.loads(themes)
            except Exception:
                themes = []
        return hits, own, themes

    for q in queries:
        qmod = q.get("modality")
        if qmod not in ("text", "audio"):
            continue
        res = await ev(q, qmod)
        if res is None:
            skipped += 1
            continue
        hits, own, themes = res

        def rel(rid, own=own, themes=themes):
            if rid == own:
                return False
            other = engine.records.get(rid) or {}
            return _jaccard(themes, other.get("tags")) >= JACCARD_MIN

        # 按结果模态过滤，记录级去重（保留最高分）
        for rmod in ("text", "audio"):
            seen, ranked = set(), []
            for h in hits:
                if h.get("modality") != rmod:
                    continue
                rid = h.get("record_id") or h.get("id")
                if rid in seen:
                    continue
                seen.add(rid)
                ranked.append(rid)
            cells[(qmod, rmod)].append(_ap(ranked, rel, TOP_K))
    return cells, skipped


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    from app.engines import get_hashing_engine
    engine = get_hashing_engine()
    engine._do_initialize()

    queries = load_queries()
    print(f"查询 {len(queries)} 条（文 {sum(1 for q in queries if q['modality']=='text')} / "
          f"音 {sum(1 for q in queries if q['modality']=='audio')}）")

    cells, skipped = asyncio.run(run(engine, queries))
    print(f"跳过 {skipped} 条（缺文本或音频文件）\n")

    labels = {("text", "text"): "文搜文", ("text", "audio"): "文搜音",
              ("audio", "text"): "音搜文", ("audio", "audio"): "音搜音"}
    print(f"{'格子':<8}{'mAP@10':>10}{'查询数':>8}")
    result = {}
    for key, label in labels.items():
        aps = cells[key]
        m = round(sum(aps) / len(aps), 4) if aps else 0.0
        result[label] = {"map@10": m, "queries": len(aps)}
        print(f"{label:<8}{m:>10.4f}{len(aps):>8}")

    dist, n = code_distance(engine)
    result["alignment"] = {"text_audio_hamming": dist, "records": n}
    print(f"\n同记录文本-语音码平均汉明距离 {dist} / 64 位（{n} 条记录）")
    print(f"索引：{len(engine.units)} 单元 / {len(engine.records)} 记录")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=1)
        print(f"已写入 {args.out}")


if __name__ == "__main__":
    main()
