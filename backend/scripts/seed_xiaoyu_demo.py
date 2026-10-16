#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""为个人端演示账号 xiaoyu 播种演示数据（时间跨度 2025-06 ~ 2026-09）。

为什么需要它
-----------
main 分支只在启动时补齐**账号**（app/db/database.py 的 _seed_demo_accounts），
不播种任何业务数据。于是 xiaoyu 登录后：个人首页、筛查记录、状态趋势、
预警、个案全是空的，演示看不出效果。

这个脚本往 data/dev.db 写入一条**心理状况持续偏差**的轨迹（16 次评估，跨 16 个月）：

    阶段一 2025-06 ~ 2025-09   轻度起步，逐月加重
    阶段二 2025-10 ~ 2025-12   进入中度抑郁与中度焦虑
    阶段三 2026-01 ~ 2026-03   加重到中重度，凌晨早醒、注意力涣散
    阶段四 2026-04 ~ 2026-05   一次短暂缓解（换了作息与运动，分数回落）
    阶段五 2026-06 ~ 2026-09   复发并持续处于中重度，失眠与焦虑共病
                              结尾（2026-09）仍为中重度，未见好转

设计意图：这类"持续偏差、中间一次缓解又复发"的曲线，比一路恶化更贴近真实，
也便于演示管理端的多次预警处置、个案长期随访、以及"复发"这种关键场景。

同时补齐 **4 个量表模板**（PHQ-9 / GAD-7 / ISI / PSS-10）——这是必需的：
personal.submit_personal_screening 会校验 questionnaires 表里存在该 code，
表为空时个人端提交量表会报「问卷不存在」。main 没有这部分种子。

时间戳约定（重要）
----------------
本仓库（main）**没有**任何时区换算：app/core/dates.py 的 format_dt() 只做
字符串解析 → strftime，不加减时区。所以直接写**人类可读的本地时间字符串**
（`%Y-%m-%d %H:%M:%S`）即可，界面原样显示。

（对比：另一个分支 feature/judge-demo 引入了 TZ_OFFSET_HOURS 与 _as_local()，
那里必须存 UTC。本项目是 main，不适用 —— 若将来把那套逻辑合并进来，
本脚本的时间会整体偏 +8 小时，届时需改为存 UTC。）

幂等性
------
筛查/预警/个案都用固定 ID + INSERT OR IGNORE，重复执行不会重复插入。
要彻底重来：`--reset` 先清掉本脚本造的数据再重播。

用法
----
    cd backend
    python scripts/seed_xiaoyu_demo.py              # 幂等播种
    python scripts/seed_xiaoyu_demo.py --reset      # 先清掉本脚本造的数据再重播
    python scripts/seed_xiaoyu_demo.py --dry-run    # 只打印计划
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

DEMO_USERNAME = "xiaoyu"

# 本脚本造出来的记录，统一用这个前缀，便于 --reset 精确清理
SCR_PREFIX = "SCR-DEMO"
ALT_PREFIX = "ALT-DEMO"
CASE_ID = "CASE-DEMO-XY"


# ---------------------------------------------------------------------------
# 1) 量表模板
#
# 与 personal.submit_personal_screening 里写死的分级阈值必须一致（见其 scale 表）：
#   PHQ-9  9题/0-3分  green<=4  yellow<=9  orange<=14 red>14
#   GAD-7  7题/0-3分  同上
#   ISI    7题/0-4分  green<=7  yellow<=14 orange<=21 red>21
#   PSS-10 10题/0-4分 green<=13 yellow<=26 orange<=33 red>33
# ---------------------------------------------------------------------------
FREQ4 = [
    {"value": 0, "label": "完全不会"},
    {"value": 1, "label": "好几天"},
    {"value": 2, "label": "一半以上的天数"},
    {"value": 3, "label": "几乎每天"},
]
ISI5 = [
    {"value": 0, "label": "无"},
    {"value": 1, "label": "轻度"},
    {"value": 2, "label": "中度"},
    {"value": 3, "label": "重度"},
    {"value": 4, "label": "极重度"},
]
FREQ5 = [
    {"value": 0, "label": "从不"},
    {"value": 1, "label": "偶尔"},
    {"value": 2, "label": "有时"},
    {"value": 3, "label": "经常"},
    {"value": 4, "label": "总是"},
]


def _q(items, options):
    return [{"id": i + 1, "text": text, "options": options} for i, text in enumerate(items)]


QUESTIONNAIRES = [
    {
        "code": "PHQ-9",
        "name": "PHQ-9 抑郁筛查",
        "description": "评估过去两周抑郁症状程度",
        "max_score": 27,
        "questions": _q([
            "做事时提不起劲或没有兴趣",
            "感到心情低落、沮丧或绝望",
            "入睡困难、睡不安稳或睡眠过多",
            "感觉疲倦或没有精力",
            "食欲不振或吃太多",
            "觉得自己很糟或很失败，或让自己或家人失望",
            "对事物专注困难，例如看报纸或看电视时",
            "行动或说话速度慢到让人注意到，或坐立不安、动来动去",
            "有不如死掉或用某种方式伤害自己的念头",
        ], FREQ4),
        "scoring_rules": {"type": "phq9", "bands": [
            {"min": 0, "max": 4, "level": "green", "label": "无或极轻"},
            {"min": 5, "max": 9, "level": "yellow", "label": "轻度抑郁"},
            {"min": 10, "max": 14, "level": "orange", "label": "中度抑郁"},
            {"min": 15, "max": 27, "level": "red", "label": "中重度及以上"},
        ]},
    },
    {
        "code": "GAD-7",
        "name": "GAD-7 焦虑筛查",
        "description": "评估过去两周焦虑症状程度",
        "max_score": 21,
        "questions": _q([
            "感到紧张、焦虑或急切",
            "不能停止或控制担忧",
            "对各种各样的事情担忧过多",
            "很难放松下来",
            "由于不安而无法静坐",
            "变得容易烦恼或急躁",
            "感到似乎将有可怕的事情发生而害怕",
        ], FREQ4),
        "scoring_rules": {"type": "gad7", "bands": [
            {"min": 0, "max": 4, "level": "green", "label": "无或极轻"},
            {"min": 5, "max": 9, "level": "yellow", "label": "轻度焦虑"},
            {"min": 10, "max": 14, "level": "orange", "label": "中度焦虑"},
            {"min": 15, "max": 21, "level": "red", "label": "重度焦虑"},
        ]},
    },
    {
        "code": "ISI",
        "name": "ISI 失眠严重程度指数",
        "description": "评估入睡、维持睡眠与早醒问题的严重程度",
        "max_score": 28,
        "questions": _q([
            "入睡困难（躺下后超过 30 分钟才能入睡）",
            "夜间容易醒来，难以再次入睡",
            "比期望时间过早醒来",
            "对当前睡眠模式的满意度",
            "睡眠问题对白天状态的影响",
            "睡眠问题被别人注意到的程度",
            "对当前睡眠问题的担心程度",
        ], ISI5),
        "scoring_rules": {"type": "isi", "bands": [
            {"min": 0, "max": 7, "level": "green", "label": "无临床意义失眠"},
            {"min": 8, "max": 14, "level": "yellow", "label": "轻度失眠"},
            {"min": 15, "max": 21, "level": "orange", "label": "中度失眠"},
            {"min": 22, "max": 28, "level": "red", "label": "重度失眠"},
        ]},
    },
    {
        "code": "PSS-10",
        "name": "PSS-10 压力知觉量表",
        "description": "评估近一个月的主观压力感受",
        "max_score": 40,
        "questions": _q([
            "因为某些意外发生而感到心烦意乱",
            "感到无法控制生活中重要的事情",
            "感到紧张和压力",
            "感到有信心处理自己的问题",
            "感到事情正按自己的意愿发展",
            "发现自己无法应付所有必须做的事情",
            "能够控制生活中令自己恼火的事情",
            "感到自己掌握了一切",
            "因为一些无法控制的事情而生气",
            "感到困难堆积太多而无法克服",
        ], FREQ5),
        "scoring_rules": {"type": "pss10", "bands": [
            {"min": 0, "max": 13, "level": "green", "label": "压力较低"},
            {"min": 14, "max": 26, "level": "yellow", "label": "压力中等"},
            {"min": 27, "max": 33, "level": "orange", "label": "压力较高"},
            {"min": 34, "max": 40, "level": "red", "label": "压力很高"},
        ]},
    },
]
QUESTIONNAIRES_BY_CODE = {q["code"]: q["max_score"] for q in QUESTIONNAIRES}

# 与 personal.submit_personal_screening 的 scale 表保持一致：(题数, 单题上限, 阈值)
SCALE_SPEC = {
    "PHQ-9": (9, 3, (4, 9, 14)),
    "GAD-7": (7, 3, (4, 9, 14)),
    "ISI": (7, 4, (7, 14, 21)),
    "PSS-10": (10, 4, (13, 26, 33)),
}

# ---------------------------------------------------------------------------
# 2) xiaoyu 的资料与筛查轨迹
#
# 每条筛查 = (序号, 日期时间, 量表, 总分, 该次自述备注)
# 日期时间直接用本地时间字符串（本仓库无时区换算，见模块 docstring）。
# 刻意让时刻分散：白天 / 傍晚 / 深夜 / 清晨都有，贴近真实填报习惯。
# ---------------------------------------------------------------------------
PROFILE = {
    "name": "晓雨",
    "age": 21,
    "gender": "女",
    # 院系里带上年级 —— 后端 get_personal_profile 会把它解析成
    # campus（外国语学院）+ stage（大三），供「我的个案」页展示。
    "department": "外国语学院 大三",
    "phone": "13700000001",
    "email": "xiaoyu@example.com",
}

# 分数轨迹：轻度起步 → 逐月加重 → 短暂缓解 → 复发并持续中重度（结尾仍偏差）。
# 风险等级由分数按 SCALE_SPEC 的阈值算出（不手写，避免与后端不一致）。
#
# 时刻刻意分散（凌晨失眠、清晨早醒、深夜、傍晚、午后都有），符合真实填报习惯，
# 也避免"所有记录都是同一时刻"这种一眼假的痕迹。
SCREENINGS = [
    # (序号, 日期时间,               量表,    总分, 备注)
    # ---- 阶段一 2025-06 ~ 2025-09：轻度起步，逐月加重 ----
    (1,  "2025-06-12 21:40:18", "PHQ-9",  7,  "大三下学期开始，总觉得累，做什么都提不起兴趣。"),
    (2,  "2025-07-08 23:12:44", "GAD-7",  9,  "放假回家也放松不下来，脑子里一直转事情。"),
    (3,  "2025-09-05 08:26:31", "PHQ-9", 11,  "开学后更难集中注意力，课上听不进去。"),
    # ---- 阶段二 2025-10 ~ 2025-12：进入中度抑郁 / 中度焦虑 ----
    (4,  "2025-10-07 02:15:09", "PHQ-9", 13,  "凌晨三点醒了就睡不着，白天一点力气都没有。"),
    (5,  "2025-11-18 19:33:52", "ISI",   15,  "翻来覆去一两个小时才能睡着，睡着也容易醒。"),
    (6,  "2025-12-12 14:47:26", "GAD-7", 12,  "期末周心慌得厉害，手抖，静不下来。"),
    # ---- 阶段三 2026-01 ~ 2026-03：加重到中重度 ----
    (7,  "2026-01-09 03:41:55", "PHQ-9", 16,  "连续两周睡不好，白天提不起劲，不想说话。"),
    (8,  "2026-01-15 09:05:33", "ISI",   19,  "一夜醒三四次，早上四五点就醒，再也睡不着。"),
    (9,  "2026-02-24 20:28:14", "PHQ-9", 18,  "什么都不想做，觉得自己很没用，让家里失望了。"),
    (10, "2026-03-20 11:36:47", "GAD-7", 15,  "总是担心有不好的事发生，坐不住，容易发火。"),
    # ---- 阶段四 2026-04 ~ 2026-05：短暂缓解（换作息 + 运动）----
    (11, "2026-04-16 18:52:03", "PHQ-9", 12,  "开始每天跑步、按时睡觉，稍微好一点点。"),
    (12, "2026-05-21 22:09:38", "PHQ-9", 11,  "比上个月稳一些，但还是常觉得累、提不起兴趣。"),
    # ---- 阶段五 2026-06 ~ 2026-09：复发，持续中重度（结尾未好转）----
    (13, "2026-06-15 01:23:57", "PHQ-9", 19,  "又回到最差的时候，晚上躺着就想哭，睡不踏实。"),
    (14, "2026-07-10 16:31:22", "PSS-10", 31, "感觉所有事情都堆在一起，完全处理不过来。"),
    (15, "2026-08-19 21:47:05", "PHQ-9", 20,  "早醒、没胃口，瘦了好几斤，不太想见人。"),
    (16, "2026-09-23 03:58:41", "PHQ-9", 21,  "最近还是老样子，晚上睡不着，白天没精神，很难受。"),
    # ---- 阶段六 2026-10：最近两周（结尾仍是中重度，未好转）----
    (17, "2026-10-10 22:47:16", "PHQ-9", 20,  "这周几乎每天都提不起劲，晚上两三点醒了就再也睡不着。"),
    (18, "2026-10-14 02:33:08", "PHQ-9", 17,  "还是差不多，白天没精神，不太想跟人说话，但比上周稍微好一点点。"),
]

# 预警：按后端口径，**每一条 orange / red 的筛查都对应一条预警**（脚本会校验，
# 漏配会直接报错退出，避免界面出现"分数红色却没有预警"的矛盾）。
# 结尾刻意留 3 条未处置（pending / processing），便于演示管理端待办与认领流程。
ALERTS = {
    3:  ("resolved",   "首次达到关注阈值，已电话联系并安排首次面询。"),
    4:  ("resolved",   "入睡困难加重，建议记录睡眠日志，两周后复测。"),
    5:  ("resolved",   "失眠量表达中度，已指导睡眠卫生并纳入随访。"),
    6:  ("resolved",   "期末周焦虑明显，已教会腹式呼吸与放松训练。"),
    7:  ("resolved",   "分数达中重度，已转介校心理咨询中心并通知辅导员。"),
    8:  ("resolved",   "失眠量表 19 分（中度），已指导睡眠限制并纳入随访。"),
    9:  ("resolved",   "已安排每两周一次面询，同步调整宿舍作息。"),
    10: ("resolved",   "焦虑症状突出，已增加一次面询并联动辅导员。"),
    11: ("resolved",   "作息与运动调整后分数回落，继续随访观察。"),
    12: ("resolved",   "维持改善趋势，保持两周一次面询。"),
    13: ("processing", "症状复发且加重，已列入本轮重点面询名单。"),
    14: ("processing", "压力知觉偏高，已安排一次面谈梳理压力源。"),
    15: ("pending",    "分数持续偏高，需尽快安排一次面谈评估。"),
    16: ("pending",    "夜间早醒与情绪低落并存，建议尽快研判并介入。"),
    17: ("processing", "最近两周症状未缓解，已联系学生约定本周面询时间。"),
    18: ("pending",    "今日复测仍达中重度，建议尽快安排面谈并评估睡眠干预。"),
}

# 个案时间线的补充事件（筛查与预警事件由上面的数据自动派生）
TIMELINE_EXTRA = [
    ("status",    "建立个案档案",       "2025-06-13 10:20:00",
     "外国语学院大三学生，首次筛查提示轻度抑郁，纳入个案管理并安排随访。"),
    ("follow_up", "心理咨询中心首次面询", "2025-10-09 15:30:00",
     "主诉入睡困难与兴趣减退，评估后建议每周记录睡眠与情绪，两周后复测。"),
    ("follow_up", "院系沟通与学业调整",   "2026-01-12 11:00:00",
     "与辅导员沟通，申请本学期减少一门选修课，缓解学业压力。"),
    ("follow_up", "面询随访（第 8 次）",  "2026-04-18 14:40:00",
     "作息与运动调整后分数回落，但仍有疲乏感，继续每两周一次面询。"),
    ("follow_up", "复发评估",           "2026-06-17 09:15:00",
     "症状再次加重，伴随早醒与食欲下降，恢复每周一次面询并加强随访。"),
    ("follow_up", "面询随访（第 16 次）", "2026-09-24 10:30:00",
     "情绪仍处于中重度，睡眠问题持续，建议继续面询并保持辅导员联动。"),
    ("follow_up", "面询随访（第 18 次）", "2026-10-12 15:20:00",
     "症状未明显缓解，早醒仍突出；已约定本周内再面询一次，并建议到校医院做睡眠评估。"),
]


def _db_path() -> str:
    """与后端保持一致：读 settings.DATABASE_URL。"""
    from app.config import settings
    return settings.DATABASE_URL.replace("sqlite:///", "", 1)


def _alert_level(code: str, score: int) -> str:
    """按 SCALE_SPEC 的阈值算风险等级 —— 与后端 submit_personal_screening 同一口径。"""
    _, _, thresholds = SCALE_SPEC[code]
    for limit, level in zip(thresholds, ("green", "yellow", "orange")):
        if score <= limit:
            return level
    return "red"


def _answers_for(code: str, score: int, seed: int) -> dict:
    """把总分拆成逐题作答，保证求和等于 score（后端"以原始作答为准"，必须自洽）。"""
    n_items, per_max, _ = SCALE_SPEC[code]
    state = (seed * 1103515245 + 12345) & 0x7FFFFFFF   # 确定性伪随机，保证可复现
    remaining = score
    out = {}
    for i in range(1, n_items + 1):
        left = n_items - i
        hi = min(per_max, remaining)
        lo = max(0, remaining - left * per_max)
        if hi < lo:
            v = 0
        else:
            state = (state * 1103515245 + 12345) & 0x7FFFFFFF
            v = lo + (state % (hi - lo + 1))
        out[str(i)] = v
        remaining -= v
    return out


def seed(reset: bool = False, dry_run: bool = False) -> int:
    path = _db_path()
    print(f"[seed] 数据库: {os.path.abspath(path)}")

    if not os.path.isfile(path):
        print("[seed] ✗ 数据库不存在。请先启动一次后端（会自动建表），")
        print("       或在 backend/ 下执行：python scripts/init_local_db.py")
        return 1

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "screenings" not in tables or "users" not in tables:
            print("[seed] ✗ 表结构不完整，请先启动一次后端完成建表")
            return 1

        # ---------- 定位 xiaoyu ----------
        user = conn.execute("SELECT id, name FROM users WHERE username = ?", (DEMO_USERNAME,)).fetchone()
        if not user:
            print(f"[seed] ✗ 找不到账号 {DEMO_USERNAME}（应随后端启动自动创建）")
            return 1
        uid = user["id"]
        print(f"[seed] 账号 {DEMO_USERNAME} id={uid}")

        first_when, last_when = SCREENINGS[0][1], SCREENINGS[-1][1]

        # ---------- 补资料 ----------
        conn.execute(
            "UPDATE users SET name=?, department=?, phone=?, email=?, updated_at=? WHERE id=?",
            (PROFILE["name"], PROFILE["department"], PROFILE["phone"],
             PROFILE["email"], last_when, uid),
        )
        # 顺带给管理端账号一个体面的显示名
        conn.execute(
            "UPDATE users SET name='咨询师' WHERE username='adminer' AND (name IS NULL OR name='adminer')"
        )

        # ---------- 量表 ----------
        for q in QUESTIONNAIRES:
            exists = conn.execute("SELECT id FROM questionnaires WHERE code=?", (q["code"],)).fetchone()
            if exists:
                print(f"      量表 {q['code']:8} 已存在，跳过")
                continue
            conn.execute(
                "INSERT INTO questionnaires (code, name, description, max_score, questions, "
                "scoring_rules, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,?)",
                (q["code"], q["name"], q["description"], q["max_score"],
                 json.dumps(q["questions"], ensure_ascii=False),
                 json.dumps(q["scoring_rules"], ensure_ascii=False),
                 first_when, last_when),
            )
            print(f"      量表 {q['code']:8} 已补写")

        qid = {r["code"]: r["id"] for r in conn.execute("SELECT id, code FROM questionnaires")}

        # ---------- 预警规则（让管理端的预警规则页有内容）----------
        rules = [
            ("PHQ-9", "PHQ-9 无或极轻", 0, 4, "green", 10),
            ("PHQ-9", "PHQ-9 轻度抑郁", 5, 9, "yellow", 20),
            ("PHQ-9", "PHQ-9 中度抑郁", 10, 14, "orange", 30),
            ("PHQ-9", "PHQ-9 中重度及以上", 15, 27, "red", 40),
            ("GAD-7", "GAD-7 无或极轻", 0, 4, "green", 10),
            ("GAD-7", "GAD-7 轻度焦虑", 5, 9, "yellow", 20),
            ("GAD-7", "GAD-7 中度焦虑", 10, 14, "orange", 30),
            ("GAD-7", "GAD-7 重度焦虑", 15, 21, "red", 40),
            ("ISI", "ISI 无临床意义失眠", 0, 7, "green", 10),
            ("ISI", "ISI 轻度失眠", 8, 14, "yellow", 20),
            ("ISI", "ISI 中度失眠", 15, 21, "orange", 30),
            ("ISI", "ISI 重度失眠", 22, 28, "red", 40),
        ]
        for code, name, lo, hi, level, prio in rules:
            if code not in qid:
                continue
            dup = conn.execute(
                "SELECT id FROM alert_rules WHERE questionnaire_id=? AND min_score=? AND max_score=?",
                (qid[code], lo, hi)).fetchone()
            if dup:
                continue
            conn.execute(
                "INSERT INTO alert_rules (name, questionnaire_id, min_score, max_score, alert_level, "
                "description, is_active, priority, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,?,?)",
                (name, qid[code], lo, hi, level, f"得分 {lo}-{hi} 判定为 {level}", prio,
                 first_when, last_when))

        # ---------- 清理（--reset）----------
        # 注意 alert_events 与 alerts 之间**没有级联删除**（前者用整型 alert_id 关联），
        # 只删 alerts 会留下孤儿事件，反复重播时越积越多。
        # 因此先按 alert_id 前缀找出本次要删的预警主键，连事件一起清掉。
        if reset:
            alert_pks = [r["id"] for r in conn.execute(
                "SELECT id FROM alerts WHERE alert_id LIKE ?", (ALT_PREFIX + "%",))]
            scr_pks = [r["id"] for r in conn.execute(
                "SELECT id FROM screenings WHERE screening_id LIKE ?", (SCR_PREFIX + "%",))]
            for pk in alert_pks + scr_pks:
                conn.execute("DELETE FROM alert_events WHERE alert_id=?", (pk,))
            for i in scr_pks:
                conn.execute("DELETE FROM alerts WHERE screening_id=?", (i,))
                conn.execute("DELETE FROM media_files WHERE screening_id=?", (i,))
            conn.execute("DELETE FROM screenings WHERE screening_id LIKE ?", (SCR_PREFIX + "%",))
            conn.execute("DELETE FROM alerts WHERE alert_id LIKE ?", (ALT_PREFIX + "%",))
            case_row = conn.execute("SELECT id FROM cases WHERE case_id=?", (CASE_ID,)).fetchone()
            if case_row:
                conn.execute("DELETE FROM case_timeline WHERE case_id=?", (case_row["id"],))
                conn.execute("DELETE FROM case_tags_association WHERE case_id=?", (case_row["id"],))
                conn.execute("DELETE FROM cases WHERE id=?", (case_row["id"],))
            conn.commit()
            print("[seed] 已清理上次播种的数据")

        if dry_run:
            print("\n[seed] --dry-run：计划写入以下记录（未实际执行）")
            for n, when, code, score, note in SCREENINGS:
                lv = _alert_level(code, score)
                alt = " + 预警" if n in ALERTS else ""
                print(f"      {SCR_PREFIX}{n:02d}  {when}  {code:6} {score:>2}分 {lv:6}{alt}  {note[:20]}")
            return 0

        # ---------- 筛查记录 ----------
        scr_ids = {}
        for n, when, code, score, note in SCREENINGS:
            sid = f"{SCR_PREFIX}{n:02d}"
            level = _alert_level(code, score)
            answers = _answers_for(code, score, n)
            assert sum(answers.values()) == score, f"{sid} 作答求和 {sum(answers.values())} != {score}"
            conn.execute(
                "INSERT OR IGNORE INTO screenings (screening_id, user_id, name, age, gender, department, "
                "phone, questionnaire_id, score, max_score, answers, status, alert_level, notes, "
                "screening_date, consent_status, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (sid, uid, PROFILE["name"], PROFILE["age"], PROFILE["gender"], PROFILE["department"],
                 PROFILE["phone"], qid[code], score, QUESTIONNAIRES_BY_CODE[code],
                 json.dumps(answers, ensure_ascii=False, sort_keys=True), "completed", level, note,
                 when, "agreed", when, when),
            )
            row = conn.execute("SELECT id FROM screenings WHERE screening_id=?", (sid,)).fetchone()
            if row:
                scr_ids[n] = row["id"]
        conn.commit()
        print(f"[seed] 筛查记录 {len(scr_ids)} 条")

        # ---------- 个案 ----------
        last_level = _alert_level(SCREENINGS[-1][2], SCREENINGS[-1][3])
        conn.execute(
            "INSERT OR IGNORE INTO cases (case_id, user_id, name, age, gender, department, phone, "
            "alert_level, status, counselor_id, notes, screening_count, last_screening_date, "
            "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (CASE_ID, uid, PROFILE["name"], PROFILE["age"], PROFILE["gender"], PROFILE["department"],
             PROFILE["phone"], last_level, "active", None,
             "自 2025 年 6 月起持续情绪低落伴入睡困难与早醒，量表分数整体偏高；"
             "2026 年 4 月短暂缓解后于 6 月复发，目前仍处于中重度，每周一次面询并保持辅导员联动。",
             len(scr_ids), last_when, first_when, last_when),
        )
        case_pk = conn.execute("SELECT id FROM cases WHERE case_id=?", (CASE_ID,)).fetchone()["id"]
        for pk in scr_ids.values():
            conn.execute("UPDATE screenings SET case_id=? WHERE id=?", (case_pk, pk))

        # ---------- 预警 ----------
        # 一致性校验：按后端口径，只有 orange / red 的筛查才生成预警。
        # 若 ALERTS 漏配或多配，这里立刻报出来 —— 否则界面会出现
        # "分数是红色但没有预警"这种一眼就被看出的矛盾。
        need_alerts = {n for n, _w, code, score, _note in SCREENINGS
                       if _alert_level(code, score) in ("orange", "red")}
        missing = sorted(need_alerts - set(ALERTS))
        extra = sorted(set(ALERTS) - need_alerts)
        if missing:
            print(f"[seed] ✗ 这些筛查达到预警阈值但 ALERTS 里没有配置: {missing}")
            return 1
        if extra:
            print(f"[seed] ✗ ALERTS 里这些序号并未达到阈值（不该有预警）: {extra}")
            return 1
        print(f"[seed] 预警一致性校验通过：{len(need_alerts)} 条达到阈值的筛查都有对应预警")

        n_alert = 0
        for n, (status, follow_up) in ALERTS.items():
            if n not in scr_ids:
                continue
            _, when, code, score, note = SCREENINGS[n - 1]
            level = _alert_level(code, score)
            aid = f"{ALT_PREFIX}{n:02d}"
            resolved = None
            if status == "resolved":
                # 处置时间 = 生成后 1~3 天的**上班时段**（9:00~16:59）。
                # 若只做 timestamp 加法，处置时刻会沿用填报时刻（凌晨 03:58
                # 或清晨 08:26），与真实工作流不符。
                d = datetime.strptime(when, "%Y-%m-%d %H:%M:%S")
                base = datetime.fromtimestamp(d.timestamp() + 86400 * (1 + n % 3))
                resolved = base.replace(hour=9 + (n * 3) % 8, minute=(n * 11) % 60,
                                        second=(n * 17) % 60).strftime("%Y-%m-%d %H:%M:%S")
            conn.execute(
                "INSERT OR IGNORE INTO alerts (alert_id, screening_id, user_id, name, level, trigger, "
                "description, status, assignee_id, follow_up_notes, resolved_at, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (aid, scr_ids[n], uid, PROFILE["name"], level,
                 f"{code} 总分达到预警阈值",
                 f"{PROFILE['name']} 的 {code} 得分 {score}（{level}）。{note}",
                 status, None if status == "pending" else 1, follow_up, resolved, when, when),
            )
            n_alert += 1
        conn.commit()
        print(f"[seed] 预警 {n_alert} 条")

        # ---------- 预警流转事件 ----------
        for n in ALERTS:
            if n not in scr_ids:
                continue
            ar = conn.execute("SELECT id FROM alerts WHERE alert_id=?", (f"{ALT_PREFIX}{n:02d}",)).fetchone()
            if not ar:
                continue
            when = SCREENINGS[n - 1][1]
            if conn.execute("SELECT COUNT(*) FROM alert_events WHERE alert_id=?", (ar["id"],)).fetchone()[0]:
                continue
            conn.execute(
                "INSERT INTO alert_events (alert_id, actor_id, from_status, to_status, note, created_at) "
                "VALUES (?,?,?,?,?,?)",
                (ar["id"], 1, None, "pending", "系统自动生成预警", when))
            status = ALERTS[n][0]
            if status in ("processing", "resolved"):
                d = datetime.strptime(when, "%Y-%m-%d %H:%M:%S")
                claimed = datetime.fromtimestamp(
                    d.timestamp() + 3600 * (2 + n % 4)).strftime("%Y-%m-%d %H:%M:%S")
                conn.execute(
                    "INSERT INTO alert_events (alert_id, actor_id, from_status, to_status, note, created_at) "
                    "VALUES (?,?,?,?,?,?)",
                    (ar["id"], 1, "pending", "processing", "咨询师认领并联系学生", claimed))
            if status == "resolved":
                rr = conn.execute("SELECT resolved_at FROM alerts WHERE id=?", (ar["id"],)).fetchone()
                conn.execute(
                    "INSERT INTO alert_events (alert_id, actor_id, from_status, to_status, note, created_at) "
                    "VALUES (?,?,?,?,?,?)",
                    (ar["id"], 1, "processing", "resolved", "处置完成并归档", rr["resolved_at"]))

        # ---------- 个案时间线 ----------
        for etype, title, when, desc in TIMELINE_EXTRA:
            if conn.execute("SELECT id FROM case_timeline WHERE case_id=? AND title=?",
                            (case_pk, title)).fetchone():
                continue
            conn.execute(
                "INSERT INTO case_timeline (case_id, event_type, title, description, event_date, created_at) "
                "VALUES (?,?,?,?,?,?)",
                (case_pk, etype, title, desc, when, when))

        conn.commit()

        # ---------- 汇总 ----------
        n_scr = conn.execute("SELECT COUNT(*) FROM screenings WHERE user_id=?", (uid,)).fetchone()[0]
        n_alt = conn.execute("SELECT COUNT(*) FROM alerts WHERE user_id=?", (uid,)).fetchone()[0]
        n_tl = conn.execute("SELECT COUNT(*) FROM case_timeline WHERE case_id=?", (case_pk,)).fetchone()[0]
        n_qn = conn.execute("SELECT COUNT(*) FROM questionnaires").fetchone()[0]
        n_rl = conn.execute("SELECT COUNT(*) FROM alert_rules").fetchone()[0]
        print(f"[seed] 完成：账号 {DEMO_USERNAME} 筛查 {n_scr} / 预警 {n_alt} / 时间线 {n_tl}"
              f" · 量表 {n_qn} · 预警规则 {n_rl}")
        print(f"[seed] 时间跨度：{first_when[:10]} ~ {last_when[:10]}")
        return 0
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="为 xiaoyu 播种演示数据（2026-01 ~ 2026-09）")
    ap.add_argument("--reset", action="store_true", help="先清掉本脚本造的数据再重播")
    ap.add_argument("--dry-run", action="store_true", help="只打印计划，不写库")
    args = ap.parse_args()
    return seed(reset=args.reset, dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
