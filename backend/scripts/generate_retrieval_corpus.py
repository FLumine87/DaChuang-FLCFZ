"""生成动态跨模态哈希检索的模拟语料（文本阶段）。

设计要点
--------
1. **同一被筛查者的多模态视图**：每条记录（record）生成三个模态视图
   （text 自述 / image 非言语与绘画线索 / audio 语音韵律线索）。
   三个视图使用**互不重叠的词汇体系**——自述说「提不起劲」，视觉线索写
   「嘴角下垂、画面偏灰」，语音线索写「基频偏低、停顿变长」。
   因此跨模态检索无法靠字面重合蒙对，必须依赖哈希模型的监督对齐，
   这一点与将来接入真实 CLIP / Whisper 特征时的任务性质一致。

2. **时间窗**：记录时间跨度 14 个月，按季度切成 4 个窗口，
   供多哈希表做「按时间分表 + 权重衰减」的动态机制使用。

3. **可复现**：模板 + 组合生成，固定随机种子，零依赖（仅标准库）。
   将来换成真实数据集时，只需替换本脚本的产出，检索层无需改动。

产出
----
backend/data/hashing/corpus.db，三张表：
    records(record_id, themes, severity, alert_level, created_at, window, context)
    units(unit_id, record_id, modality, content, themes, alert_level, created_at, window)
    queries(query_id, record_id, text, themes, alert_level, created_at)

用法
----
    python backend/scripts/generate_retrieval_corpus.py --records 300 --queries 80
"""
import argparse
import datetime
import json
import os
import random
import sqlite3

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(os.path.dirname(HERE), "data", "hashing", "corpus.db")

# ---------------------------------------------------------------------------
# 主题词库：每个主题三套互不重叠的词汇（自述 / 视觉线索 / 语音线索）
# ---------------------------------------------------------------------------
THEMES = {
    "抑郁": {
        "narration": [
            "提不起劲，什么都不想做",
            "以前喜欢的事现在完全没兴趣",
            "情绪一直很低落，怎么都开心不起来",
            "觉得自己很没用，总在自责",
            "像被一层灰蒙住，看不到出路",
            "做任何事都要花很大力气",
        ],
        "expression": [
            "眉头紧锁、嘴角下垂",
            "目光下垂，长时间不与人对视",
            "画面整体色调偏暗灰",
            "人物被画得很小，缩在纸的一角",
            "躯干前倾、肩膀明显下垂",
            "画面里有反复涂抹加重的线条",
        ],
        "speech": [
            "语速缓慢，句间停顿明显变长",
            "基频偏低且起伏很小",
            "音量偏轻，句尾下沉无力",
            "回答前有较长的沉默",
            "语调单调，缺少重音变化",
            "句中被叹气声打断",
        ],
        "context": ["最近两个月", "这学期以来", "期末前后", "实习期间"],
    },
    "焦虑": {
        "narration": [
            "总是担心会出事，越想越害怕",
            "心里发慌，坐都坐不住",
            "手心出汗，心跳很快",
            "脑子里反复想最坏的结果",
            "一有动静就紧张起来",
            "晚上躺下也在想那些事",
        ],
        "expression": [
            "眉心上挑、眼睑张大",
            "眨眼频繁、视线快速扫动",
            "手指交握并反复搓动",
            "画面线条抖动、涂改痕迹多",
            "身体前倾、姿势紧绷",
            "嘴唇紧闭、下颌用力",
        ],
        "speech": [
            "语速偏快，出现抢话和重复",
            "音高起伏大，句中突然拔高",
            "吸气声明显、气息不稳",
            "停顿短促而频繁",
            "音量大但控制不稳",
            "句尾上扬，像在向人确认",
        ],
        "context": ["临近答辩", "考试周", "找工作阶段", "刚换宿舍"],
    },
    "睡眠障碍": {
        "narration": [
            "躺很久都睡不着",
            "半夜老是醒，醒了就很难再睡",
            "天没亮就醒了",
            "整晚做梦，睡不踏实",
            "白天没精神，一直犯困",
            "作息完全乱了",
        ],
        "expression": [
            "眼下发青、眼睑浮肿",
            "频繁打哈欠、眼神涣散",
            "头部低垂、眨眼迟缓",
            "面部肌肉松弛、表情迟钝",
            "画面中出现床与夜晚的元素",
            "身体呈蜷缩姿态",
        ],
        "speech": [
            "语速偏慢且断续",
            "句中夹杂哈欠声",
            "音量偏低、咬字含糊",
            "停顿处出现长呼气",
            "音调平淡、缺少起伏",
        ],
        "context": ["连续两周", "最近一个月", "开学之后", "复习阶段"],
    },
    "社交回避": {
        "narration": [
            "不想见人，能躲就躲",
            "在人群里特别不自在",
            "和室友基本没什么话",
            "很怕别人评价我",
            "聚会都推掉了",
            "觉得没人能理解我",
        ],
        "expression": [
            "回避眼神接触、视线偏低",
            "身体后撤、与镜头保持距离",
            "双臂交叉抱在胸前",
            "画面人物背对观者",
            "面部表情克制，几乎不笑",
            "坐姿蜷缩、只占画面边缘",
        ],
        "speech": [
            "答话简短，多为单字回应",
            "音量轻，句尾迅速收住",
            "长时间沉默后才开口",
            "不主动展开话题",
            "语调平淡，缺少互动性提问",
        ],
        "context": ["住校期间", "社团活动之后", "班级聚餐前后", "换季这段时间"],
    },
    "学业压力": {
        "narration": [
            "作业和论文堆着做不完",
            "怕挂科，越想越焦虑",
            "导师一直在催进度",
            "考试前脑子一片空白",
            "觉得自己跟不上别人",
            "每天熬夜赶进度",
        ],
        "expression": [
            "眉头紧蹙、前额有紧张纹路",
            "频繁看时间、坐姿前倾",
            "手部动作急促、反复翻动纸张",
            "画面中出现大量书本与表格",
            "表情疲惫、眼下发青",
            "咬嘴唇或咬笔",
        ],
        "speech": [
            "语速快但逻辑跳跃",
            "中途频繁自我更正",
            "音量时高时低",
            "句间停顿短，抢着把话说完",
            "语气里带着明显的急促",
        ],
        "context": ["期中考试前", "毕设阶段", "开学第一个月", "成绩公示前后"],
    },
    "应激创伤": {
        "narration": [
            "那件事之后总做噩梦",
            "看到相似的场景就会害怕",
            "脑子里会突然闪回当时的画面",
            "特别容易被吓到",
            "总感觉还会再发生一次",
            "不敢再去那个地方",
        ],
        "expression": [
            "听到声响时明显惊跳",
            "瞳孔放大、表情瞬间僵住",
            "身体僵直、动作突然中断",
            "画面中出现被反复揉黑的部分",
            "面部血色少、表情木然",
            "下意识用手护住身体",
        ],
        "speech": [
            "声音发紧、气息很浅",
            "说到相关话题时突然停住",
            "语速忽快忽慢",
            "音量突然变小",
            "句子常中断、难以接续",
        ],
        "context": ["事发之后", "上学期期末", "实习那次之后", "最近复发"],
    },
    "家庭冲突": {
        "narration": [
            "和父母一说话就吵",
            "他们总是替我做决定",
            "家里的气氛让我喘不过气",
            "不想回家",
            "他们对我的期待太重",
            "每次通电话都不欢而散",
        ],
        "expression": [
            "说话时下颌收紧、表情僵硬",
            "视线偏向一侧，避免对视",
            "双手紧握或交叉",
            "画面中用粗重线条隔开人物",
            "肩颈僵硬、坐姿紧缩",
            "表情在愤怒与疲惫间切换",
        ],
        "speech": [
            "语速加快、音量抬高",
            "句子变短，带对抗语气",
            "中途出现明显叹气",
            "音调起伏大但控制不住",
            "沉默较长时间后才继续",
        ],
        "context": ["寒假回家期间", "开学前后", "父母来学校那天", "长假结束"],
    },
    "进食困扰": {
        "narration": [
            "控制不住地吃很多东西",
            "吃完又特别后悔",
            "最近体重掉得厉害",
            "对吃饭这件事很抗拒",
            "总在想着自己的身材",
            "吃完会想办法吐掉",
        ],
        "expression": [
            "面部浮肿、皮肤状态差",
            "手背或指节有磨损痕迹",
            "进食动作急促、回避他人",
            "画面中出现体重秤或镜子",
            "表情在焦虑与自责间变化",
            "身体姿态回避镜头",
        ],
        "speech": [
            "谈到饮食时语速突然加快",
            "音量压低，像在掩饰",
            "句中有明显的迟疑",
            "语调平淡但内容紧绷",
            "停顿后迅速转移到别的话题",
        ],
        "context": ["近三个月", "减肥之后", "换季这段时间", "体检之后"],
    },
    "网络成瘾": {
        "narration": [
            "手机一刻都放不下",
            "刷视频一刷就是几个小时",
            "明知道该睡还是停不下来",
            "上课也在偷偷看手机",
            "不打游戏就浑身难受",
            "用这些来逃避现实",
        ],
        "expression": [
            "视线频繁下移看手机",
            "手指反复滑动屏幕",
            "面部表情单一、缺少反应",
            "画面中出现大量屏幕与光斑",
            "颈部前倾、姿势长时间固定",
            "对周围刺激反应迟钝",
        ],
        "speech": [
            "回答简短、语气敷衍",
            "语速快但内容零散",
            "中途因关注手机而停顿",
            "音量偏低、语调平淡",
            "句子常被打断",
        ],
        "context": ["这半年", "放假之后", "开学以来", "换新手机之后"],
    },
    "自我认同": {
        "narration": [
            "不知道自己想要什么",
            "总觉得自己不如别人",
            "做什么都没有价值感",
            "对未来很迷茫",
            "经常否定自己",
            "找不到自己的位置",
        ],
        "expression": [
            "表情平淡、缺少张力",
            "视线发散、难以聚焦",
            "头部微低、肩部内收",
            "画面人物缺少五官细节",
            "用铅笔轻描，线条很淡",
            "人物只占画面很小面积",
        ],
        "speech": [
            "语速慢、句子常停在半途",
            "音调平淡，缺少重音",
            "回答前有较长的犹豫",
            "音量偏轻、句尾含糊",
            "多用不确定的说法",
        ],
        "context": ["升入高年级后", "结果公布之后", "转专业之后", "实习结束"],
    },
}

THEME_NAMES = list(THEMES.keys())

# 各模态的开头 / 结尾模板（跨主题共用，用于增加表层表达多样性）
OPENINGS = {
    "text": ["最近这段时间，", "这段时间我自己也说不清，", "跟之前比，", "最近的状态是，", "说实话，"],
    "image": ["观察到的表现：", "画面中呈现：", "记录到的非言语线索：", "视觉评估要点："],
    "audio": ["语音片段特征：", "声学记录显示：", "转写与韵律分析：", "录音评估结果："],
}
CLOSINGS = {
    "text": ["，这种情况已经持续一阵了。", "，我有点撑不住了。", "，不知道该怎么办。", "，家里还不知道。", "。"],
    "image": ["，整体呈现低落与紧张并存的状态。", "，非言语表达明显受限。", "，可见明显的心理负荷迹象。", "。"],
    "audio": ["，韵律特征与情绪状态一致。", "，语音表达的能量水平偏低。", "，停顿与语调异常明显。", "。"],
}
MODALITY_SUFFIX = {"text": "txt", "image": "img", "audio": "aud"}
MODALITY_LABEL = {"text": "文本", "image": "图像", "audio": "语音"}
# 模态 -> 词库字段（三个视图的词汇互不重叠）
VIEW_KEY = {"text": "narration", "image": "expression", "audio": "speech"}


def _compose(rng, view, themes):
    """按主题词库组合某个模态视图的文本。"""
    clauses = []
    for th in themes:
        pool = THEMES[th][VIEW_KEY[view]]
        k = 2 if len(themes) == 1 else 1
        clauses.extend(rng.sample(pool, min(k, len(pool))))
    rng.shuffle(clauses)
    body = "；".join(clauses[:3])
    return rng.choice(OPENINGS[view]) + body + rng.choice(CLOSINGS[view])


def _severity_to_level(sev):
    return {1: "green", 2: "green", 3: "yellow", 4: "orange", 5: "red"}[sev]


def _window_of(day, start, span_days=122):
    """按 4 个月一窗切分（14 个月 → 4 个窗口）。"""
    return min(3, (day - start).days // span_days)


def generate(num_records=300, num_queries=80, seed=42, out_path=DEFAULT_OUT,
             start_date=datetime.date(2025, 8, 1), end_date=datetime.date(2026, 9, 20)):
    rng = random.Random(seed)
    span = (end_date - start_date).days

    records, units, queries = [], [], []

    for i in range(num_records):
        rid = f"R{i + 1:04d}"
        # 主题数量 1~3，多数为 1~2 个
        n_themes = rng.choices([1, 2, 3], weights=[45, 40, 15])[0]
        themes = rng.sample(THEME_NAMES, n_themes)
        base_sev = rng.choices([1, 2, 3, 4, 5], weights=[12, 24, 30, 22, 12])[0]
        sev = min(5, base_sev + (1 if n_themes >= 3 else 0))
        day = start_date + datetime.timedelta(days=rng.randint(0, span))
        created = datetime.datetime.combine(
            day, datetime.time(rng.randint(8, 21), rng.randint(0, 59))
        ).isoformat(sep=" ", timespec="seconds")
        win = _window_of(day, start_date)
        ctx = rng.choice(THEMES[themes[0]]["context"])

        records.append((rid, themes, sev, _severity_to_level(sev), created, win, ctx))
        for view in ("text", "image", "audio"):
            uid = f"{rid}-{MODALITY_SUFFIX[view]}"
            units.append((uid, rid, view, _compose(rng, view, themes),
                          json.dumps(themes, ensure_ascii=False),
                          _severity_to_level(sev), created, win))

    # 查询集：对已有记录换一套措辞重新表达（模拟用户新输入），
    # 用于①跨模态同源召回（找同一条记录的图像/语音单元）②主题相似检索
    for j in range(num_queries):
        rec = records[rng.randrange(len(records))]
        rid, themes, sev = rec[0], rec[1], rec[2]
        # 查询只保留 1~2 个主题、1~2 个句子，模拟真实输入的稀疏性
        q_themes = themes[:1] if (rng.random() < 0.6 or len(themes) == 1) else themes[:2]
        clauses = []
        for th in q_themes:
            clauses.extend(rng.sample(THEMES[th]["narration"],
                                      min(2 if len(q_themes) == 1 else 1,
                                          len(THEMES[th]["narration"]))))
        rng.shuffle(clauses)
        text = "我想查一下类似的情况：" + "；".join(clauses[:2]) + "。"
        day = datetime.datetime.strptime(rec[4][:10], "%Y-%m-%d").date()
        created = datetime.datetime.combine(day, datetime.time(9, 0)).isoformat(sep=" ")
        queries.append((f"Q{j + 1:03d}", rid, text,
                        json.dumps(q_themes, ensure_ascii=False),
                        _severity_to_level(sev), created))

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    if os.path.exists(out_path):
        os.remove(out_path)
    conn = sqlite3.connect(out_path)
    try:
        conn.executescript(
            """
            CREATE TABLE records(
                record_id TEXT PRIMARY KEY, themes TEXT, severity INTEGER,
                alert_level TEXT, created_at TEXT, window INTEGER, context TEXT);
            CREATE TABLE units(
                unit_id TEXT PRIMARY KEY, record_id TEXT, modality TEXT, content TEXT,
                themes TEXT, alert_level TEXT, created_at TEXT, window INTEGER);
            CREATE TABLE queries(
                query_id TEXT PRIMARY KEY, record_id TEXT, text TEXT,
                themes TEXT, alert_level TEXT, created_at TEXT);
            CREATE INDEX ix_units_record ON units(record_id);
            CREATE INDEX ix_units_window ON units(window);
            """
        )
        conn.executemany(
            "INSERT INTO records VALUES (?,?,?,?,?,?,?)",
            [(r[0], json.dumps(r[1], ensure_ascii=False)) + tuple(r[2:]) for r in records],
        )
        conn.executemany("INSERT INTO units VALUES (?,?,?,?,?,?,?,?)", units)
        conn.executemany("INSERT INTO queries VALUES (?,?,?,?,?,?)", queries)
        conn.commit()
    finally:
        conn.close()
    return out_path, records, units, queries


def main():
    ap = argparse.ArgumentParser(description="生成动态跨模态哈希检索模拟语料")
    ap.add_argument("--records", type=int, default=300)
    ap.add_argument("--queries", type=int, default=80)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()

    path, records, units, queries = generate(
        args.records, args.queries, args.seed, args.out
    )

    win_dist = {}
    level_dist = {}
    for r in records:
        win_dist[r[5]] = win_dist.get(r[5], 0) + 1
        level_dist[r[3]] = level_dist.get(r[3], 0) + 1
    print(f"语料已生成: {path}")
    print(f"  记录 {len(records)} 条 / 单元 {len(units)} 个 / 查询 {len(queries)} 条")
    print(f"  时间窗分布: {dict(sorted(win_dist.items()))}")
    print(f"  风险等级分布: {level_dist}")
    print("\n样例（同一记录的三模态视图）:")
    for u in units[:3]:
        print(f"  [{MODALITY_LABEL[u[2]]}] {u[3]}")
    print("\n样例查询:")
    for q in queries[:2]:
        print(f"  {q[0]} -> {q[1]} | {q[2]}")


if __name__ == "__main__":
    main()