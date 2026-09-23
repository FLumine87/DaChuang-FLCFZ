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
# 主题词典：从自由文本抽取心理主题标签，并作为**跨模态共享语义桥**。
#
# 三模态的词汇互不重叠（自述说"提不起劲"，视觉线索写"嘴角下垂"，语音线索写
# "基频偏低"），纯词袋特征之间没有任何共同词，跨模态根本无从对齐；
# 因此每个主题同时收录三类线索词，使三个模态视图都能映射到同一主题空间。
#
# 关键词需与 scripts/generate_retrieval_corpus.py 的生成语料保持一致，
# 否则 extract_themes 抽不到标签、监督信号与"为什么相似"会失效。
# ----------------------------------------------------------------------------
THEME_KEYWORDS = {
    "抑郁": ["抑郁", "情绪低落", "兴趣缺失", "提不起兴趣", "提不起劲", "无助", "绝望",
             "自责", "没动力", "灰暗", "开心不起来", "空虚无助", "完全没兴趣",
             "很没用", "看不到出路", "要花很大力气", "什么都不想做",
             # 视觉线索
             "眉头紧锁", "嘴角下垂", "目光下垂", "色调偏暗", "画得很小", "肩膀下垂",
             "反复涂抹", "涂抹加重",
             # 语音线索
             "语速缓慢", "基频偏低", "句尾下沉", "较长的沉默", "语调单调", "叹气声"],
    "焦虑": ["焦虑", "紧张", "担心", "心慌", "坐立不安", "灾难化", "担心会出事",
             "手心出汗", "不安", "烦躁", "惶恐", "心里发慌", "坐都坐不住",
             "最坏的结果", "一有动静", "心跳很快",
             "眉心上挑", "眼睑张大", "眨眼频繁", "搓动", "线条抖动", "姿势紧绷",
             "下颌用力",
             "抢话", "音高起伏", "气息不稳", "停顿短促", "句尾上扬"],
    "睡眠障碍": ["失眠", "早醒", "入睡困难", "睡眠浅", "多梦", "熬夜",
                 "没精神", "嗜睡", "睡眠质量差", "彻夜难眠", "躺很久都睡不着",
                 "半夜老醒", "天没亮就醒", "睡不踏实", "一直犯困", "作息完全乱",
                 "眼下发青", "眼睑浮肿", "打哈欠", "眼神涣散", "头部低垂", "蜷缩姿态",
                 "断续", "哈欠声", "咬字含糊", "长呼气"],
    "社交回避": ["回避", "孤独", "不愿见人", "社恐", "疏离", "沉默",
                 "退缩", "人际交往", "怕生", "社交回避", "不想见人",
                 "在人群里不自在", "没什么话", "怕别人评价", "都推掉了",
                 "没人能理解我",
                 "回避眼神接触", "视线偏低", "身体后撤", "双臂交叉", "背对观者",
                 "几乎不笑",
                 "单字回应", "句尾迅速收住", "不主动展开话题", "缺少互动"],
    "学业压力": ["挂科", "论文", "导师", "毕设", "考试", "压力大",
                 "赶due", "学业", "课业", "学业受挫", "保研", "堆着做不完",
                 "跟不上别人", "熬夜赶进度", "脑子一片空白", "催进度",
                 "紧张纹路", "看时间", "手部动作急促", "翻动纸张", "咬笔",
                 "逻辑跳跃", "自我更正", "抢着把话说完"],
    "应激创伤": ["创伤", "惊吓", "闪回", "噩梦", "受欺负", "突发事件",
                 "应激", "急性应激", "惊吓过度", "总做噩梦", "容易被吓到",
                 "还会再发生", "不敢再去", "就会害怕",
                 "惊跳", "瞳孔放大", "表情瞬间僵住", "身体僵直", "动作突然中断",
                 "揉黑", "表情木然", "护住身体",
                 "声音发紧", "气息很浅", "突然停住", "忽快忽慢", "句子常中断"],
    "自我认同": ["自我怀疑", "自卑", "价值感", "迷茫", "找不到自己",
                 "身份认同", "自我否定", "低自尊", "不知道自己想要什么",
                 "不如别人", "没有价值感", "否定自己", "找不到自己的位置",
                 "表情平淡", "视线发散", "肩部内收", "缺少五官", "线条很淡",
                 "占画面很小",
                 "停在半途", "缺少重音", "较长的犹豫", "句尾含糊", "不确定的说法"],
    "家庭冲突": ["父母", "家庭", "亲子", "争吵", "离异", "家暴",
                 "父母期望", "家庭矛盾", "原生家庭", "一说话就吵",
                 "替我做决定", "喘不过气", "不想回家", "期待太重", "不欢而散",
                 "下颌收紧", "表情僵硬", "视线偏向一侧", "双手紧握", "粗重线条",
                 "肩颈僵硬",
                 "音量抬高", "对抗语气", "控制不住"],
    "情感": ["失恋", "分手", "暗恋", "亲密关系", "情感困扰",
             "单相思", "情感创伤"],
    "人际": ["同学", "室友", "冲突", "被排挤", "孤立", "人际关系",
             "合不来", "人际紧张", "被孤立"],
    "适应": ["适应", "新环境", "转学", "入伍", "异地", "难以适应",
             "环境变化", "适应不良"],
    "网络成瘾": ["手机", "游戏", "刷视频", "网络", "沉迷", "停不下来",
                 "熬夜上网", "网瘾", "游戏成瘾", "放不下", "偷偷看手机",
                 "浑身难受", "逃避现实",
                 "视线频繁下移", "滑动屏幕", "表情单一", "颈部前倾",
                 "反应迟钝", "光斑",
                 "语气敷衍", "内容零散", "关注手机", "句子常被打断"],
    "进食困扰": ["暴食", "厌食", "体重", "身材", "进食", "催吐",
                 "暴饮暴食", "进食障碍", "吃很多东西", "特别后悔",
                 "体重掉得厉害", "很抗拒", "想办法吐掉",
                 "面部浮肿", "皮肤状态差", "磨损痕迹", "进食动作急促",
                 "体重秤", "镜子",
                 "谈到饮食时语速突然加快", "像在掩饰", "迟疑", "迅速转移"],
    "创伤": ["童年期", "被忽视", "家暴", "霸凌", "性骚扰", "心理阴影",
             "童年创伤", "被欺凌"],
}

THEME_ORDER = list(THEME_KEYWORDS.keys())
THEME_DIM = len(THEME_ORDER)
# 主题语义向量在复合特征中的权重（拼接前缩放）。
# 取值过大（≥0.7）会让主题成为显式特征，而评测的相关性定义正是"主题重叠"，
# 指标会饱和到 1.0（等于自己考自己）；取值 0 则跨模态失去语义桥。
# 0.35 是实测折中：整体 mAP 0.83、跨模态 mAP 0.49/0.53，
# 同时保留哈希编码本身的贡献空间。可用 scripts/eval_retrieval.py --weight-sweep 复验。
THEME_WEIGHT = 0.35

_PHONE_RE = re.compile(r"1[3-9]\d{9}")


def deidentify(text, extra_terms=None):
    """去除直接标识信息（手机号、已知姓名等），用于检索结果的展示字段。

    检索结果可能被学生端看到，直接展示他人原文摘要存在泄露风险；
    索引内部仍保留原始文本用于编码，只在**返回给前端**时脱敏。
    """
    if not text:
        return ""
    s = str(text)
    s = _PHONE_RE.sub("", s)
    for term in (extra_terms or []):
        t = str(term or "").strip()
        if len(t) >= 2:
            s = s.replace(t, "")
    return s.strip().lstrip("。，,、;； ").strip()


def extract_themes(text):
    """从自由文本中抽取命中的心理主题列表（基于 THEME_KEYWORDS）。

    用于：① 数据库播种时构造监督相似度；② 写路径（新建筛查/案例等）
    接线 index_case 时自动打标签；③ 检索结果里展示"为什么相似"。返回可能为空列表。
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
