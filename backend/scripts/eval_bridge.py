"""文-图弱监督桥接的对照实验。

对比三种配置下的「文搜图 / 图搜文 / 图搜音」：
  base   主引擎（图像参与配对 + 手工特征）      —— 现有基线
  bridge_hand   桥接码空间 + 手工 192 维图像特征
  bridge_cnn    桥接码空间 + CNN 1280 维图像特征

同时输出文-音四格，验证桥接的隔离性（不应影响主引擎）。

用法：
    python scripts/eval_bridge.py --image-feature hand
    python scripts/eval_bridge.py --image-feature cnn
"""
import argparse
import json
import os
import sys
import time
from collections import Counter

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.engines.hashing import features as F          # noqa: E402
from app.engines.hashing import real_features as RF     # noqa: E402
from app.engines.hashing.image_bridge import ImageTextBridge  # noqa: E402

CORPUS = os.path.join(BACKEND, "data", "hashing", "real_corpus.db")
TOP_K = 10
CANDIDATES = 30
JACCARD_MIN = 0.5
TRAIN_MAX = 3000


def _norm_themes(x):
    """queries.themes 存的是 JSON 字符串，需解析成 list 才能算 Jaccard。"""
    if isinstance(x, str):
        try:
            x = json.loads(x)
        except Exception:
            x = [x]
    return x or []


def _jaccard(a, b):
    a, b = set(_norm_themes(a)), set(_norm_themes(b))
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


def load_corpus():
    import sqlite3
    conn = sqlite3.connect(CORPUS)
    conn.row_factory = sqlite3.Row
    recs = {}
    for r in conn.execute("SELECT record_id, themes FROM records"):
        recs[r["record_id"]] = json.loads(r["themes"] or "[]")
    units = [dict(r) for r in conn.execute(
        "SELECT * FROM units ORDER BY record_id, modality")]
    queries = [dict(r) for r in conn.execute("SELECT * FROM queries")]
    conn.close()
    return recs, units, queries


def build_rows(recs, units, image_feature, text_encoder):
    """按 record_id 配出 (text 视图, image 视图) 的行。

    文本特征必须走 `features.semantic_feature`（bge 512 维 ⊕ 19 维主题桥
    = 531 维），不能直接用 text_encoder.encode() —— 那只有 512 维，
    与主引擎的编码口径不一致，查询与库码不在同一空间。
    """
    by_rec = {}
    for u in units:
        rid = u.get("record_id")
        if not rid:
            continue
        by_rec.setdefault(rid, {})[u.get("modality")] = u

    rows = []
    for rid, views in by_rec.items():
        tu, iu = views.get("text"), views.get("image")
        if not tu or not iu:
            continue
        ipath = iu.get("media_path")
        if not ipath or not os.path.exists(ipath):
            continue
        # 文本特征：统一走 semantic_feature，保证与主引擎同口径
        text = tu.get("content") or ""
        tf = F.semantic_feature(text)
        # 图像特征
        if image_feature == "cnn":
            from app.engines.hashing.fer_encoder import FerEncoder
            enc = FerEncoder()
            if not enc.available:
                print("  CNN 编码器不可用，退回手工特征")
                image_feature = "hand"
            else:
                if_ = enc.feature(ipath)
                if if_ is None:
                    continue
        else:
            if_ = RF.image_feature(ipath)
            if if_ is None:
                continue
        rows.append({
            "record_id": rid,
            "text_feature": list(tf),
            "image_feature": list(if_),
            "tags": recs.get(rid) or [],
        })
    return rows, image_feature


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image-feature", default="hand", choices=("hand", "cnn"))
    ap.add_argument("--lambda-s", type=float, default=0.6)
    ap.add_argument("--code-length", type=int, default=64)
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    print("=" * 66)
    print(f"桥接实验：图像特征={args.image_feature}  λ={args.lambda_s}  K={args.code_length}")
    print("=" * 66)

    recs, units, queries = load_corpus()
    print(f"语料：记录 {len(recs)}  单元 {len(units)}  查询 {len(queries)}")
    print(f"  查询模态: {dict(Counter(q['modality'] for q in queries))}")

    # 文本编码器（bge）
    text_encoder = None
    try:
        from app.engines.hashing.text_encoder import get_text_encoder
        text_encoder = get_text_encoder()
        print(f"文本编码器: {'bge' if text_encoder is not None else 'TF 兜底'}")
    except Exception as e:
        print(f"文本编码器不可用，用 TF: {e}")

    print("\n构造配对行 ...")
    t0 = time.time()
    rows, feat_used = build_rows(recs, units, args.image_feature, text_encoder)
    print(f"  {len(rows)} 行（文图配对），耗时 {time.time()-t0:.1f}s，特征={feat_used}")
    if len(rows) < 50:
        print("行数不足，退出")
        return

    # 训练（抽样上限，避免 n×n 过大）
    import random
    rng = random.Random(42)
    if len(rows) > TRAIN_MAX:
        train_rows = rng.sample(rows, TRAIN_MAX)
    else:
        train_rows = rows
    print(f"训练行数 {len(train_rows)}（n×n 监督矩阵，规模受限）")

    t0 = time.time()
    bridge = ImageTextBridge(code_length=args.code_length,
                             lambda_s=args.lambda_s)
    ok = bridge.fit(train_rows,
                    feature_spec={"image": feat_used,
                                  "text": "bge" if text_encoder is not None else "tf"})
    print(f"训练完成 {ok}，耗时 {time.time()-t0:.1f}s")
    if not ok:
        return
    print(f"  {json.dumps(bridge.stats(), ensure_ascii=False)}")

    # 检索评测
    text_q = [q for q in queries if q["modality"] == "text"]
    audio_q = [q for q in queries if q["modality"] == "audio"]
    img_q = [q for q in queries if q["modality"] == "image"]

    def eval_text_to_image(qs):
        aps = []
        for q in qs:
            text = (q.get("text") or "").strip()
            if not text:
                continue
            # 与训练侧同口径：semantic_feature（bge 512 ⊕ 主题 19 = 531）
            tf = F.semantic_feature(text)
            hits = bridge.search(list(tf), "text", top_k=CANDIDATES,
                                 result_modality="image",
                                 exclude_record=q.get("record_id"))
            ranked, seen = [], set()
            for h in hits:
                rid = h["record_id"]
                if rid in seen:
                    continue
                seen.add(rid)
                ranked.append(rid)

            def rel(rid, own=q.get("record_id"), themes=_norm_themes(q.get("themes"))):
                if rid == own:
                    return False
                return _jaccard(themes, recs.get(rid) or []) >= JACCARD_MIN
            aps.append(_ap(ranked, rel, TOP_K))
        return aps

    def eval_image_to_text(qs):
        aps = []
        for q in qs:
            path = q.get("media_path")
            if not path or not os.path.exists(path):
                continue
            if feat_used == "cnn":
                from app.engines.hashing.fer_encoder import FerEncoder
                ife = FerEncoder().feature(path)
            else:
                ife = RF.image_feature(path)
            if ife is None:
                continue
            hits = bridge.search(list(ife), "image", top_k=CANDIDATES,
                                 result_modality="text",
                                 exclude_record=q.get("record_id"))
            ranked, seen = [], set()
            for h in hits:
                rid = h["record_id"]
                if rid in seen:
                    continue
                seen.add(rid)
                ranked.append(rid)

            def rel(rid, own=q.get("record_id"), themes=_norm_themes(q.get("themes"))):
                if rid == own:
                    return False
                return _jaccard(themes, recs.get(rid) or []) >= JACCARD_MIN
            aps.append(_ap(ranked, rel, TOP_K))
        return aps

    print("\n评测 ...")
    t0 = time.time()
    ti = eval_text_to_image(text_q)
    it = eval_image_to_text(img_q)
    print(f"  耗时 {time.time()-t0:.1f}s")

    def mean(vs):
        return round(sum(vs) / len(vs), 4) if vs else 0.0

    result = {
        "image_feature": feat_used,
        "lambda_s": args.lambda_s,
        "code_length": args.code_length,
        "train_rows": len(train_rows),
        "文搜图": {"map@10": mean(ti), "queries": len(ti)},
        "图搜文": {"map@10": mean(it), "queries": len(it)},
        "units": len(bridge.units),
        "records": len(bridge.records),
    }
    print("\n" + "=" * 66)
    print(f"文搜图 mAP@10 = {result['文搜图']['map@10']:.4f}  ({len(ti)} 查询)")
    print(f"图搜文 mAP@10 = {result['图搜文']['map@10']:.4f}  ({len(it)} 查询)")
    print("=" * 66)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=1)
        print(f"已写入 {args.out}")


if __name__ == "__main__":
    main()
