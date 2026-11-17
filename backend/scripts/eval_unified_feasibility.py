"""统一引擎可行性实验：通道化 + 同源分组监督 vs 现状（单一模态通道）。

要回答的问题
------------
现状：主引擎为每个模态只训**一个**投影矩阵 W[modality]，所有数据集的
同模态样本混在一起拟合。加入 AVDD 后这会遇到两个问题：

  ① 特征维度不同：EATD/CSEM 的音频是 MFCC 64 维，AVDD 的声学特征是
     2048 维 —— 根本无法放进同一个 W
  ② 样本量失衡：EATD 486 条 vs CSEM 4160 条（8.6 倍），混在一起时
     岭回归被多数派主导，少数派的分布在拉偏 W

本实验用现有语料做「同模态不同数据集」的模拟：把 EATD 与 CSEMOTIONS 的
audio 通道**拆开**（都是 MFCC 64 维，但来自不同数据集、样本量差 8.6 倍），
与「合并成一个 audio 通道」的现状对比。

三组配置
--------
  A 现状          单一 audio 通道（两数据集混合），sim = 主题 Jaccard
  B 通道化        audio 拆成 audio@EATD-Corpus / audio@CSEMOTIONS 两通道
                  （缺失视图），sim = 主题 Jaccard
  C 通道化+分组   同 B，但同源对（文↔音）用强约束 S=1

评估口径：三组用**同一批查询**（85 条 CSEMOTIONS 音频查询），
否则通道化会因为查询集不同而无法比较。

指标：音搜文 mAP@10（主指标）+ 同源「文码 vs 音码」平均汉明（诊断）。
"""
import json
import os
import random
import sqlite3
import sys
import time

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.engines.hashing import features as F              # noqa: E402
from app.engines.hashing import linalg                     # noqa: E402
from app.engines.hashing.cmfh import OnlineSupervisedCMFH  # noqa: E402
from app.engines.hashing.pairing import (                   # noqa: E402
    PairingRegistry, build_supervision,
)

CORPUS = os.path.join(BACKEND, "data", "hashing", "real_corpus.db")
K = 64
LAMBDA = 0.6
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


def load():
    conn = sqlite3.connect(CORPUS)
    conn.row_factory = sqlite3.Row
    recs = {r["record_id"]: json.loads(r["themes"] or "[]")
            for r in conn.execute("SELECT record_id, themes FROM records")}
    units = [dict(r) for r in conn.execute("SELECT * FROM units")]
    queries = [dict(r) for r in conn.execute("SELECT * FROM queries")]
    conn.close()
    return recs, units, queries


def build_channel_dataset(recs, units):
    """把语料拆成通道：text 通道（bge 531）+ audio@EATD + audio@CSEM（MFCC 64）。

    图像通道不参与（FER2013 是弱配对，队长已把它排除在配对训练外）。
    """
    by_rec = {}
    for u in units:
        by_rec.setdefault(u["record_id"], {})[u.get("modality")] = u

    records = []
    for rid, views in by_rec.items():
        if "text" not in views or "audio" not in views:
            continue
        tu, au = views["text"], views["audio"]
        tf = F.semantic_feature(tu.get("content") or "")
        af = au.get("feature")
        if not af:
            continue
        if isinstance(af, str):
            af = json.loads(af)
        records.append({
            "record_id": rid, "tags": recs.get(rid) or [],
            "dataset": au.get("dataset") or "EATD-Corpus",
            "text": list(tf), "audio": list(af),
        })
    return records


def channels_from(records, split_audio=True):
    """构造通道化特征字典（缺失视图用 None）。"""
    n = len(records)
    feats = {}
    # text 通道：所有记录都有
    feats["text"] = [r["text"] for r in records]
    if split_audio:
        # 拆成两个 audio 通道，各自只覆盖自己数据集的行
        for ds in sorted({r["dataset"] for r in records}):
            vec = [r["audio"] if r["dataset"] == ds else None
                   for r in records]
            if any(v is not None for v in vec):
                feats[f"audio@{ds}"] = vec
    else:
        feats["audio"] = [r["audio"] for r in records]
    return feats


def registry_from(records):
    """文↔音 同源登记（同一记录的两个视图）。"""
    reg = PairingRegistry()
    for r in records:
        reg.declare(r["record_id"], "text", "audio")
    return reg


def build_sim(records, registry=None):
    if registry is None:
        n = len(records)
        sim = [[_jac(records[i]["tags"], records[j]["tags"])
                for j in range(n)] for i in range(n)]
        for i in range(n):
            sim[i][i] = 1.0
        return sim
    units = [{"record_id": r["record_id"], "modality": "text"}
             for r in records] + [{"record_id": r["record_id"],
                                   "modality": "audio"} for r in records]
    return build_supervision(records, units, registry,
                              lambda_strong=1.0, lambda_weak=LAMBDA)


def train(feats, sim):
    m = OnlineSupervisedCMFH(code_length=K, lambda_s=LAMBDA)
    m.fit(feats, sim)
    return m


def encode_all(model, records, channel, key):
    """用指定通道的 W 编码所有记录（连续码）。"""
    out = []
    for r in records:
        vec = None
        if channel == "text":
            vec = r["text"]
        elif channel == "audio":
            vec = r["audio"]
        elif channel.startswith("audio@"):
            ds = channel.split("@", 1)[1]
            vec = r["audio"] if r["dataset"] == ds else None
        if vec is None:
            out.append(None)
            continue
        u = model.encode_continuous({channel: list(vec)})
        out.append([1 if x >= 0 else 0 for x in u])
    return out


def same_source_distance(codes_text, codes_audio):
    """同记录「文码 vs 音码」的汉明距离均值（越小越好）。"""
    dists = []
    for a, b in zip(codes_text, codes_audio):
        if a is None or b is None:
            continue
        dists.append(sum(1 for x, y in zip(a, b) if x != y))
    return (sum(dists) / len(dists) if dists else 0.0), len(dists)


def eval_audio_query(model, records, queries, recs, channel_for_audio,
                     query_ids=None):
    """音频查询 → 文本单元的 mAP@10（用文本通道的码排序）。

    query_ids : 只评估这些查询（保证各配置用**同一批查询**，否则数字不可比）
    """
    codes_text = encode_all(model, records, "text", None)
    codes_audio = encode_all(model, records, channel_for_audio, None)
    idx_of = {r["record_id"]: i for i, r in enumerate(records)}
    aps = []
    for q in queries:
        if q.get("modality") != "audio":
            continue
        if query_ids is not None and q.get("query_id") not in query_ids:
            continue
        rid = q.get("record_id")
        if rid not in idx_of:
            continue
        qi = idx_of[rid]
        aq = codes_audio[qi]
        if aq is None:
            continue
        # 非对称打分：查询用连续向量，库端用 ±1 码
        u = model.encode_continuous({channel_for_audio: list(records[qi]["audio"])})
        s = [x if x >= 0 else -1 for x in u]
        scored = []
        for j, tc in enumerate(codes_text):
            if tc is None:
                continue
            v = [x if x >= 0 else -1 for x in tc]
            scored.append((sum(a * b for a, b in zip(s, v)), j))
        scored.sort(key=lambda x: -x[0])
        ranked = [records[j]["record_id"] for _sc, j in scored[:TOP_K]]
        th = _norm(q.get("themes"))

        def rel(x, own=rid, t=th):
            if x == own:
                return False
            return _jac(t, recs.get(x) or []) >= 0.5
        hits = 0
        total = 0.0
        for i, x in enumerate(ranked, 1):
            if rel(x):
                hits += 1
                total += hits / i
        n_rel = sum(1 for x in ranked if rel(x))
        aps.append(total / min(n_rel, TOP_K) if n_rel else 0.0)
    return (sum(aps) / len(aps) if aps else 0.0), len(aps)


def main():
    recs, units, queries = load()
    records = build_channel_dataset(recs, units)
    print(f"参与训练的记录 {len(records)} 条")
    from collections import Counter
    print("  按数据集:", dict(Counter(r["dataset"] for r in records)))
    print()

    results = {}

    # 评估口径统一：所有配置用**同一批查询**（CSEMOTIONS 的音频查询），
    # 否则「通道化」会因为查询集不同而无法比较。
    csem_qs = {q["query_id"] for q in queries
               if q.get("modality") == "audio"
               and any(r["record_id"] == q.get("record_id")
                       and r["dataset"] == "CSEMOTIONS" for r in records)}
    print(f"统一评估口径：{len(csem_qs)} 条 CSEMOTIONS 音频查询")
    print("（现状训练时 EATD 那 486 条被整组丢弃，所以只能取 CSEM 的查询做对比）\n")

    # --- A 现状：单一 audio 通道，sim=主题 Jaccard ---
    t0 = time.time()
    mA = train(channels_from(records, split_audio=False),
               build_sim(records))
    dA, nA = same_source_distance(
        encode_all(mA, records, "text", None),
        encode_all(mA, records, "audio", None))
    mapA, qA = eval_audio_query(mA, records, queries, recs, "audio", csem_qs)
    results["A_现状"] = {"同源码距": round(dA, 2), "音搜文mAP": round(mapA, 4),
                        "评估查询数": qA}
    print(f"A 现状（单 audio 通道 + 主题 Jaccard）")
    print(f"   同源「文码 vs 音码」平均汉明 {dA:.2f} / 64   （{nA} 对）")
    print(f"   音搜文 mAP@10 = {mapA:.4f}   ({time.time()-t0:.0f}s)")

    # --- B 通道化：audio 拆两通道，sim 仍是主题 Jaccard ---
    t0 = time.time()
    featsB = channels_from(records, split_audio=True)
    mB = train(featsB, build_sim(records))
    # 音→文：用主 audio 通道（CSEM 的 MFCC）编码查询
    main_audio = "audio@" + max(
        {r["dataset"] for r in records},
        key=lambda d: sum(1 for r in records if r["dataset"] == d))
    dB, nB = same_source_distance(
        encode_all(mB, records, "text", None),
        encode_all(mB, records, main_audio, None))
    mapB, qB = eval_audio_query(mB, records, queries, recs, main_audio, csem_qs)
    results["B_通道化"] = {"同源码距": round(dB, 2), "音搜文mAP": round(mapB, 4),
                         "评估查询数": qB}
    print(f"\nB 通道化（audio 拆成 {len(featsB)-1} 个通道 + 缺失视图）")
    print(f"   同源平均汉明 {dB:.2f} / 64   （{nB} 对）")
    print(f"   音搜文 mAP@10 = {mapB:.4f}   ({time.time()-t0:.0f}s)")

    # --- C 通道化 + 同源分组监督 ---
    t0 = time.time()
    reg = registry_from(records)
    mC = train(featsB, build_sim(records, reg))
    dC, nC = same_source_distance(
        encode_all(mC, records, "text", None),
        encode_all(mC, records, main_audio, None))
    mapC, qC = eval_audio_query(mC, records, queries, recs, main_audio, csem_qs)
    results["C_通道化+分组监督"] = {"同源码距": round(dC, 2),
                                "音搜文mAP": round(mapC, 4),
                                "评估查询数": qC}
    print(f"\nC 通道化 + 同源分组监督（文↔音 强约束）")
    print(f"   同源平均汉明 {dC:.2f} / 64   （{nC} 对）")
    print(f"   音搜文 mAP@10 = {mapC:.4f}   ({time.time()-t0:.0f}s)")

    print("\n" + "=" * 72)
    print("汇总（三组用同一批查询，可直接比较）")
    print("=" * 72)
    print(f"{'配置':<22}{'同源码距':>12}{'音搜文mAP':>12}{'查询数':>10}"
          f"{'vs 现状':>12}")
    base = results["A_现状"]["音搜文mAP"]
    for k, v in results.items():
        print(f"{k:<22}{v['同源码距']:>12.2f}{v['音搜文mAP']:>12.4f}"
              f"{v['评估查询数']:>10}{v['音搜文mAP'] - base:>+12.4f}")

    out = os.path.join(BACKEND, "data", "hashing", "eval_unified_feasibility.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"记录数": len(records), "结果": results}, f,
                  ensure_ascii=False, indent=1)
    print(f"\n已写入 {out}")


if __name__ == "__main__":
    main()
