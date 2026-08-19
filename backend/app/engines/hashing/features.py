"""
多模态特征提取（可插拔，纯 Python，依赖可选）。

- 文本：哈希桶词频（TF）特征，零依赖、稳定，支持中英文混排。
- 图像：若安装了 Pillow 则抽取低层像素统计并随机投影到固定维度；否则回退。
- 音频：若安装了 librosa 则抽取 MFCC 均值；否则回退。
- 跨模态回退：当图像/音频无法抽取真实特征时，由文本特征经「固定随机投影」
  确定性地派生出对应模态特征，从而保证任意文本案例也能在共享空间里被
  跨模态检索到。真实部署时只需在此文件接入 CLIP / Whisper 等特征即可，
  上层哈希算法无需改动。
"""
import math
import re
import hashlib
import random

TEXT_DIM = 256   # 文本特征维度（哈希桶数）
MEDIA_DIM = 64   # 图像/音频特征维度

_PROJ_CACHE = {}


def _tokenize(text):
    if not text:
        return []
    text = str(text)
    tokens = re.findall(r"[a-zA-Z0-9]+", text.lower())      # 英文/数字词
    tokens += re.findall(r"[一-鿿]", text)                   # 汉字（按字）
    return tokens


def _bucket(token, dim):
    h = int(hashlib.md5(token.encode("utf-8")).hexdigest(), 16)
    return h % dim


def text_feature(text, dim=TEXT_DIM):
    """文本 -> 归一化 TF(哈希桶) 向量。"""
    vec = [0.0] * dim
    for t in _tokenize(text):
        vec[_bucket(t, dim)] += 1.0
    return _normalize(vec)


def _normalize(v):
    s = math.sqrt(sum(x * x for x in v))
    if s <= 0:
        return [0.0] * len(v)
    return [x / s for x in v]


def _get_proj(in_dim, out_dim, seed):
    key = (in_dim, out_dim, seed)
    if key in _PROJ_CACHE:
        return _PROJ_CACHE[key]
    rnd = random.Random(seed)
    M = [[rnd.gauss(0, 1) for _ in range(in_dim)] for _ in range(out_dim)]
    _PROJ_CACHE[key] = M
    return M


def _project(vec, out_dim, seed):
    """固定随机投影 + L2 归一化，把任意维向量压到 out_dim。"""
    M = _get_proj(len(vec), out_dim, seed)
    out = [sum(M[i][j] * vec[j] for j in range(len(vec))) for i in range(out_dim)]
    return _normalize(out)


def media_feature_from_text(text, modality):
    """由文本确定性派生跨模态特征（缺真实模型时的回退）。"""
    base = text_feature(text)
    seed = 301 if modality == "image" else 302
    return _project(base, MEDIA_DIM, seed=seed)


def image_feature_from_file(path):
    """真实图像特征；失败返回 None。"""
    try:
        from PIL import Image
        with Image.open(path) as im:
            im = im.convert("L").resize((24, 24))
            px = [p / 255.0 for p in im.getdata()]
        return _project(px, MEDIA_DIM, seed=101)
    except Exception:
        return None


# ----------------------------------------------------------------------------
# 主题词典（用于从自由文本中抽取心理主题标签，供检索监督信号与写路径接线使用）
# 注意：关键词必须与 generate_seed_data.py 生成文本中实际出现的词保持一致，
# 否则 extract_themes 抽不到标签、检索监督信号会失效。
# ----------------------------------------------------------------------------
THEME_KEYWORDS = {
    "抑郁": ["抑郁", "情绪低落", "兴趣缺失", "提不起兴趣", "无助", "绝望",
             "自责", "没动力", "灰暗", "开心不起来", "空虚无助"],
    "焦虑": ["焦虑", "紧张", "担心", "心慌", "坐立不安", "灾难化",
             "手心出汗", "不安", "烦躁", "惶恐"],
    "睡眠": ["失眠", "早醒", "入睡困难", "睡眠浅", "多梦", "熬夜",
             "没精神", "嗜睡", "睡眠质量差", "彻夜难眠"],
    "社交": ["回避", "孤独", "不愿见人", "社恐", "疏离", "沉默",
             "退缩", "人际交往", "怕生", "社交回避"],
    "学业": ["挂科", "论文", "导师", "毕设", "考试", "压力大",
             "赶due", "学业", "课业", "学业受挫", "保研"],
    "应激": ["创伤", "惊吓", "闪回", "噩梦", "受欺负", "突发事件",
             "应激", "急性应激", "惊吓过度"],
    "自我认同": ["自我怀疑", "自卑", "价值感", "迷茫", "找不到自己",
                 "身份认同", "自我否定", "低自尊"],
    "家庭": ["父母", "家庭", "亲子", "争吵", "离异", "家暴",
             "父母期望", "家庭矛盾", "原生家庭"],
    "情感": ["失恋", "分手", "暗恋", "亲密关系", "情感困扰",
             "单相思", "情感创伤"],
    "人际": ["同学", "室友", "冲突", "被排挤", "孤立", "人际关系",
             "合不来", "人际紧张", "被孤立"],
    "适应": ["适应", "新环境", "转学", "入伍", "异地", "难以适应",
             "环境变化", "适应不良"],
    "网络成瘾": ["手机", "游戏", "刷视频", "网络", "沉迷", "停不下来",
                 "熬夜上网", "网瘾", "游戏成瘾"],
    "饮食": ["暴食", "厌食", "体重", "身材", "进食", "催吐",
             "暴饮暴食", "进食障碍"],
    "创伤": ["童年期", "被忽视", "家暴", "霸凌", "性骚扰", "心理阴影",
             "童年创伤", "被欺凌"],
}


def extract_themes(text):
    """从自由文本中抽取命中的心理主题列表（基于 THEME_KEYWORDS）。

    用于：① 数据库播种时构造监督相似度；② 写路径（新建筛查/案例等）
    接线 index_case 时自动打标签。返回可能为空列表。
    """
    if not text:
        return []
    text = str(text)
    found = []
    for theme, kws in THEME_KEYWORDS.items():
        if any(kw in text for kw in kws):
            found.append(theme)
    return found


def audio_feature_from_file(path):
    """真实音频特征（MFCC 均值）；失败返回 None。"""
    try:
        import librosa
        y, sr = librosa.load(path, sr=16000, duration=10)
        mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=20)
        vec = list(mfcc.mean(axis=1))
        return _project(vec, MEDIA_DIM, seed=202)
    except Exception:
        return None
