"""21 个时间步的动态检索评测。

模拟项目书 4.7.4 的实验口径：先以第一批数据训练初始模型，随后每个时间步注入
新批次，逐步评估检索精度，用跨步标准差衡量抗漂移能力。

对照组
------
static      只在第一步训练一次，后续不重训（当前线上实现的等价形态）
no_weight   每步增量重训，但表权重固定为 1（消融：权重融合的作用）
full        每步增量重训 + 表权重融合（本方案的完整形态）

指标
----
mAP@10      主题相关性（Jaccard >= 0.5 视为相关）
跨步均值、标准差、首末步衰减

用法
----
    python scripts/eval_dynamic.py --steps 21
    python scripts/eval_dynamic.py --steps 5 --quick      # 快速冒烟
"""
import argparse
import datetime
import json
import math
import os
import shutil
import sys
import tempfile
import time

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.config import settings  # noqa: E402
from replay_corpus import load_corpus_records, split_batches, inject_batch, step_date  # noqa: E402


def average_precision(ranked, rel, k=10):
    hits = 0
    score = 0.0
    for i, rid in enumerate(ranked[:k]):
        if rel(rid):
            hits += 1
            score += hits / (i + 1)
    return score / max(1, min(k, hits)) if hits else 0.0


def _train_records(batch, limit=None):
    """把回放批次转成训练用的配对记录。"""
    out = []
    for rec in batch[: limit or len(batch)]:
        views = {u["modality"]: {"text": u["content"], "path": u.get("media_path")}
                 for u in rec["units"] if u["modality"] in ("text", "image", "audio")}
        if views:
            out.append({"record_id": rec["record_id"], "views": views,
                        "tags": rec.get("themes") or []})
    return out


_LOOP = None


def _run_async(coro):
    global _LOOP
    if _LOOP is None:
        import asyncio
        _LOOP = asyncio.new_event_loop()
    return _LOOP.run_until_complete(coro)


def evaluate(engine, batch, top_k=10, query_limit=0):
    """四格评测：文本/音频查询 × 文本/音频结果。

    旧实现只给文本查询的混合 mAP，看不出「文搜文」与「文搜音」各自水平，
    也无法回答「文本特征换成 531 维后，小窗口下是否稳定」。这里按结果模态
    拆开统计，跨步曲线即可反映各能力随增量训练的变化。
    """
    qs = batch[: query_limit] if query_limit else batch
    cells = {"tt": [], "ta": [], "at": [], "aa": []}

    def one(query, modality, media_path, themes, own):
        kw = {"top_k": 30, "viewer": None}
        if media_path:
            kw["media_path"] = media_path
        try:
            hits, _ = _run_async(engine.search_with_info(query, modality=modality, **kw))
        except Exception:
            return {}

        def rel(rid):
            if rid == own:
                return False
            other = engine.records.get(rid) or {}
            ot = set(other.get("tags") or [])
            union = themes | ot
            return bool(union) and len(themes & ot) / len(union) >= 0.5

        out = {}
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
            out[rmod] = average_precision(ranked, rel, top_k)
        return out

    for rec in qs:
        text = next((u["content"] for u in rec["units"] if u["modality"] == "text"), "")
        audio = next((u for u in rec["units"] if u["modality"] == "audio"), None)
        own = rec["record_id"]
        themes = set(rec.get("themes") or [])
        if text:
            r = one(text, "text", None, themes, own)
            if r:
                cells["tt"].append(r["text"])
                cells["ta"].append(r["audio"])
        if audio and audio.get("media_path"):
            r = one(text or "", "audio", audio["media_path"], themes, own)
            if r:
                cells["at"].append(r["text"])
                cells["aa"].append(r["audio"])

    def avg(x):
        return round(sum(x) / len(x), 4) if x else 0.0

    return {
        "map@10": avg(cells["tt"] + cells["ta"]),
        "text2text": avg(cells["tt"]),
        "text2audio": avg(cells["ta"]),
        "audio2text": avg(cells["at"]),
        "audio2audio": avg(cells["aa"]),
        "queries": len(cells["tt"]),
        "audio_queries": len(cells["at"]),
    }


def make_engine(workdir: str, mode: str):
    """构造一个使用独立数据目录的引擎，不污染线上索引。"""
    from app.engines.hashing.engine import DynamicCrossModalHashingEngine
    from app.engines.hashing.store import HashingStore

    engine = DynamicCrossModalHashingEngine()
    engine.state_path = os.path.join(workdir, "hashing_state.json")
    engine.index_db_path = os.path.join(workdir, "index.db")
    engine._store = HashingStore(engine.index_db_path)
    engine._do_initialize()

    if mode == "no_weight":
        # 消融：表权重全部置 1，等价于只按相似度融合
        engine.window_bank.weight = lambda *a, **kw: 1.0
    return engine


def run(mode: str, steps: int, corpus: str, workdir: str, quick: bool = False,
        query_limit: int = 60):
    records = load_corpus_records(corpus)
    batches = split_batches(records, steps)
    engine = make_engine(workdir, mode)

    series = []
    t0 = time.time()

    # 冷启动：先用第一批的一小部分训练初始编码器，否则注入时无模型可用，
    # 全部单元会编码成全零码（相似度恒等），评测结果无意义。
    warm = _train_records(batches[0], limit=120)
    if warm:
        engine._train(warm)
        engine._train_window(0, warm)

    for step in range(steps):
        batch = batches[step]
        if quick:
            batch = batch[:30]
        inject_batch(engine, batch, step, scope="public", enqueue=(mode != "static"))
        if mode == "static":
            if step == 0 and not warm:
                engine.retrain()
        else:
            engine.retrain_pending()
        metrics = evaluate(engine, batch, query_limit=query_limit)
        metrics["step"] = step
        metrics["date"] = step_date(step)
        metrics["elapsed"] = round(time.time() - t0, 1)
        series.append(metrics)
        print(f"[{mode}] step {step:02d} {metrics['date']} "
              f"文搜文={metrics['text2text']:.3f} 文搜音={metrics['text2audio']:.3f} "
              f"音搜文={metrics['audio2text']:.3f} 音搜音={metrics['audio2audio']:.3f} "
              f"q={metrics['queries']} ({metrics['elapsed']}s)", flush=True)

    maps = [m["map@10"] for m in series]
    mean = sum(maps) / len(maps)
    var = sum((x - mean) ** 2 for x in maps) / len(maps)
    summary = {
        "mode": mode,
        "steps": steps,
        "map_mean": round(mean, 4),
        "map_std": round(math.sqrt(var), 4),
        "map_first": maps[0],
        "map_last": maps[-1],
        "decay": round(maps[0] - maps[-1], 4),
        "index_units": len(engine.units),
        "windows": engine.stats().get("windows", {}),
        "series": series,
    }
    return summary


def main():
    ap = argparse.ArgumentParser(description="21 步动态检索评测")
    ap.add_argument("--steps", type=int, default=21)
    ap.add_argument("--mode", default="all", choices=["static", "no_weight", "full", "all"])
    ap.add_argument("--corpus", default="")
    ap.add_argument("--quick", action="store_true", help="每步只用 30 条查询，快速冒烟")
    ap.add_argument("--keep", action="store_true", help="保留临时索引目录")
    ap.add_argument("--query-limit", type=int, default=60,
                    help="每步评测的查询条数（0=全部，默认 60 控制总耗时）")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    modes = ["static", "no_weight", "full"] if args.mode == "all" else [args.mode]
    corpus = args.corpus or settings.HASHING_CORPUS_DB
    results = []
    for mode in modes:
        workdir = tempfile.mkdtemp(prefix=f"eval_{mode}_")
        try:
            results.append(run(mode, args.steps, corpus, workdir,
                               quick=args.quick, query_limit=args.query_limit))
        finally:
            if not args.keep:
                shutil.rmtree(workdir, ignore_errors=True)

    print("\n== 汇总 ==")
    for r in results:
        print(f"{r['mode']:>10}  mAP 均值 {r['map_mean']:.4f}  "
              f"标准差 {r['map_std']:.4f}  首末衰减 {r['decay']:+.4f}  "
              f"单元 {r['index_units']}")

    out = args.out or os.path.join(settings.HASHING_DATA_DIR, "eval_dynamic.json")
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
                   "steps": args.steps, "results": results}, f, ensure_ascii=False, indent=1)
    print("已写入", out)


if __name__ == "__main__":
    main()
