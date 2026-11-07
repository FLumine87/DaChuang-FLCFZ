"""验证桥接的运行时增量（修正版）。

上一版测试的用例有误：文本写「心情很糟糕」而图像是 happy 类别的 FER 图，
**语义本来就矛盾**，召不回是合理的。本版修正：
  · 用与图片情绪一致的文本（happy → 「今天特别开心」）
  · 加一个同模态对照：用图片特征查图片单元 —— 同模态码空间一致，
    应当稳定命中自己，用来区分「增量单元没进对码空间」与「跨模态语义不匹配」

场景
----
  1. 桥接加载语料单元（6000 个）
  2. 模拟用户新采集一条图文记录 → add_unit 加入
  3. 文本查图像 → 应能召回该记录的图像单元
  4. 图片查图片（同模态对照）→ 应能召回自己
  5. 落库 → 重载 → 仍能召回
"""
import glob
import os
import sqlite3
import sys

BACKEND = r"D:\zwz\second\Dachuang\DaChuang-FLCFZ\backend"
sys.path.insert(0, BACKEND)

from app.engines.hashing import features as F              # noqa: E402
from app.engines.hashing.bridge_manager import get_bridge_manager  # noqa: E402
from app.engines.hashing.bridge_store import BridgeStore    # noqa: E402
from app.engines.hashing.fer_encoder import FerEncoder      # noqa: E402

DATA_DIR = os.path.join(BACKEND, "data", "hashing")
PAIR = ("text", "image")

mgr = get_bridge_manager(DATA_DIR)
br = mgr.get(PAIR)
if br is None:
    print("✗ 桥接未加载")
    sys.exit(1)
print(f"① 桥接已加载：{len(br.units)} 单元 / {len(br.records)} 记录")

# 用 happy 类别的图 + 语义一致的文本
img_path = [p for p in sorted(glob.glob(r"D:\DaChuang\archive\train\happy\*.jpg"))
            if "Training_51573016" in p] or \
           sorted(glob.glob(r"D:\DaChuang\archive\train\happy\*.jpg"))[:1]
img_path = img_path[0]
enc = FerEncoder()
img_feat = enc.feature(img_path)

RID = "RUNTIME-TEST-0001"
UID = f"{RID}-image"
# 文本与 happy 表情语义一致
TXT = "今天心情特别好，笑得很开心，和朋友一起出去玩了一整天"

text_feat = list(F.semantic_feature(TXT))
print(f"② 新采集：图像 {os.path.basename(img_path)}（happy），文本语义一致")

meta = {
    "record_id": RID, "modality": "image", "tags": ["情绪-高兴"],
    "dataset": "runtime", "source": "runtime", "scope": "public",
    "alert_level": "unknown", "media_path": img_path,
}
ok = br.add_unit(UID, meta, img_feat, modality="image")
print(f"③ add_unit -> {ok}，桥接单元数 {len(br.units)}")

# ④ 文本查图像
hits = br.search(text_feat, "text", top_k=20, result_modality="image")
hit_ids = [h["unit_id"] for h in hits]
found = UID in hit_ids
rank = hit_ids.index(UID) + 1 if found else None
print(f"④ 文本查图像：命中 {len(hits)} 条，新增单元排名 {rank or '未召回'}"
      f"  {'✓' if found else '✗'}")

# ⑤ 同模态对照：图片查图片
hits5 = br.search(list(img_feat), "image", top_k=20, result_modality="image")
ids5 = [h["unit_id"] for h in hits5]
found5 = UID in ids5
rank5 = ids5.index(UID) + 1 if found5 else None
print(f"⑤ 图片查图片（同模态对照）：排名 {rank5 or '未召回'}  "
      f"{'✓' if found5 else '✗'}")

# ⑥ 落库 + 重载
store = BridgeStore(DATA_DIR, PAIR)
n = store.upsert_units({UID: br.units[UID]})
print(f"⑥ 落库 {n} 个单元")
br2 = BridgeStore(DATA_DIR, PAIR).load()
print(f"   重载后 {len(br2.units)} 单元，单元还在: {'✓' if UID in br2.units else '✗'}")
hits6 = br2.search(text_feat, "text", top_k=20, result_modality="image")
found6 = UID in [h["unit_id"] for h in hits6]
rank6 = [h["unit_id"] for h in hits6].index(UID) + 1 if found6 else None
print(f"   重载后文本查图像排名 {rank6 or '未召回'}  {'✓' if found6 else '✗'}")

# 清理
conn = sqlite3.connect(store.units_path)
conn.execute("DELETE FROM bridge_units WHERE unit_id=?", (UID,))
conn.commit()
conn.close()
print("\n⑦ 已清理测试单元")
