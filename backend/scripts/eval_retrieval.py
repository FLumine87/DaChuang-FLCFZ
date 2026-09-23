"""动态跨模态哈希检索的评测脚本（合成语料上的工程链路验证）。

⚠️ 结论口径：本脚本使用 scripts/generate_retrieval_corpus.py 生成的**模拟语料**，
   标签来自生成时的主题设定而非临床标注。因此这里得到的指标用于
   ①验证检索链路是否正确、②比较不同算法/参数配置的相对优劣，
   **不能作为论文中的绝对性能结论**。换成真实数据集后指标口径不变。

Two tasks
------------
T1 跨模态同源实例召回（**诊断指标**）：用查询文本去找**同一条记录的图像/语音单元**。
   本语料的三个模态视图词汇完全不重叠，只有主题级监督，实例级对齐在数学上
   不可辨识（同一主题下多条记录的图像视图无法区分），因此该指标长期接近 0
   是预期现象；接入真实配对多模态数据（CLIP/Whisper 特征）后它才会变得有意义。
   指标：Hit@1、Recall@5、MRR

T2 主题相似检索：用查询文本去找**主题相近的其他记录**
   （相关性 = 主题 Jaccard，≥0.5 记 1 分，>0 记 0.5 分）→ 衡量语义检索能力。
   指标：mAP@10、P@5、Recall@50、nDCG@10，并分「目标模态」报告

⚠️ 口径提醒：T2 的相关性由"主题重叠"定义，而主题语义向量（THEME_WEIGHT）
   是显式特征，权重 ≥0.7 时指标会饱和到 1.0。报告时请同时给出
   --weight-sweep 的曲线与随机基线（lift_vs_random），不要只报饱和值。

用法
----
    python scripts/eval_retrieval.py                 # 完整评测
    python scripts/eval_retrieval.py --limit 40      # 只跑前 40 条查询
    python scripts/eval_retrieval.py --sweep         # 监督项权重 λ_s 敏感性扫描
"""
import argparse
import asyncio
import json
import math
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402
from app.engines.hashing import features as F  # noqa: E402
from app.engines.hashing.engine import DynamicCrossModalHashingEngine  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
CORPUS = settings.HASHING_CORPUS_DB
MODALITIES = ("text", "image", "audio")


def _jaccard(a, b):
    sa, sb = set(a or []), set(b or [])
    u = sa | sb
    return (len(sa & sb) / len(u)) if u else 0.0


def gain(query_themes, record_themes):
    """相关性增益：Jaccard ≥0.5 → 1.0；>0 → 0.5；否则 0。"""
    j = _jaccard(query_themes, record_themes)
    return 1.0 if j >= 0.5 else (0.5 if j > 0 else 0.0)


def load_corpus(path=None):
    import sqlite3
    conn = sqlite3.connect(path or CORPUS)
    conn.row_factory = sqlite3.Row
    try:
        units = [dict(r) for r in conn.execute("SELECT unit_id, record_id, modality FROM units")]
        recs = {r["record_id"]: json.loads(r["themes"] or "[]")
                for r in conn.execute("SELECT record_id, themes FROM records")}
        queries = [dict(r) for r in conn.execute("SELECT * FROM queries ORDER BY query_id")]
    finally:
        conn.close()
    for q in queries:
        q["themes"] = json.loads(q["themes"] or "[]")
    units_of = {}
    for u in units:
        units_of.setdefault(u["record_id"], {})[u["modality"]] = u["unit_id"]
    return recs, units_of, queries


def dedupe_records(hits, keep_modality=None, exclude_record=None):
    """把单元级结果按记录去重（保留排名最靠前的单元），返回 (record_id, modality) 序列。"""
    seen = set()
    out = []
    for h in hits:
        rid = h["record_id"]
        if rid == exclude_record or rid in seen:
            continue
        if keep_modality and h["modality"] != keep_modality:
            continue
        seen.add(rid)
        out.append(rid)
    return out


def ap_at_k(ranked, rel, k):
    """二值相关性的 AP@k（分母取 min(相关总数, k)）。"""
    total = sum(1 for v in rel.values() if v > 0.0)
    if total == 0:
        return None
    hits, s = 0, 0.0
    for i, rid in enumerate(ranked[:k]):
        if rel.get(rid, 0.0) > 0.0:
            hits += 1
            s += hits / (i + 1)
    return s / min(total, k)


def ndcg_at_k(ranked, rel, k):
    dcg = 0.0
    for i, rid in enumerate(ranked[:k]):
        g = rel.get(rid, 0.0)
        if g:
            dcg += g / math.log2(i + 2)
    ideal = sorted((v for v in rel.values() if v > 0), reverse=True)[:k]
    idcg = sum(g / math.log2(i + 2) for i, g in enumerate(ideal))
    return (dcg / idcg) if idcg else None


def recall_at_k(ranked, rel, k):
    total = sum(1 for v in rel.values() if v > 0.0)
    if total == 0:
        return None
    got = sum(1 for rid in ranked[:k] if rel.get(rid, 0.0) > 0.0)
    return got / total


def precision_at_k(ranked, rel, k):
    if not ranked[:k]:
        return None
    return sum(1 for rid in ranked[:k] if rel.get(rid, 0.0) > 0.0) / min(k, len(ranked))


def mean(xs):
    xs = [x for x in xs if x is not None]
    return (sum(xs) / len(xs)) if xs else 0.0


async def evaluate(engine, limit=None, verbose=False, corpus=None):
    recs, units_of, queries = load_corpus(corpus)
    if limit:
        queries = queries[:limit]

    t1_hit1, t1_recall5, t1_mrr = [], [], []
    t2_ap10, t2_p5, t2_rec50, t2_ndcg10 = [], [], [], []
    t2_ap10_by_mod = {m: [] for m in MODALITIES}
    latencies, cand_ratio, fallback = [], [], 0

    for q in queries:
        t0 = time.time()
        hits, info = await engine.search_with_info(q["text"], modality="text", top_k=50)
        latencies.append((time.time() - t0) * 1000)
        if info["index_size"]:
            cand_ratio.append(info["candidates"] / info["index_size"])
        fallback += 1 if info["scanned_all"] else 0

        # ---- T1：同一记录的图像 / 语音单元 ----
        targets = {units_of.get(q["record_id"], {}).get(m)
                   for m in ("image", "audio")}
        targets.discard(None)
        if targets:
            ranked_units = [h["id"] for h in hits]
            pos = [ranked_units.index(t) + 1 for t in targets if t in ranked_units]
            t1_hit1.append(1.0 if pos and min(pos) == 1 else 0.0)
            t1_recall5.append(sum(1 for p in pos if p <= 5) / len(targets))
            t1_mrr.append(1.0 / min(pos) if pos else 0.0)

        # ---- T2：主题相近的其他记录 ----
        rel = {rid: gain(q["themes"], th) for rid, th in recs.items()
               if rid != q["record_id"]}
        ranked = dedupe_records(hits, exclude_record=q["record_id"])
        t2_ap10.append(ap_at_k(ranked, rel, 10))
        t2_p5.append(precision_at_k(ranked, rel, 5))
        t2_rec50.append(recall_at_k(ranked, rel, 50))
        t2_ndcg10.append(ndcg_at_k(ranked, rel, 10))
        for m in MODALITIES:
            ranked_m = dedupe_records(hits, keep_modality=m, exclude_record=q["record_id"])
            t2_ap10_by_mod[m].append(ap_at_k(ranked_m, rel, 10))

        if verbose:
            print(f"    {q['query_id']} 主题{q['themes']} -> " +
                  ", ".join(f"{h['modality_label']}:{h['similarity']:.2f}" for h in hits[:3]))

    lat_sorted = sorted(latencies)
    p95 = lat_sorted[min(len(lat_sorted) - 1, int(len(lat_sorted) * 0.95))]

    # 随机基线：按语料里"相关记录占比"估算随机排序下的 mAP@10，
    # 用于判断模型是否真的优于盲猜（mAP / 随机基线 = 相对提升倍数）
    densities = []
    for q in queries:
        rel = {rid: gain(q["themes"], th) for rid, th in recs.items()
               if rid != q["record_id"]}
        total = sum(1 for v in rel.values() if v > 0.0)
        densities.append(total / max(1, len(rel)))
    random_map = mean(densities)

    return {
        "queries": len(queries),
        "corpus_records": len(recs),
        "T1_cross_modal_same_record": {
            "hit@1": round(mean(t1_hit1), 4),
            "recall@5": round(mean(t1_recall5), 4),
            "mrr": round(mean(t1_mrr), 4),
        },
        "T2_theme_similar_records": {
            "mAP@10": round(mean(t2_ap10), 4),
            "P@5": round(mean(t2_p5), 4),
            "Recall@50": round(mean(t2_rec50), 4),
            "nDCG@10": round(mean(t2_ndcg10), 4),
            "mAP@10_by_target_modality": {m: round(mean(v), 4)
                                          for m, v in t2_ap10_by_mod.items()},
        },
        "efficiency": {
            "latency_mean_ms": round(statistics.mean(latencies), 2),
            "latency_p95_ms": round(p95, 2),
            "candidate_ratio": round(mean(cand_ratio), 4),
            "fallback_rate": round(fallback / max(1, len(queries)), 4),
        },
        "random_baseline_mAP@10": round(random_map, 4),
        "lift_vs_random": round(mean(t2_ap10) / random_map, 2) if random_map else None,
    }


def print_report(res, engine):
    st = engine.stats()
    print(f"\n索引：来源={st['source']} 单元={st['units']} 记录={st['records']} "
          f"码长={st['code_length']} 位带表={st['num_bands']}/窗口 "
          f"保证半径={st['guaranteed_radius']}")
    for t in st["tables"]:
        print(f"  窗口{t['window']}: {t['size']:>4} 单元 σ={t['sigma']:.3f} "
              f"ρ={t['rho']:.3f} {'活跃' if t['active'] else '已淘汰'}")
    t1, t2, eff = (res["T1_cross_modal_same_record"],
                   res["T2_theme_similar_records"], res["efficiency"])
    print(f"\n评测查询数：{res['queries']}")
    print("\nT1 跨模态同源实例召回（诊断指标，本合成语料下预期接近 0）")
    print(f"  Hit@1 {t1['hit@1']:.3f} | Recall@5 {t1['recall@5']:.3f} | MRR {t1['mrr']:.3f}")
    print("\nT2 主题相似检索（文本查询 → 主题相近的其他记录）")
    print(f"  mAP@10 {t2['mAP@10']:.3f} | P@5 {t2['P@5']:.3f} | "
          f"Recall@50 {t2['Recall@50']:.3f} | nDCG@10 {t2['nDCG@10']:.3f}")
    by = t2["mAP@10_by_target_modality"]
    print(f"  按目标模态 mAP@10：文本 {by['text']:.3f} | 图像 {by['image']:.3f} | "
          f"语音 {by['audio']:.3f}")
    print(f"  随机基线 mAP@10 {res['random_baseline_mAP@10']:.3f} → "
          f"相对提升 {res['lift_vs_random']}x")
    print("\n效率")
    print(f"  平均 {eff['latency_mean_ms']:.2f}ms | P95 {eff['latency_p95_ms']:.2f}ms | "
          f"候选占比 {eff['candidate_ratio']:.3f} | 全量回退率 {eff['fallback_rate']:.3f}")


def diagnose(engine, corpus=None):
    """码空间诊断：二值码是否真的把"主题"编码进去了。

    核心看两个数：同主题样本的平均汉明距离 vs 不同主题样本的平均汉明距离。
    两者若接近，说明码位被大量"噪声位"稀释（低方差特征方向），
    对称汉明无法区分主题 —— 这正是需要上「非对称距离」排序的信号。
    """
    units = [(uid, m) for uid, m in engine.units.items()]
    print("\n=== 码空间诊断 ===")
    codes = [m.get("code") or [] for _, m in units]
    packed = {}
    for (uid, m) in units:
        packed[uid] = engine.index._pack(m.get("code") or [])
    print(f"  单元数 {len(codes)} | 唯一码数 {len(set(packed.values()))} | "
          f"码位 {engine.code_length}")
    freq = {}
    for v in packed.values():
        freq[v] = freq.get(v, 0) + 1
    top = sorted(freq.items(), key=lambda x: -x[1])[:3]
    print("  最高频码占比: " + ", ".join(f"{v}/{len(codes)}" for _, v in top))

    by_mod = {m: [(uid, packed[uid], tuple(mm.get("tags") or []))
                  for uid, mm in units if mm.get("modality") == m]
              for m in MODALITIES}

    def pair_stats(mod_a, mod_b, same_theme):
        a, b = by_mod[mod_a], by_mod[mod_b]
        ds = []
        for i, (_, ca, ta) in enumerate(a):
            for j, (_, cb, tb) in enumerate(b):
                if mod_a == mod_b and j <= i:
                    continue
                if not ta or not tb:
                    continue
                if (_jaccard(ta, tb) >= 0.5) != same_theme:
                    continue
                ds.append((ca ^ cb).bit_count())
                if len(ds) >= 3000:
                    return statistics.mean(ds), len(ds)
        return (statistics.mean(ds) if ds else None), len(ds)

    print("  ── 同主题 vs 不同主题的平均汉明距离（差值越大越好）")
    for ma, mb, label in (("text", "text", "文本-文本"),
                          ("text", "image", "文本-图像"),
                          ("text", "audio", "文本-语音"),
                          ("image", "image", "图像-图像")):
        same, n1 = pair_stats(ma, mb, True)
        diff, n2 = pair_stats(ma, mb, False)
        if same is None or diff is None:
            continue
        print(f"    {label}: 同主题 {same:6.2f} (n={n1}) | 不同主题 {diff:6.2f} (n={n2}) "
              f"| 差值 {diff - same:+6.2f}")

    print("  ── 非对称得分的判别力（连续查询向量 · ±1 码）")
    queries = load_corpus(corpus)[2][:20]
    for mod in ("text", "image", "audio"):
        vals = []
        for q in queries:
            u = engine.model.encode_continuous(
                engine._extract_query_features(q["text"], "text"))
            for uid, _, tags in by_mod[mod]:
                if not tags:
                    continue
                g = gain(q["themes"], list(tags))
                if g > 0.0:
                    vals.append((g, engine.index.asym_score(u, engine.units[uid]["code"])))
        pos = [s for g, s in vals if g == 1.0]
        neg = [s for g, s in vals if g == 0.5]
        if pos and neg:
            print(f"    目标模态 {mod}: 同主题均值 {statistics.mean(pos):+.3f} | "
                  f"部分相关均值 {statistics.mean(neg):+.3f} | "
                  f"差值 {statistics.mean(pos) - statistics.mean(neg):+.3f}")


async def main():
    ap = argparse.ArgumentParser(description="跨模态哈希检索评测（合成语料）")
    ap.add_argument("--limit", type=int, default=None, help="只评测前 N 条查询")
    ap.add_argument("--lambda-s", type=float, default=None, help="覆盖语义监督项权重")
    ap.add_argument("--sweep", action="store_true", help="扫描监督项权重 λ_s")
    ap.add_argument("--diagnose", action="store_true", help="输出码空间诊断")
    ap.add_argument("--corpus", default=None, help="覆盖语料库路径（做语料规模对比用）")
    ap.add_argument("--train-max", type=int, default=None, help="训练抽样上限（配对记录数）")
    ap.add_argument("--theme-weight", type=float, default=None, help="主题语义向量权重")
    ap.add_argument("--weight-sweep", action="store_true", help="扫描主题语义向量权重")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--json", default=os.path.join(BACKEND, "data", "hashing", "eval_report.json"))
    args = ap.parse_args()

    if not os.path.exists(CORPUS):
        print(f"未找到语料 {CORPUS}，请先运行 scripts/generate_retrieval_corpus.py")
        return

    # 评测不写正式状态文件，避免影响运行中的服务
    settings.HASHING_DATA_DIR = os.path.join(BACKEND, "data", "hashing", "_eval_tmp")

    if args.sweep:
        print("λ_s 敏感性扫描（mAP@10 / T1-Hit@1 / 候选占比）")
        print(f"{'λ_s':>6} {'mAP@10':>8} {'T1@1':>7} {'T1-R@5':>8} {'P@5':>7} {'候选占比':>9}")
        for lam in (0.0, 0.3, 0.6, 1.2, 2.4, 4.8):
            settings.HASHING_LAMBDA_S = lam
            engine = DynamicCrossModalHashingEngine()
            engine._rebuild()
            res = await evaluate(engine, args.limit)
            t1, t2 = res["T1_cross_modal_same_record"], res["T2_theme_similar_records"]
            print(f"{lam:>6.1f} {t2['mAP@10']:>8.3f} {t1['hit@1']:>7.3f} "
                  f"{t1['recall@5']:>8.3f} {t2['P@5']:>7.3f} "
                  f"{res['efficiency']['candidate_ratio']:>9.3f}")
        return

    if args.weight_sweep:
        print("主题语义向量权重扫描（mAP@10：总体 / 文本 / 图像 / 语音）")
        print(f"{'w':>6} {'mAP@10':>8} {'文本':>7} {'图像':>7} {'语音':>7} {'提升x':>7}")
        for w in (0.0, 0.15, 0.35, 0.7, 1.0):
            F.THEME_WEIGHT = w
            engine = DynamicCrossModalHashingEngine()
            engine._rebuild()
            res = await evaluate(engine, args.limit, corpus=args.corpus)
            t2 = res["T2_theme_similar_records"]
            by = t2["mAP@10_by_target_modality"]
            print(f"{w:>6.2f} {t2['mAP@10']:>8.3f} {by['text']:>7.3f} {by['image']:>7.3f} "
                  f"{by['audio']:>7.3f} {res['lift_vs_random']:>7.2f}")
        return

    if args.corpus:
        settings.HASHING_CORPUS_DB = os.path.abspath(args.corpus)
    if args.theme_weight is not None:
        F.THEME_WEIGHT = args.theme_weight
    if args.lambda_s is not None:
        settings.HASHING_LAMBDA_S = args.lambda_s
    if args.train_max is not None:
        settings.HASHING_TRAIN_MAX = args.train_max
    engine = DynamicCrossModalHashingEngine()
    engine._rebuild()
    if args.diagnose:
        diagnose(engine, args.corpus)
    res = await evaluate(engine, args.limit, args.verbose, args.corpus)
    print_report(res, engine)
    os.makedirs(os.path.dirname(args.json), exist_ok=True)
    with open(args.json, "w", encoding="utf-8") as f:
        json.dump({"settings": {"lambda_s": settings.HASHING_LAMBDA_S,
                                "code_length": settings.HASHING_CODE_LENGTH,
                                "band_bits": settings.HASHING_BAND_BITS},
                   "note": "合成语料上的工程链路验证，非临床/论文性能结论",
                   "result": res}, f, ensure_ascii=False, indent=2)
    print(f"\n报告已写入 {args.json}")


if __name__ == "__main__":
    asyncio.run(main())