"""
自包含的合成跨模态演示数据集（无需任何外部下载）。

用途：让动态跨模态哈希引擎在零依赖环境下即可端到端跑通并验证检索效果。
每个案例带有明确的心理主题标签，文本、图像、语音三类特征在共享潜在主题
上相关，因此训练后的哈希空间能让「文本查询命中图像 / 语音案例」，
真实演示跨模态检索。

注意：这是用于算法验证的合成数据，不是真实心理数据集。
真实部署时请用真实多模态数据（见 features.py 的可插拔特征接口）。
"""
import datetime

from . import features as F

# 心理主题 -> 关键词（用于构造带主题特征的文本）
KEYWORDS = {
    "抑郁": "兴趣缺失 情绪低落 无助感 自责 绝望 没有动力 灰暗",
    "焦虑": "紧张 担心 心慌 坐立不安 灾难化 手心出汗 不安",
    "睡眠": "失眠 早醒 入睡困难 睡眠浅 多梦 熬夜 没精神",
    "社交": "回避 孤独 不愿见人 社恐 疏离 沉默 退缩",
    "学业": "挂科 论文 导师 毕设 考试 压力大 赶due",
    "应激": "创伤 惊吓 闪回 噩梦 受欺负 突发事件 害怕",
}

# (摘要文本, 标签, 预警级别, 主模态)
CASES = [
    ("近两周兴趣缺失明显，整日感到无助和绝望，常自责，觉得没有动力做任何事。",
     ["抑郁", "无助感"], "red", "text"),
    ("晚上总是失眠早醒，白天没精神，对什么都不感兴趣，情绪很低落。",
     ["睡眠", "抑郁"], "orange", "image"),
    ("一想到要考试就心慌、坐立不安，总担心会出事，陷入灾难化想法。",
     ["焦虑", "学业"], "red", "text"),
    ("论文进度严重落后，导师催得紧，天天紧张担心，手心出汗睡不好。",
     ["学业", "焦虑"], "orange", "audio"),
    ("最近入睡困难、睡眠浅、多梦，整个人很疲惫但就是睡不着。",
     ["睡眠"], "yellow", "text"),
    ("觉得自己很孤独，不愿见人，在人群中总想退缩和回避。",
     ["社交"], "yellow", "image"),
    ("毕设卡住了，担心挂科，压力大到晚上失眠，情绪紧绷。",
     ["学业", "睡眠"], "orange", "text"),
    ("童年受欺负的创伤最近被触发，夜里常做噩梦、闪回，非常害怕。",
     ["应激"], "red", "audio"),
    ("既提不起兴趣又整天担心，情绪低落加心慌，觉得自己没救了。",
     ["抑郁", "焦虑"], "red", "multimodal"),
    ("睡前总胡思乱想，心慌不安，睡眠质量差，白天焦虑加重。",
     ["睡眠", "焦虑"], "orange", "image"),
    ("回避同学聚会，感到孤独疏离，同时兴趣缺失、总是一个人发呆。",
     ["社交", "抑郁"], "orange", "text"),
    ("考试周压力大，紧张担心，社交也提不起劲，只想躲起来。",
     ["学业", "社交"], "yellow", "audio"),
    ("被突发事件惊吓后出现睡眠障碍，夜里易醒，情绪不稳。",
     ["应激", "睡眠"], "orange", "text"),
    ("连续几周情绪低落、自责，对以往爱好完全失去兴趣。",
     ["抑郁"], "yellow", "image"),
    ("经常无缘担心、坐立不安，灾难化思维明显，伴有心慌。",
     ["焦虑"], "yellow", "text"),
    ("因失眠导致白天社交退缩，不愿见人，只想一个人待着。",
     ["睡眠", "社交"], "yellow", "audio"),
    ("多门课面临挂科风险，压力极大，已经出现明显焦虑与失眠。",
     ["学业"], "red", "text"),
    ("过去受欺负的经历仍会闪回，遇到冲突就害怕、回避。",
     ["应激"], "yellow", "image"),
    ("严重失眠早醒加兴趣缺失，自我评价很低，有绝望感。",
     ["抑郁", "睡眠"], "red", "text"),
    ("社交焦虑明显，担心别人评价，回避眼神接触，常感不安。",
     ["焦虑", "社交"], "orange", "audio"),
    ("单纯入睡困难、多梦，休息质量差，但情绪基本平稳。",
     ["睡眠"], "yellow", "text"),
    ("因学业压力和孤独感双重叠加，逐渐不愿见人、回避集体。",
     ["社交", "学业"], "yellow", "image"),
    ("突发应激事件后持续焦虑，紧张担心，夜间噩梦频繁。",
     ["应激", "焦虑"], "orange", "text"),
    ("兴趣缺失伴随毕业压力，情绪低落又担心未来，状态反复。",
     ["抑郁", "学业"], "orange", "audio"),
]


def build_demo_dataset():
    """构造演示数据集：cases / 三模态特征 / 监督相似度矩阵。"""
    n = len(CASES)
    today = datetime.date(2026, 1, 1)
    cases = []
    for i, (summary, tags, alert_level, modality) in enumerate(CASES):
        cases.append({
            "id": f"CASE-{i + 1:03d}",
            "summary": summary,
            "tags": tags,
            "alert_level": alert_level,
            "modality": modality,
            "date": (today - datetime.timedelta(days=i * 6)).isoformat(),
        })

    text_feats = [F.text_feature(c["summary"]) for c in cases]
    image_feats = [F.media_feature_from_text(c["summary"], "image") for c in cases]
    audio_feats = [F.media_feature_from_text(c["summary"], "audio") for c in cases]
    features = {"text": text_feats, "image": image_feats, "audio": audio_feats}

    # 监督相似度：标签 Jaccard（语义监督信号）
    sim = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            ti, tj = set(cases[i]["tags"]), set(cases[j]["tags"])
            union = ti | tj
            sim[i][j] = (len(ti & tj) / len(union)) if union else 0.0
            if i == j:
                sim[i][j] = 1.0
    return {"cases": cases, "features": features, "similarity": sim}
