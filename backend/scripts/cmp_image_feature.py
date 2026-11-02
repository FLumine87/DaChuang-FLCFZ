"""第 1 步对照实验：主引擎的图像特征用 CNN 还是手工描述子。

背景：主引擎的图像特征一直是 192 维手工描述子（强度分块 + HOG），
而队长实测手工特征的天花板贴着随机线（原始 0.151 / HOG900 0.156 / 拼接 0.165），
独立图像库换微调 MobileNetV2 后同类率到了 0.501。
CNN 特征（models/mobilenetv2-fer.onnx，1280 维）已经存在，但只用在独立图像库，
没有接进主引擎 —— 主引擎的图像查询 mAP 因此只有 0.096。

三组对照（同一份语料、同一套评测）：
  A  手工192维 + 三模态配对训练   （队长原行为）
  B  手工192维 + 图像退出配对     （第 0 步的实验组）
  C  CNN 1280维 + 三模态配对训练  （本步实验组）
"""
import json
import os
import subprocess
import sys
import time

BACKEND = r"D:\zwz\second\Dachuang\DaChuang-FLCFZ\backend"
PY = r"C:\Users\zwz\.workbuddy\binaries\python\envs\default\Scripts\python.exe"

RUNS = [
    ("A_手工_三模态配对", "text,image,audio", "hand"),
    ("B_手工_图像退出配对", "text,audio", "hand"),
    ("C_CNN_三模态配对", "text,image,audio", "cnn"),
]

results = {}
for label, mods, feat in RUNS:
    print("=" * 66, flush=True)
    print(f"实验 {label}   模态={mods}  图像特征={feat}", flush=True)
    print("=" * 66, flush=True)

    env = dict(os.environ)
    env["HASHING_TRAIN_MODALITIES"] = mods
    env["HASHING_IMAGE_FEATURE"] = feat
    env["HASHING_DATA_DIR"] = f"./data/hashing/_cmp_{label}"

    t0 = time.time()
    r = subprocess.run(
        [PY, "scripts/eval_modality_matrix.py",
         "--out", f"data/hashing/_cmp_{label}.json"],
        cwd=BACKEND, env=env, capture_output=True,
        text=True, encoding="utf-8", errors="replace",
    )
    out = (r.stdout or "") + (r.stderr or "")
    print(out[-2500:] if out else "(无输出)", flush=True)
    print(f"耗时 {time.time()-t0:.1f}s\n", flush=True)

    p = os.path.join(BACKEND, "data", "hashing", f"_cmp_{label}.json")
    if os.path.exists(p):
        results[label] = json.load(open(p, encoding="utf-8"))

print("=" * 66)
print("三组对照结果")
print("=" * 66)
keys = ["文搜文", "文搜音", "音搜文", "音搜音"]
labels = [l for l, _, _ in RUNS if l in results]
if labels:
    print(f"{'指标':<12}", end="")
    for l in labels:
        print(f"{l:<22}", end="")
    print()
    for k in keys:
        print(f"{k:<12}", end="")
        for l in labels:
            m = results[l].get(k, {}).get("map@10")
            print(f"{m if m is not None else '-':<22}", end="")
        print()
    print(f"{'文音码距':<12}", end="")
    for l in labels:
        print(f"{results[l].get('alignment',{}).get('text_audio_hamming','-'):<22}", end="")
    print()
    print(f"{'四格均值':<12}", end="")
    for l in labels:
        vs = [results[l].get(k, {}).get("map@10") for k in keys]
        vs = [v for v in vs if v is not None]
        print(f"{(sum(vs)/len(vs) if vs else 0):<22.4f}", end="")
    print()
