"""第 0 步对照实验：图像是否参与共享码空间的配对训练。

对照组 A：HASHING_TRAIN_MODALITIES = ("text","image","audio")  ← 队长原行为
实验组 B：HASHING_TRAIN_MODALITIES = ("text","audio")            ← 图像退出配对

两组用同一份语料、同一份查询，跑 eval_modality_matrix.py 的四格指标
（文搜文 / 文搜音 / 音搜文 / 音搜音）+ 同记录文音码距离。
"""
import json
import os
import subprocess
import sys
import time

BACKEND = r"D:\zwz\second\Dachuang\DaChuang-FLCFZ\backend"
PY = r"C:\Users\zwz\.workbuddy\binaries\python\envs\default\Scripts\python.exe"

RUNS = [
    ("A_含图像配对", ("text", "image", "audio")),
    ("B_图像退出配对", ("text", "audio")),
]

for label, mods in RUNS:
    print("=" * 66, flush=True)
    print(f"实验 {label}   HASHING_TRAIN_MODALITIES={mods}", flush=True)
    print("=" * 66, flush=True)

    env = dict(os.environ)
    env["HASHING_TRAIN_MODALITIES"] = ",".join(mods)
    # 隔离状态与索引，避免上一组残留（HASHING_DATA_DIR 同时决定状态文件与 index.db）
    env["HASHING_DATA_DIR"] = f"./data/hashing/_cmp_{label}"

    t0 = time.time()
    r = subprocess.run(
        [PY, "scripts/eval_modality_matrix.py",
         "--out", f"data/hashing/_cmp_{label}.json"],
        cwd=BACKEND, env=env, capture_output=True,
        text=True, encoding="utf-8", errors="replace",
    )
    out = (r.stdout or "") + (r.stderr or "")
    print(out[-3000:] if out else "(无输出)", flush=True)
    print(f"耗时 {time.time()-t0:.1f}s", flush=True)
    print()

print("=" * 66)
print("对照结果")
print("=" * 66)
res = {}
for label, _ in RUNS:
    p = os.path.join(BACKEND, "data", "hashing", f"_cmp_{label}.json")
    if os.path.exists(p):
        res[label] = json.load(open(p, encoding="utf-8"))
    else:
        print(f"  缺文件: {label}")

if res:
    keys = ["文搜文", "文搜音", "音搜文", "音搜音"]
    print(f"{'指标':<10}", end="")
    for label, _ in RUNS:
        print(f"{label:<18}", end="")
    print()
    for k in keys:
        print(f"{k:<10}", end="")
        for label, _ in RUNS:
            v = res.get(label, {}).get(k, {})
            m = v.get("map@10")
            print(f"{m if m is not None else '-':<18}", end="")
        print()
    print(f"{'文音码距':<10}", end="")
    for label, _ in RUNS:
        al = res.get(label, {}).get("alignment", {})
        print(f"{al.get('text_audio_hamming', '-'):<18}", end="")
    print()
    # 平均
    print(f"{'四格均值':<10}", end="")
    for label, _ in RUNS:
        vs = [res.get(label, {}).get(k, {}).get("map@10") for k in keys]
        vs = [v for v in vs if v is not None]
        print(f"{sum(vs)/len(vs):<18.4f}" if vs else f"{'-':<18}", end="")
    print()
