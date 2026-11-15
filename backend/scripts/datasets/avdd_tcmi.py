"""AVDD-TCMI 适配器（华西医院面诊，中文，音+图，医生诊断标签）。

数据集
------
四川大学华西医院 HDS 子集（临床确诊）+ 中学 SDS 子集（筛查）：
    AVDD-TCMI-dataset/
        HDS/
            0/
                0_tcm/0/{que,mingtang,ting}.jpg   中医面诊区域图
                0_acoustic.csv                     1024 维帧级声学特征
                0_visual.csv                       OpenFace 2.0 视觉特征
            1/ ...
        HDS_labels.csv     id, label(0/1), gender(f/m)
        SDS_labels.csv
共 1230 条有效样本（969 非抑郁 / 261 抑郁），许可 cc-by-nc-4.0。

为什么它对跨模态检索特别重要
---------------------------
**这是本项目目前唯一「图像 ↔ 音频」真同源的数据集** ——
同一个人面诊时的面部图与语音。EATD/CSEMOTIONS 的同源是「文↔音」，
FER2013 的图像与任何模态都不同源（表情图 vs 自述语音）。

主引擎把 FER2013 的图像当第三模态塞进共享码空间时，图像视图没有任何
真同源伙伴，只能被主题标签牵着走 —— 这就是图搜文只有 0.26 的根因。
AVDD 补上这条真同源边之后，图像侧第一次有了**硬约束**。

特征口径
--------
音频：acoustic.csv 的 1024 维帧级特征池化成 2048 维（均值 + 标准差）。
      **不 PCA 到 64 维去套主引擎的 W_audio** —— 那是「维度对齐 ≠ 语义对齐」：
      主引擎的 W_audio 学的是「MFCC 空间的 64 维 → 哈希码」，
      AVDD 的声学特征是另一套特征空间，PCA 到同维后落在哈希空间错误位置。
      本适配器把 2048 维作为**独立特征通道**（audio@AVDD-TCMI）参与训练，
      各通道有各自的投影矩阵，但共享同一个码空间。
图像：TCM 面诊区域图用与 FER2013 同一提取器（HOG 192 维），
      作为独立通道 image@AVDD-TCMI。

同源声明
--------
record 上带 `same_source_pairs = [("audio", "image")]`，由上层
（app/engines/hashing/pairing.py）转成监督矩阵里的强约束。
"""
import csv
import io
import os

from . import base

DATASET_NAME = "AVDD-TCMI"
SUBSETS = ("HDS", "SDS")

# 中医面诊区域（队长的 build_avdd_corpus.py 用同一顺序）
TCM_REGIONS = ("que", "mingtang", "ting")

# 临床确诊（医院）vs 筛查（学校）—— 标签性质不同，不能混为一谈
SUBSET_THEME = {
    "HDS": ("临床确诊", "临床对照"),
    "SDS": ("筛查阳性", "筛查阴性"),
}


def discover(root):
    """返回 (解压根, 可用子集列表)。

    兼容两种形态：
      A. 已解压：<root>/AVDD-TCMI-dataset/{HDS,SDS}/...
      B. 只有 zip：<root>/AVDD-TCMI-dataset.zip —— 由调用方先解压
    """
    inner = root
    if os.path.isdir(os.path.join(root, "AVDD-TCMI-dataset")):
        inner = os.path.join(root, "AVDD-TCMI-dataset")
    elif os.path.isdir(os.path.join(root, "HDS")):
        inner = root
    subs = [s for s in SUBSETS if os.path.isdir(os.path.join(inner, s))]
    return inner, subs


def _read_labels(inner, subset):
    """读 {subset}_labels.csv → {id: (label, gender)}。"""
    path = os.path.join(inner, f"{subset}_labels.csv")
    labels = {}
    if not os.path.exists(path):
        return labels
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f):
            if len(row) >= 3:
                try:
                    lab = int(row[1])
                except ValueError:
                    continue
                labels[str(row[0]).strip()] = (lab, str(row[2]).strip().lower())
    return labels


def _pool_acoustic(path):
    """1024 维帧级声学特征 → 2048 维（均值 + 标准差）。"""
    import numpy as np
    try:
        arr = np.atleast_2d(np.loadtxt(path, delimiter=","))
    except Exception:
        return None
    if arr.size == 0:
        return None
    arr = np.nan_to_num(arr.astype(np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    return np.concatenate([arr.mean(axis=0), arr.std(axis=0)]).astype(np.float32)


def _find_tcm_image(inner, subset, sid):
    """在 {sid}_tcm/ 下找一张面诊区域图（按 TCM_REGIONS 顺序取第一张存在的）。"""
    for region in TCM_REGIONS:
        for cand in (
            os.path.join(inner, subset, sid, f"{sid}_tcm", "0", f"{region}.jpg"),
            os.path.join(inner, subset, sid, f"{sid}_tcm", f"{region}.jpg"),
        ):
            if os.path.exists(cand):
                return cand, region
    # 兜底：递归找第一张 jpg
    tcm_dir = os.path.join(inner, subset, sid, f"{sid}_tcm")
    if os.path.isdir(tcm_dir):
        for dirpath, _dirs, files in os.walk(tcm_dir):
            for fn in files:
                if fn.lower().endswith((".jpg", ".jpeg", ".png")):
                    return os.path.join(dirpath, fn), os.path.splitext(fn)[0]
    return None, None


def _themes(subset, label, gender):
    pos = "抑郁-阳性" if label == 1 else "抑郁-阴性"
    clinic = SUBSET_THEME.get(subset, ("阳性", "阴性"))[
        0 if label == 1 else 1]
    sex = "性别-女" if gender == "f" else "性别-男"
    return [f"AVDD-{subset}", pos, clinic, sex]


def build(root, rng, records_per_class=None, sample_max=None, **kw):
    """构建 AVDD-TCMI 的 records / units。

    每条记录两个单元：audio（2048 维声学特征）+ image（TCM 面诊图）。
    两者**真同源**（同一人的面诊），record 上带 same_source_pairs 声明。
    """
    from app.engines.hashing import real_features as RF

    inner, subs = discover(root)
    if not subs:
        raise SystemExit(
            f"AVDD-TCMI：未在 {root} 下找到 {subs} 之一；"
            f"请先解压 AVDD-TCMI-dataset.zip")

    limit = kw.get("limit") or 0
    records, units = [], []
    skipped = []

    for subset in subs:
        labels = _read_labels(inner, subset)
        if not labels:
            continue
        ids = sorted(labels,
                      key=lambda x: (0, int(x)) if str(x).isdigit() else (1, 0))
        if limit:
            ids = ids[:limit]

        for n, sid in enumerate(ids, 1):
            label, gender = labels[sid]
            acoustic = os.path.join(inner, subset, sid, f"{sid}_acoustic.csv")
            img_path, region = _find_tcm_image(inner, subset, sid)
            if not os.path.exists(acoustic):
                skipped.append((sid, "缺少 acoustic.csv"))
                continue
            if not img_path:
                skipped.append((sid, "缺少 TCM 面诊图"))
                continue
            afeat = _pool_acoustic(acoustic)
            if afeat is None:
                skipped.append((sid, "acoustic 解析失败"))
                continue

            rid = f"AVDD-{subset}-{sid}"
            themes = _themes(subset, label, gender)
            created, window = base.simulated_created(len(records))
            alert = "orange" if label == 1 else "green"

            # 音频单元：特征直接给（不落 media_path，因为没有 wav）
            audio_unit = {
                "unit_id": f"{rid}-aud",
                "record_id": rid, "modality": "audio",
                "content": f"面诊语音特征 {subset}/{sid}"
                           f"（{region} 区望诊同期）",
                "themes": list(themes), "alert_level": alert,
                "created_at": created, "window": window,
                "media_path": None, "media_kind": "acoustic_features",
                "feature": [float(x) for x in afeat],
                "dataset": DATASET_NAME,
                "meta": {"subset": subset, "subject": sid,
                         "region": region, "n_frames_dim": int(len(afeat) // 2)},
            }
            # 图像单元：TCM 面诊区域图
            image_unit = base.make_image_unit(
                rid, img_path, themes, alert, created, window,
                DATASET_NAME, media_kind="tcm_region_image")
            if image_unit is None:
                skipped.append((sid, "图像特征抽取失败"))
                continue
            image_unit["unit_id"] = f"{rid}-img"
            image_unit["content"] = f"中医面诊区域图 {region}（{subset}/{sid}）"
            image_unit["meta"] = {"subset": subset, "subject": sid,
                                  "region": region}

            records.append({
                "record_id": rid,
                "content": f"面诊样本 {sid}（{subset}，"
                           f"{'抑郁阳性' if label == 1 else '阴性'}）",
                "themes": list(themes),
                "severity": 3 if label == 1 else 0,
                "alert_level": alert,
                "created_at": created, "window": window,
                "context": f"subset={subset} gender={gender}",
                "label": f"AVDD-TCMI/{subset}",
                "dataset": DATASET_NAME,
                # ★ 同源声明：同一人的面诊音与面诊图是真同源
                "same_source_pairs": [("audio", "image")],
            })
            units.append(audio_unit)
            units.append(image_unit)

    if not records:
        raise SystemExit("AVDD-TCMI：没有构建出任何记录")

    base.attach_units(records, units)
    queries = base.build_queries(records, rng, kw.get("num_queries") or 0)

    return {
        "records": records, "units": units, "queries": queries,
        "root": inner,
        "meta": {
            "dataset_name": DATASET_NAME,
            "subsets": subs,
            "records": len(records), "units": len(units),
            "skipped": len(skipped),
            "pairing": "audio <-> image same source (same subject, same session)",
            "label_rule": "HDS=临床确诊 / SDS=筛查；均为参考标签，非本次用户结论",
            "license": "cc-by-nc-4.0 (non-commercial research)",
            "feature_channels": {
                "audio@AVDD-TCMI": 2048,   # 1024 均值 + 1024 标准差
                "image@AVDD-TCMI": 192,    # HOG，与 FER2013 同提取器
            },
        },
    }
