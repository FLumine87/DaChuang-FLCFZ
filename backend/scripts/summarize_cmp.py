"""汇总四组对照实验，输出对比表。"""
import json
import os

BACKEND = r"D:\zwz\second\Dachuang\DaChuang-FLCFZ\backend"
H = os.path.join(BACKEND, "data", "hashing")

RUNS = [
    ("A_手工_三模态配对", "手工192维 + 三模态配对"),
    ("C_CNN_三模态配对", "CNN1280维 + 三模态配对"),
    ("D_手工_图像退出配对", "手工192维 + 图像退出(退化)"),
    ("E_最终默认", "手工192维 + 三模态配对(复跑)"),
]

KEYS = ["文搜文", "文搜音", "文搜图", "音搜文", "音搜音", "音搜图",
        "图搜文", "图搜音", "图搜图"]

res = {}
for tag, desc in RUNS:
    p = os.path.join(H, f"_cmp_{tag}.json")
    if os.path.exists(p):
        res[desc] = json.load(open(p, encoding="utf-8"))

print("=" * 100)
print("四组对照（同语料 653 查询：文397 / 音163 / 图93）")
print("=" * 100)
hdr = f"{'格子':<8}"
for d in res:
    hdr += f"{d[:22]:<24}"
print(hdr)
for k in KEYS:
    line = f"{k:<8}"
    for d in res:
        v = res[d].get(k, {})
        m = v.get("map@10")
        q = v.get("queries")
        line += f"{(f'{m:.4f}({q})' if m is not None else '-'):<24}"
    print(line)
print("-" * 100)
for grp, label in [("group_mean", "分组均值"), ("alignment", "对齐")]:
    line = f"{label:<8}"
    for d in res:
        g = res[d].get(grp, {})
        if grp == "group_mean":
            line += f"{('文音'+str(g.get('text_audio'))+' 图像'+str(g.get('image_related'))):<24}"
        else:
            line += f"{('码距'+str(g.get('text_audio_hamming'))):<24}"
    print(line)
line = f"{'九格均值':<8}"
for d in res:
    g = res[d].get("group_mean", {})
    line += f"{str(g.get('all')):<24}"
print(line)
