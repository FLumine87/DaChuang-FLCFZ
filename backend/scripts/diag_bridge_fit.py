"""验证：桥接的码空间里，同一条记录的文码与图码到底有没有对齐。

前面发现（同记录 图码 vs 文码 平均汉明 = 32.51 ≈ 随机），
这与「训练时 W_text·x_text ≈ B[i] ≈ W_image·x_image」的预期矛盾。

分三层测：
  1. 连续向量层：W_text·x_text 与 W_image·x_image 的余弦（训练目标直接对应这层）
  2. 符号化后：连续向量取符号再比汉明
  3. 与 B[i] 的距离：各自的残差有多大（拟合得好不好）

如果第 1 层也不接近 → 岭回归没拟合好，跨模态对齐实际不存在；
如果第 1 层接近但第 2 层不接近 → 是符号化丢信息的问题。
"""
import os
import sys

import numpy as np

BACKEND = r"D:\zwz\second\Dachuang\DaChuang-FLCFZ\backend"
sys.path.insert(0, BACKEND)

from app.engines.hashing.bridge_manager import get_bridge_manager  # noqa: E402
from app.engines.hashing import linalg                          # noqa: E402

DATA_DIR = os.path.join(BACKEND, "data", "hashing")
br = get_bridge_manager(DATA_DIR).get(("text", "image"))
print(f"桥接：{len(br.units)} 单元\n")

by_rec = {}
for uid, m in br.units.items():
    by_rec.setdefault(m["record_id"], {})[m["modality"]] = m

rids = [r for r, v in by_rec.items()
        if "text" in v and "image" in v][:300]
print(f"同记录对：{len(rids)} 条\n")


def cont(meta):
    """用 W 重新算该单元的连续投影向量（长度 K）。"""
    # 从 units 的 code 反推不可行 —— 直接用 meta 里的特征不可得，
    # 改为用「已存的码」与「B」对照：这里改用索引里的连续表示不可得，
    # 所以退而验证：W·x 的结果与符号码的一致性由 encode 保证，
    # 这里只做二值层面的分析。
    return None


# 1) 二值层面：同记录 文码 vs 图码 vs 异记录
def hamming(a, b):
    return sum(1 for x, y in zip(a, b) if x != y)


same, diff = [], []
for i, rid in enumerate(rids):
    t = by_rec[rid]["text"]["code"]
    im = by_rec[rid]["image"]["code"]
    same.append(hamming(t, im))
    if i + 1 < len(rids):
        t2 = by_rec[rids[i + 1]]["text"]["code"]
        diff.append(hamming(t, t2))
print("【二值码层】")
print(f"  同记录 文码 vs 图码: {np.mean(same):.2f}")
print(f"  不同记录 文码 vs 文码: {np.mean(diff):.2f}")
print(f"  差异: {np.mean(same) - np.mean(diff):+.2f}  "
      f"（接近 0 = 没有对齐；明显为负 = 有对齐）")

# 2) 符号层的对应关系：训练时 B[i] 是共享的，
#    若 W_m 拟合好，则 W_text·x_text 与 W_image·x_image 应有高相关。
#    用 encode_continuous 反推：它的实现是「各模态投影求和」，
#    单模态时就是该模态的投影向量。
print("\n【W 拟合质量】用训练样本的连续投影与 B 的关系")
W = br.model.W
B = br.model.B
if B:
    B = np.array(B, dtype=np.float64)
    print(f"  B 的形状: {B.shape}（训练样本的符号化共享码）")
    # B 是训练时按行（记录）排列的，行序与 train_rows 一致；
    # 我们无法直接拿到训练样本的特征，但可以用「同记录的两个模态码」
    # 检验它们是否都靠近 B[i] —— 用符号一致率表示。
    agree = []
    for i, rid in enumerate(rids[:200]):
        t = np.array(by_rec[rid]["text"]["code"], dtype=np.float64)
        im = np.array(by_rec[rid]["image"]["code"], dtype=np.float64)
        # 两者与「彼此」的一致率（若都≈B[i]，应≈100%）
        agree.append(float(np.mean(t == im)))
    print(f"  同记录两模态码的逐位一致率: {np.mean(agree) * 100:.1f}%"
          f"  （随机基线 50%）")

# 3) 看 B 与实际码的关系：B[i] 应当与该记录的文码/图码都高度一致
print("\n【B 与实际码的一致率】")
if B:
    # 训练行序 = build_bridges 里的 rows 顺序（按 by 遍历序），
    # 这里用「码」反查：找 B 中与某记录文码最一致的行
    t0 = np.array(by_rec[rids[0]]["text"]["code"], dtype=np.float64)
    i0 = np.array(by_rec[rids[0]]["image"]["code"], dtype=np.float64)
    best_t = int(np.argmax(np.mean(B == t0, axis=1)))
    best_i = int(np.argmax(np.mean(B == i0, axis=1)))
    print(f"  记录0 文码与 B 最一致的行: {best_t}（一致率 "
          f"{np.mean(B[best_t] == t0) * 100:.1f}%）")
    print(f"  记录0 图码与 B 最一致的行: {best_i}（一致率 "
          f"{np.mean(B[best_i] == i0) * 100:.1f}%）")
    print(f"  → 两者指向同一行? {'是（对齐成功）' if best_t == best_i else '否（未对齐）'}")
