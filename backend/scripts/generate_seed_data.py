"""
生成约 500 条「真实风格」的心理筛查语料，写入 SQLite 数据库，
供动态跨模态哈希检索引擎在启动时从数据库播种（方案 2）。

- 在 init_data.py 已预置的「用户 / 问卷 / 标签主表」之上追加，不会破坏它们。
- 文本覆盖 14 个心理主题、使用多样词汇，确保 features.extract_themes 能抽到标签，
  从而让检索结果随查询内容变化（解决「每次都是那几个」的问题）。
- 幂等：若已生成过（筛查数 > 30）则跳过；--reset 清空四张业务表后重生成；
  --force 强制在现有数据上再追加。

用法（在 backend 目录下）：
    python scripts/generate_seed_data.py            # 首次生成
    python scripts/generate_seed_data.py --reset    # 清空后重生成
    python scripts/generate_seed_data.py --force    # 再追加一批
"""
import argparse
import os
import random
import sys
from datetime import datetime, timedelta

# 让脚本可直接 import app 包
sys.path.insert(0, ".")

from app.db.session import SessionLocal, init_db
from app.db.models.screening import Screening, Questionnaire
from app.db.models.case import Case, CaseTagMaster
from app.db.models.alert import Alert
from app.db.models.media import MediaFile
from app.db.base import Base
from app.config import settings
from sqlalchemy import create_engine, inspect as sa_inspect
from sqlalchemy.orm import sessionmaker

# ---------------------------------------------------------------------------
# 主题内容池（句子里必须包含 features.THEME_KEYWORDS 中的关键词，否则抽不到标签）
# ---------------------------------------------------------------------------
THEME_CONTENT = {
    "抑郁": {
        "ctx": ["近一个月来情绪持续低落", "这段时间总是高兴不起来", "感觉整个人被一层灰雾罩住"],
        "sym": [
            "感到明显的情绪低落，整天开心不起来",
            "对以往喜欢的事情兴趣缺失、提不起兴趣",
            "常有无助和绝望感，反复自责",
            "觉得没动力做任何事，生活灰暗",
            "空虚无助，觉得活着没意思",
        ],
    },
    "焦虑": {
        "ctx": ["最近总是莫名紧张", "一想到事情就慌", "处于持续的不安中"],
        "sym": [
            "明显的焦虑紧张，手心出汗",
            "总是担心会发生不好的事，灾难化思维",
            "心慌、坐立不安，静不下来",
            "烦躁不安，惶恐感挥之不去",
        ],
    },
    "睡眠": {
        "ctx": ["最近睡眠很差", "晚上总睡不好", "白天总犯困"],
        "sym": [
            "严重失眠，入睡困难",
            "夜里容易早醒，睡眠浅",
            "多梦、彻夜难眠，第二天没精神",
            "睡眠质量差，经常熬夜刷手机到凌晨",
        ],
    },
    "社交": {
        "ctx": ["在人群里很不自在", "越来越不想出门", "和人说话会紧张"],
        "sym": [
            "明显的社交回避，不愿见人",
            "感觉孤独、和周围人疏离",
            "在聚会中沉默退缩，怕生",
            "人际交往时紧张，想躲起来",
        ],
    },
    "学业": {
        "ctx": ["这学期课业压力很大", "快到考试周了", "毕设卡住了"],
        "sym": [
            "担心挂科，学业受挫",
            "论文进度落后，被导师催得紧",
            "毕设卡住，保研压力大",
            "考试临近，课业压力大到失眠",
        ],
    },
    "应激": {
        "ctx": ["前阵子经历了突发事件", "被一件事吓到了", "最近受到惊吓"],
        "sym": [
            "遭遇突发事件后出现急性应激",
            "受惊吓过度，夜里闪回",
            "被欺负后留下心理阴影，常做噩梦",
        ],
    },
    "自我认同": {
        "ctx": ["不知道自己想要什么", "对自己越来越没信心", "陷入身份认同的困惑"],
        "sym": [
            "强烈的自我怀疑与自卑",
            "找不到自己，价值感很低",
            "自我否定，低自尊",
        ],
    },
    "家庭": {
        "ctx": ["家里最近矛盾多", "和父母关系紧张", "原生家庭让我很累"],
        "sym": [
            "和父母频繁争吵，家庭矛盾突出",
            "父母期望太高，压得喘不过气",
            "原生家庭问题带来持续困扰",
            "父母离异后一直难以释怀",
        ],
    },
    "情感": {
        "ctx": ["刚经历分手", "在感情里受伤了", "陷入单相思"],
        "sym": [
            "失恋后情感创伤难以平复",
            "亲密关系中的冲突让人疲惫",
            "单相思带来持续的情感困扰",
        ],
    },
    "人际": {
        "ctx": ["和室友处不来", "在班级里被孤立", "和同学有冲突"],
        "sym": [
            "和同学发生冲突，人际紧张",
            "感觉被排挤、被孤立",
            "和室友合不来，关系冷淡",
        ],
    },
    "适应": {
        "ctx": ["刚换了个新环境", "还在适应期", "对环境变化很不习惯"],
        "sym": [
            "到新环境后适应不良",
            "转学/异地后难以适应",
            "环境变化带来明显的适应困难",
        ],
    },
    "网络成瘾": {
        "ctx": ["手机不离手", "一玩游戏就停不下来", "刷视频停不下来"],
        "sym": [
            "游戏成瘾，一玩就停不下来",
            "沉迷手机刷视频，熬夜上网",
            "网络依赖严重，现实感变弱",
        ],
    },
    "饮食": {
        "ctx": ["最近饮食乱了", "开始在意体重", "吃饭变成负担"],
        "sym": [
            "出现暴食，之后又催吐",
            "厌食，对身材过度焦虑",
            "进食障碍，暴饮暴食后自责",
        ],
    },
    "创伤": {
        "ctx": ["童年的一些事还在影响我", "曾被欺凌过", "有过被忽视的经历"],
        "sym": [
            "童年创伤至今仍有心理阴影",
            "曾被霸凌、被欺凌，难以释怀",
            "童年期被忽视，留下深层不安全感",
        ],
    },
}

ALL_THEMES = list(THEME_CONTENT.keys())

# 主题 -> 映射到已有 CaseTagMaster 名称（不存在则新建）
THEME_TO_TAG = {
    "抑郁": "抑郁", "焦虑": "焦虑", "睡眠": "睡眠问题", "社交": "人际关系",
    "学业": "学业问题", "应激": "压力", "自我认同": "情感问题", "家庭": "家庭问题",
    "情感": "情感问题", "人际": "人际关系", "适应": "压力", "网络成瘾": "压力",
    "饮食": "躯体化", "创伤": "自伤风险",
}

SURNAMES = ["李", "王", "张", "刘", "陈", "杨", "赵", "黄", "周", "吴",
            "徐", "孙", "胡", "朱", "高", "林", "何", "郭", "马", "罗"]
GIVEN = ["欣", "宇", "浩", "婷", "杰", "娜", "磊", "敏", "洋", "静",
         "强", "艳", "勇", "娟", "涛", "霞", "明", "丽", "超", "燕",
         "鑫", "璐", "晨", "怡", "轩", "悦", "睿", "萱", "博", "琪"]
DEPARTMENTS = ["计算机学院", "文学院", "理学院", "艺术学院", "工学院", "经管学院",
               "医学院", "农学院", "外国语学院", "法学院", "教育学院", "材料学院"]
GENDERS = ["男", "女"]
ALERT_LEVELS = ["green", "yellow", "orange", "red"]


def make_name(rnd):
    return rnd.choice(SURNAMES) + rnd.choice(GIVEN)


def make_summary(themes, rnd):
    """拼出一段包含主题关键词的自由文本（供 extract_themes 与检索使用）。"""
    primary = themes[0]
    ctx = rnd.choice(THEME_CONTENT[primary]["ctx"])
    chosen_syms = [rnd.choice(THEME_CONTENT[t]["sym"]) for t in themes]
    rnd.shuffle(chosen_syms)
    sym_text = "；".join(chosen_syms[: 3 + rnd.randint(0, 1)])
    return f"{ctx}。具体表现：{sym_text}。"


def bias_alert_level(themes, rnd):
    """主题越「重」，越可能高预警级别。"""
    heavy = {"抑郁", "焦虑", "应激", "创伤", "自我认同"}
    if heavy & set(themes) and rnd.random() < 0.6:
        return rnd.choice(["orange", "red", "red"])
    return rnd.choice(ALERT_LEVELS)


def ensure_tags(db, rnd):
    """保证主题对应的标签主表存在（只新建缺失的）。"""
    existing = {t.name for t in db.query(CaseTagMaster).all()}
    for theme, tag in THEME_TO_TAG.items():
        if tag not in existing:
            db.add(CaseTagMaster(name=tag, color="#3b82f6",
                                 description=f"{theme}相关"))
            existing.add(tag)
    db.commit()


def generate(db, rnd, n_screenings, n_cases, n_alerts, n_media):
    ensure_tags(db, rnd)

    questionnaires = db.query(Questionnaire).all()
    if not questionnaires:
        raise RuntimeError("未找到问卷，请先运行 python init_data.py 初始化基础数据。")
    q_ids = [q.id for q in questionnaires]

    base_time = datetime.now()

    # ---- 筛查记录 ----
    for i in range(n_screenings):
        k = rnd.randint(1, 3)
        themes = rnd.sample(ALL_THEMES, k)
        answers = make_summary(themes, rnd)
        qid = rnd.choice(q_ids)
        q = db.query(Questionnaire).get(qid)
        age = rnd.randint(17, 25)
        gender = rnd.choice(GENDERS)
        alert_level = bias_alert_level(themes, rnd)
        score = rnd.randint(0, q.max_score)
        screening = Screening(
            screening_id=f"SEED-SCR-{i+1:04d}",
            name=make_name(rnd),
            age=age,
            gender=gender,
            department=rnd.choice(DEPARTMENTS),
            questionnaire_id=qid,
            score=score,
            max_score=q.max_score,
            answers=answers,
            notes=rnd.choice(["", "辅导员已约谈一次", "建议转介心理咨询中心", ""]),
            status="completed",
            alert_level=alert_level,
            screening_date=base_time - timedelta(days=rnd.randint(0, 180)),
        )
        db.add(screening)
    db.commit()

    screening_ids = [s.id for s in db.query(Screening).all()]

    # ---- 案例 ----
    for i in range(n_cases):
        k = rnd.randint(1, 3)
        themes = rnd.sample(ALL_THEMES, k)
        notes = make_summary(themes, rnd)
        tags = list({THEME_TO_TAG[t] for t in themes})
        case = Case(
            case_id=f"SEED-CASE-{i+1:04d}",
            name=make_name(rnd),
            age=rnd.randint(17, 25),
            gender=rnd.choice(GENDERS),
            department=rnd.choice(DEPARTMENTS),
            status=rnd.choice(["active", "monitoring", "active", "closed"]),
            alert_level=bias_alert_level(themes, rnd),
            notes=notes,
            screening_count=rnd.randint(1, 5),
            last_screening_date=base_time - timedelta(days=rnd.randint(0, 120)),
            created_at=base_time - timedelta(days=rnd.randint(10, 300)),
        )
        case.tags = db.query(CaseTagMaster).filter(
            CaseTagMaster.name.in_(tags)).all()
        db.add(case)
    db.commit()

    # ---- 预警 ----
    for i in range(n_alerts):
        sid = rnd.choice(screening_ids)
        scr = db.query(Screening).get(sid)
        level = rnd.choice(["orange", "red", "yellow", "red"])
        alert = Alert(
            alert_id=f"SEED-ALT-{i+1:04d}",
            screening_id=sid,
            name=scr.name if scr else "来访者",
            level=level,
            trigger=rnd.choice([
                "量表得分达到预警阈值", "辅导员上报风险", "自伤条目阳性",
                "多次缺勤且情绪低落", "同伴反馈异常",
            ]),
            description=make_summary(rnd.sample(ALL_THEMES, rnd.randint(1, 2)), rnd),
            status=rnd.choice(["pending", "processing", "resolved"]),
            created_at=base_time - timedelta(days=rnd.randint(0, 90)),
        )
        db.add(alert)
    db.commit()

    # ---- 媒体资料 ----
    media_types = ["audio", "image", "document"]
    for i in range(n_media):
        mtype = rnd.choice(media_types)
        sid = rnd.choice(screening_ids)
        desc = make_summary(rnd.sample(ALL_THEMES, rnd.randint(1, 2)), rnd)
        media = MediaFile(
            file_id=f"SEED-FILE-{i+1:04d}",
            screening_id=rnd.choice([sid, None]),
            file_type=mtype,
            file_name=f"seed_{mtype}_{i+1}.dat",
            file_path=f"./uploads/{mtype}/seed_{i+1}.dat",
            file_size=rnd.randint(1024, 5_000_000),
            mime_type={"audio": "audio/mpeg", "image": "image/png",
                       "document": "application/pdf"}[mtype],
            description=desc,
            created_at=base_time - timedelta(days=rnd.randint(0, 90)),
        )
        db.add(media)
    db.commit()


def clear_business_tables(db):
    """按外键安全顺序清空四张业务表（不影响用户/问卷/标签主表）。"""
    db.query(MediaFile).delete()
    db.query(Alert).delete()
    db.query(Case).delete()
    db.query(Screening).delete()
    db.commit()


def export_retrieval_seed(db):
    """把当前库中 SEED-* 开头的检索记录导出到随项目发布的检索种子库
    （data/retrieval_seed.db），仅含 screenings/cases/alerts/media_files 四张表，
    不含 users/admin 等账号数据。该文件随仓库上传，保证 clone 后即可检索。"""
    seed_path = settings.RETRIEVAL_SEED_DB
    os.makedirs(os.path.dirname(seed_path), exist_ok=True)
    if os.path.exists(seed_path):
        os.remove(seed_path)
    eng = create_engine(f"sqlite:///{seed_path}")
    Base.metadata.create_all(eng)
    S = sessionmaker(bind=eng, expire_on_commit=False)
    sdb = S()
    try:
        tables = [
            (Screening, "screening_id"),
            (Case, "case_id"),
            (Alert, "alert_id"),
            (MediaFile, "file_id"),
        ]
        total = 0
        for Model, bk in tables:
            cols = [c.key for c in sa_inspect(Model).columns]
            for inst in db.query(Model).filter(getattr(Model, bk).like("SEED-%")).all():
                vals = {c: getattr(inst, c) for c in cols}
                sdb.add(Model(**vals))
                total += 1
        sdb.commit()
        print(f"已导出检索种子库 {seed_path}（{total} 条 SEED 记录，仅含检索四表）。")
    finally:
        sdb.close()
        eng.dispose()


def main():
    parser = argparse.ArgumentParser(description="生成心理筛查种子数据")
    parser.add_argument("--reset", action="store_true",
                        help="清空四张业务表后重新生成")
    parser.add_argument("--force", action="store_true",
                        help="在现有数据上再追加一批（不检查幂等）")
    args = parser.parse_args()

    rnd = random.Random(20260817)  # 固定随机种子，保证可复现

    init_db()
    db = SessionLocal()
    try:
        n_screen = db.query(Screening).count()
        # init_data.py 自带 8 条；超过 30 视为已生成过
        if n_screen > 30 and not args.reset and not args.force:
            print(f"已存在 {n_screen} 条筛查记录，疑似已生成过种子数据。")
            print("如需重生成请加 --reset；如需再追加请加 --force。")
            export_retrieval_seed(db)  # 仍导出当前已有的 SEED 记录
            return

        if args.reset:
            print("清空业务表（screenings/alerts/cases/media）...")
            clear_business_tables(db)

        # 基础数据（用户/问卷/标签）若缺失则补齐
        if db.query(Questionnaire).count() == 0:
            print("未检测到基础数据，先运行 init_data 初始化...")
            from init_data import init_sample_data
            init_sample_data()
            db = SessionLocal()

        # 目标：约 500 条
        n_screenings, n_cases, n_alerts, n_media = 300, 120, 50, 30
        print(f"生成：筛查 {n_screenings} / 案例 {n_cases} / "
              f"预警 {n_alerts} / 媒体 {n_media}（合计 {sum([n_screenings, n_cases, n_alerts, n_media])} 条）...")
        generate(db, rnd, n_screenings, n_cases, n_alerts, n_media)
        print("种子数据生成完成。")
        export_retrieval_seed(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
