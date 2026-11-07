"""验证：为什么增量单元同模态能召回、跨模态不能。

假设：桥接的跨模态对齐是**训练期**学出来的（W_image 被训到让
W_image·x_image ≈ B[i] ≈ W_text·x_text[i]），增量单元只经过推理编码，
没有参与训练 → 它在图像空间的位置是对的，但缺少与文本码的「实测」对应。

验证三件事：
  A. 新增图像码到「语料图像码」的距离分布 —— 是否落在正常区域
  B. 新增图像码到「语料文本码」的距离分布 —— 是否比 A 远得多
  C. 训练集内某条记录（同一条的文码 vs 图码）作对照 —— 它们的距离应该很小
     （训练时对齐过）
"""
import glob
import os
import sys

import numpy as np

BACKEND = r"D:\zwz\second\Dachuang\DaChuang-FLCFZ\backend"
sys.path.insert(0, BACKEND)

from app.engines.hashing import features as F              # noqa: E402
from app.engines.hashing.bridge_manager import get_bridge_manager  # noqa: E402
from app.engines.hashing.fer_encoder import FerEncoder      # noqa: E402

DATA_DIR = os.path.join(BACKEND, "data", "hashing")
PAIR = ("text", "image")
mgr = get_bridge_manager(DATA_DIR)
br = mgr.get(PAIR)

# 取一个语料里 happy 的记录做对照（训练集内的）
sample_img = [m for m in br.units.values()
               if m["modality"] == "image"][:400]
sample_txt = [m for m in br.units.values()
              if m["modality"] == "text"][:400]
img_codes = np.array([m["code"] for m in sample_img], dtype=np.float64)
txt_codes = np.array([m["code"] for m in sample_txt], dtype=np.float64)


def sign(x):
    # 注意：不能对 0/1 二值码用 >= 0 做符号化（0 会被当成 +1），
    # 这里直接把 0/1 映射到 ±1。
    a = np.asarray(x, dtype=np.float64)
    return np.where(a > 0, 1.0, -1.0)


def ham_mean(a, B):
    """a 与 B 每行的平均汉明距离（0/1 码，两边都要符号化）。"""
    sa = sign(a)
    sb = sign(B)
    return float(np.mean(np.count_nonzero(sa != sb, axis=1)))


# A/B：语料内的交叉距离（基线）
print("【语料内】")
print(f"  图像码 vs 图像码 平均汉明: {ham_mean(img_codes[0], img_codes):.2f}")
print(f"  图像码 vs 文本码 平均汉明: {ham_mean(img_codes[0], txt_codes):.2f}")
print(f"  文本码 vs 文本码 平均汉明: {ham_mean(txt_codes[0], txt_codes):.2f}")

# C：训练集内同一条记录的文码 vs 图码
same_rec = []
by_rec = {}
for m in br.units.values():
    by_rec.setdefault(m["record_id"], {})[m["modality"]] = m
for rid, v in list(by_rec.items())[:400]:
    if "text" in v and "image" in v:
        same_rec.append(ham_mean(v["image"]["code"],
                                 np.array([v["text"]["code"]], dtype=np.float64)))
print(f"  同记录 图码 vs 文码 平均汉明: {np.mean(same_rec):.2f}"
      f"   ← 训练时对齐过，应该明显小")

# 增量单元
img_path = sorted(glob.glob(r"D:\DaChuang\archive\train\happy\*.jpg"))[0]
enc = FerEncoder()
feat = enc.feature(img_path)
RID = "RUNTIME-TEST-0001"
UID = f"{RID}-image"
br.add_unit(UID, {"record_id": RID, "modality": "image", "tags": ["情绪-高兴"],
                  "source": "runtime", "scope": "public"},
            feat, modality="image")
new_code = br.units[UID]["code"]
print("\n【增量单元】")
print(f"  新增图像码 vs 语料图像码 平均汉明: "
      f"{ham_mean(new_code, img_codes):.2f}  ← 与图像库同分布")
print(f"  新增图像码 vs 语料文本码 平均汉明: "
      f"{ham_mean(new_code, txt_codes):.2f}")
print(f"  同记录 图码 vs 文码 平均汉明: {np.mean(same_rec):.2f}"
      f"  ← 新增单元没有这个「对齐过的」对应")

# 清理
import sqlite3  # noqa: E402
from app.engines.hashing.bridge_store import BridgeStore  # noqa: E402
st = BridgeStore(DATA_DIR, PAIR)
conn = sqlite3.connect(st.units_path)
conn.execute("DELETE FROM bridge_units WHERE unit_id=?", (UID,))
conn.commit()
conn.close()
print("\n已清理测试单元")
