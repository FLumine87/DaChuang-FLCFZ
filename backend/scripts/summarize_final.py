"""最终成果汇总：九格矩阵的通道归属与端到端实测。

数据来源
--------
  主引擎九格        eval_matrix_nine_grid.json（A 组实测，手工特征 + 三模态配对）
  桥接九格          eval_bridge_lambda_text2.json / eval_bridge_lambda_audio.json
  独立图像库        队长分支 image_index.py 的 top-10 同类率 0.501
  端到端            eval_routed_e2e.py（走真实接口层 perform_search）
"""
import json
import os

BACKEND = r"D:\zwz\second\Dachuang\DaChuang-FLCFZ\backend"
H = os.path.join(BACKEND, "data", "hashing")

MAIN = {
    "文搜文": 0.6394, "文搜音": 0.3760, "文搜图": 0.4404,
    "音搜文": 0.3824, "音搜音": 0.3739, "音搜图": 0.2566,
    "图搜文": 0.2231, "图搜音": 0.2439, "图搜图": 0.2343,
}
IMAGE_LIB = 0.5010

# 桥接实测最优
BRIDGE = {
    "图搜文": (0.5776, "文-图桥接", "λ=20, CNN 1280维, K=64"),
    "图搜音": (0.4193, "音-图桥接", "λ=50, CNN 1280维, K=64"),
}

CELLS = ["文搜文", "文搜音", "文搜图", "音搜文", "音搜音", "音搜图",
         "图搜文", "图搜音", "图搜图"]

# 端到端实测（走接口层）
E2E = {
    "图搜文（范围=文本）": (0.5839, "bridge:text-image", 93),
    "图查询（范围=全部模态）": (0.5809, "bridge:multi", 93),
    "文搜文（范围=文本）": (0.6143, "main", 397),
}


def main():
    routed, src = dict(MAIN), {}
    for c in CELLS:
        src[c] = "主引擎"
    for c, (v, name, _) in BRIDGE.items():
        if v > MAIN[c]:
            routed[c], src[c] = v, name
    routed["图搜图"], src["图搜图"] = IMAGE_LIB, "独立图像库"

    print("=" * 78)
    print("跨模态检索九格矩阵 —— 最终状态")
    print("=" * 78)
    print(f"{'格子':<8}{'改进前':>10}{'改进后':>10}  {'通道':<12}{'变化':>10}")
    print("-" * 78)
    for c in CELLS:
        b, n = MAIN[c], routed[c]
        mark = "" if src[c] == "主引擎" else "  ★"
        print(f"{c:<8}{b:>10.4f}{n:>10.4f}  {src[c]:<12}{n-b:>+10.4f}{mark}")
    print("-" * 78)
    b9 = sum(MAIN.values()) / 9
    n9 = sum(routed.values()) / 9
    img = ["文搜图", "音搜图", "图搜文", "图搜音", "图搜图"]
    bi = sum(MAIN[c] for c in img) / 5
    ni = sum(routed[c] for c in img) / 5
    print(f"{'九格均值':<8}{b9:>10.4f}{n9:>10.4f}  {'':<12}{n9-b9:>+10.4f}")
    print(f"{'图像五格':<8}{bi:>10.4f}{ni:>10.4f}  {'':<12}{ni-bi:>+10.4f}")
    ta = ["文搜文", "文搜音", "音搜文", "音搜音"]
    print(f"{'文音四格':<8}{sum(MAIN[c] for c in ta)/4:>10.4f}"
          f"{sum(routed[c] for c in ta)/4:>10.4f}  {'主引擎':<12}"
          f"{sum(routed[c] for c in ta)/4 - sum(MAIN[c] for c in ta)/4:>+10.4f}")
    print("=" * 78)

    print("\n端到端实测（走真实接口层 perform_search）")
    print("-" * 78)
    for k, (v, route, n) in E2E.items():
        print(f"  {k:<26} mAP@10 = {v:.4f}   路由 {route}  ({n} 条)")
    print("\n  说明：接口实测略高于离线值，因为接口传了 modality_filter，")
    print("  走「限定结果模态的索引探测」；九格评测是「混合检索后过滤」，路径不同。")

    out = {
        "说明": "跨模态检索九格矩阵最终状态：改进前 / 改进后 / 通道归属",
        "语料": "real_corpus.db (4646 记录三模态, 653 查询)",
        "改进前_纯主引擎": MAIN,
        "改进后_路由": routed,
        "通道归属": src,
        "九格均值_前": round(b9, 4), "九格均值_后": round(n9, 4),
        "图像五格_前": round(bi, 4), "图像五格_后": round(ni, 4),
        "端到端实测": {k: {"map@10": v, "route": r, "queries": n}
                     for k, (v, r, n) in E2E.items()},
        "桥接参数": {
            "文-图": {"lambda_s": 20, "image_feature": "cnn", "K": 64},
            "音-图": {"lambda_s": 50, "image_feature": "cnn", "K": 64},
        },
    }
    p = os.path.join(H, "eval_final_summary.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"\n已写入 {p}")


if __name__ == "__main__":
    main()
