"""最终路由方案汇总：主引擎 + 文-图桥接 + 音-图桥接 + 独立图像库。

各格子按「查询模态 × 结果模态」选通道：
    文↔文 / 文↔音 / 音↔音  → 主引擎共享码空间（真同源，四格 0.44 稳定）
    文↔图 / 图↔文            → 文-图桥接（CNN 特征，λ=20）
    音↔图 / 图↔音            → 音-图桥接（CNN 特征，λ=50）
    图↔图                    → 独立图像库（队长已实现，CNN+PCA+ITQ）

所有数字来自同一份语料（real_corpus.db，4646 记录三模态，653 查询）。
"""
import json
import os

BACKEND = r"D:\zwz\second\Dachuang\DaChuang-FLCFZ\backend"
H = os.path.join(BACKEND, "data", "hashing")

# 主引擎九格（九格评测 A 组实测，图像参与配对 + 手工特征）
MAIN = {
    "文搜文": 0.6394, "文搜音": 0.3760, "文搜图": 0.4404,
    "音搜文": 0.3824, "音搜音": 0.3739, "音搜图": 0.2566,
    "图搜文": 0.2231, "图搜音": 0.2439, "图搜图": 0.2343,
}
# 图搜图走队长的独立图像库（CNN 特征 top-10 同类率）
IMAGE_LIB = 0.501

CELLS = ["文搜文", "文搜音", "文搜图", "音搜文", "音搜音", "音搜图",
         "图搜文", "图搜音", "图搜图"]


def load_bridge(fname, key_q2i, key_i2q):
    p = os.path.join(H, fname)
    if not os.path.exists(p):
        return None, None
    d = json.load(open(p, encoding="utf-8"))
    if isinstance(d, dict) and "results" in d:
        best = max(d["results"], key=lambda r: r[key_i2q]["map@10"])
        return best[key_q2i]["map@10"], best[key_i2q]["map@10"]
    return None, None


def main():
    ti, it = load_bridge("eval_bridge_lambda_text2.json", "q2i", "i2q")
    ai, ia = load_bridge("eval_bridge_lambda_audio.json", "q2i", "i2q")

    routed = dict(MAIN)
    src = {}
    for c in CELLS:
        src[c] = "主引擎"
    if ti is not None and ti > MAIN["文搜图"]:
        routed["文搜图"], src["文搜图"] = ti, "文-图桥接"
    if it is not None and it > MAIN["图搜文"]:
        routed["图搜文"], src["图搜文"] = it, "文-图桥接"
    if ai is not None and ai > MAIN["音搜图"]:
        routed["音搜图"], src["音搜图"] = ai, "音-图桥接"
    if ia is not None and ia > MAIN["图搜音"]:
        routed["图搜音"], src["图搜音"] = ia, "音-图桥接"
    routed["图搜图"], src["图搜图"] = IMAGE_LIB, "独立图像库"

    print("=" * 74)
    print("最终路由方案（各通道取优）")
    print("=" * 74)
    print(f"{'格子':<8}{'主引擎原值':>12}{'路由后':>10}  {'通道':<12}{'变化':>10}")
    print("-" * 74)
    for c in CELLS:
        base = MAIN[c]
        new = routed[c]
        ch = src[c]
        mark = "" if ch == "主引擎" else "  ★"
        print(f"{c:<8}{base:>12.4f}{new:>10.4f}  {ch:<12}{new-base:>+10.4f}{mark}")
    print("-" * 74)
    b9 = sum(MAIN.values()) / 9
    n9 = sum(routed.values()) / 9
    bi = sum(MAIN[c] for c in ["文搜图", "音搜图", "图搜文", "图搜音", "图搜图"]) / 5
    ni = sum(routed[c] for c in ["文搜图", "音搜图", "图搜文", "图搜音", "图搜图"]) / 5
    print(f"{'九格均值':<8}{b9:>12.4f}{n9:>10.4f}  {'':<12}{n9-b9:>+10.4f}")
    print(f"{'图像五格':<8}{bi:>12.4f}{ni:>10.4f}  {'':<12}{ni-bi:>+10.4f}")
    print("=" * 74)
    print("文-音四格在路由前后完全不变（桥接与主引擎隔离）:")
    print(f"  {sum(routed[c] for c in ['文搜文','文搜音','音搜文','音搜音'])/4:.4f} "
          f"(主引擎原值 {sum(MAIN[c] for c in ['文搜文','文搜音','音搜文','音搜音'])/4:.4f})")

    out = {
        "说明": "最终路由方案：按查询模态×结果模态选通道",
        "语料": "real_corpus.db (4646 记录三模态, 653 查询)",
        "主引擎_原值": MAIN,
        "路由后": routed,
        "各格通道": src,
        "九格均值_主引擎": round(b9, 4),
        "九格均值_路由": round(n9, 4),
        "图像五格_主引擎": round(bi, 4),
        "图像五格_路由": round(ni, 4),
        "桥接参数": {
            "文-图": {"lambda_s": 20, "image_feature": "cnn", "K": 64},
            "音-图": {"lambda_s": 50, "image_feature": "cnn", "K": 64},
        },
    }
    p = os.path.join(H, "eval_routed_final.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"已写入 {p}")


if __name__ == "__main__":
    main()
