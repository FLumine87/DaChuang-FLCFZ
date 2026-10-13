"""心理状况推理 Agent（阶段 2 核心，阶段 3.5 升级，2026-10-12 加时间衰减）。

流程（对应论文 Agent 2 "情绪识别 + 结果组装"的个性化升级版）：
1. 聚合个人 KG：症状频次、情绪均值、事件、诱因、应对有效性、兴趣画像
2. 对照领域 KG：匹配各 Disorder 的 HAS_SYMPTOM / HAS_TRIGGER
3. 可解释评分 v2 + 时间衰减：
   - 量表得分（PHQ-9/GAD-7/SCL-90）× 权重 40%，半衰期 7 天
   - 症状频次与匹配分 × 权重 35%，半衰期 30 天
   - 情绪强度（多次低强度负面情绪）× 权重 25%，半衰期 14 天
   - 诱因/生活事件半衰期 21 天
   - 兴趣画像不衰减；危机关键词永不衰减（保安全）
   加权综合，映射 绿/黄/橙/红 四级
4. 兴趣感知推荐：领域 KG 的应对建议按用户 LIKES 的兴趣类别优先排序
5. 报告组装：优先 LLM 生成自然语言报告，Mock/失败时回退模板

纯 Cypher 规则推理，Neo4j 可用即可运行，不依赖 LLM。
"""

import time
from datetime import datetime

from ..core.neo4j import get_driver, neo4j_health
from ..schemas.inference import (
    CRISIS_KEYWORDS,
    RISK_LABELS,
    CopingRecommendation,
    MatchedDisorder,
    RiskReport,
)
from . import llm_client, recommendation_agent

DISCLAIMER = "本报告由系统基于个人知识图谱自动生成，仅作参考，不构成医学诊断。如有需要请联系学校心理咨询中心或专业医疗机构。"

# 评分阈值（加权综合分）
THRESHOLD_YELLOW = 1.5
THRESHOLD_ORANGE = 3.0
THRESHOLD_RED = 5.0

# 权重（量表:症状:情绪 = 40:35:25）
W_SCALE = 0.40
W_SYMPTOM = 0.35
W_EMOTION = 0.25

# 量表满分（按量表名归一化到 0-10）
SCALE_MAX_BY_NAME = {
    "PHQ-9": 27.0,
    "GAD-7": 21.0,
    "SCL-90": 90.0,
    "ISI": 28.0,
    "PSS-10": 40.0,
}
SCALE_NORM = 10.0

# 各类型时间衰减半衰期（天）：7 天后权重 0.5，14 天后 0.25，依此类推
HALF_LIFE = {
    "scale": 7.0,     # 量表本身边界"过去两周"，超期参考值骤降
    "symptom": 30.0,  # 症状持续较久
    "emotion": 14.0,  # 情绪短期波动大
    "event": 21.0,    # 考试/失恋等事件过期不应再推高
    "trigger": 21.0,  # 诱因同事件
    "interest": None, # 兴趣是长期画像，不衰减
}

# 完全过期阈值（半衰期个数），超过则视为不再影响当前评分
EXPIRE_FACTOR = 4.0  # 4 个半衰期后权重 < 6.25%，视为过期


def _parse_ts(ts) -> float | None:
    """解析边属性 updated_at（写入侧用 time.strftime "%Y-%m-%dT%H:%M:%S"）。"""
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts)).timestamp()
    except (ValueError, TypeError):
        return None


def _decay(updated_at_str, half_life_days: float, now_ts: float) -> float:
    """指数时间衰减：0.5 ** (days_ago / half_life)。

    返回 [0,1]；解析失败按最新处理（返回 1.0，与旧行为兼容）。
    """
    ts = _parse_ts(updated_at_str)
    if ts is None:
        return 1.0
    days_ago = max(0.0, (now_ts - ts) / 86400.0)
    return 0.5 ** (days_ago / half_life_days)


def _expired(updated_at_str, half_life_days: float, now_ts: float) -> bool:
    """超过 EXPIRE_FACTOR 个半衰期则视为过期，不再参与评分。"""
    ts = _parse_ts(updated_at_str)
    if ts is None:
        return False
    days_ago = (now_ts - ts) / 86400.0
    return days_ago > half_life_days * EXPIRE_FACTOR

_QUERIES = {
    "symptoms": """
        MATCH (u:User {user_id: $uid})-[r:SHOWS_SYMPTOM]->(s:Symptom)
        RETURN s.name AS name, count(*) AS cnt, max(r.updated_at) AS last_seen
        ORDER BY cnt DESC
    """,
    "emotions": """
        MATCH (u:User {user_id: $uid})-[r:EXPERIENCED_EMOTION]->(e:Emotion)
        RETURN e.name AS name, count(*) AS cnt,
               avg(toFloat(r.value)) AS avg_value, max(r.updated_at) AS last_seen
    """,
    # 量表节点：EXPERIENCED_EVENT 中 name 为量表名的，value 存得分
    "scale_scores": """
        MATCH (u:User {user_id: $uid})-[r:EXPERIENCED_EVENT]->(e:LifeEvent)
        WHERE e.name IN ['PHQ-9', 'GAD-7', 'SCL-90', 'ISI', 'PSS-10']
        RETURN e.name AS name, toFloat(r.value) AS score, r.updated_at AS at
        ORDER BY r.updated_at DESC
    """,
    "events": """
        MATCH (u:User {user_id: $uid})-[r:EXPERIENCED_EVENT]->(e:LifeEvent)
        RETURN e.name AS name, count(*) AS cnt, max(r.updated_at) AS last_seen
    """,
    "triggers": """
        MATCH (u:User {user_id: $uid})-[r:HAS_TRIGGER]->(t:Trigger)
        RETURN t.name AS name, max(r.updated_at) AS last_seen
    """,
    "coping": """
        MATCH (u:User {user_id: $uid})-[r:RESPONDS_TO]->(c:Coping)
        RETURN c.name AS name, r.value AS value
    """,
    "interests": """
        MATCH (u:User {user_id: $uid})-[:LIKES|FOLLOWS]->(i:Interest)
        RETURN i.name AS name, i.category AS category
    """,
    # ---- 领域匹配 ----
    "disorder_symptom_totals": """
        MATCH (d:Disorder)-[:HAS_SYMPTOM]->(s:Symptom)
        RETURN d.name AS disorder, count(s) AS total
    """,
    "disorder_matched": """
        MATCH (d:Disorder)-[:HAS_SYMPTOM]->(s:Symptom)<-[r:SHOWS_SYMPTOM]-(u:User {user_id: $uid})
        RETURN d.name AS disorder, collect(DISTINCT s.name) AS matched,
               max(r.updated_at) AS last_seen
    """,
    "disorder_trigger_matched": """
        MATCH (u:User {user_id: $uid})-[r:HAS_TRIGGER]->(t:Trigger)<-[:HAS_TRIGGER]-(d:Disorder)
        RETURN d.name AS disorder, collect(DISTINCT t.name) AS matched,
               max(r.updated_at) AS last_seen
    """,
    "disorder_coping": """
        MATCH (d:Disorder)-[:RECOMMEND_COPING]->(c:Coping)
        RETURN d.name AS disorder, c.name AS name, c.category AS category, c.suggestion AS suggestion
    """,
}


def _run(session, key: str, uid: str) -> list[dict]:
    return session.run(_QUERIES[key], uid=uid).data()


# ---------- Mock 通路（Neo4j 不可用 + ENABLE_MOCK_ENGINES=True） ----------

MOCK_NOTICE = "演示模式 · 模板生成：未连接个人知识图谱（Neo4j），本次报告不含图谱推理结果"


def _local_alert_records(user_id: str) -> list[dict]:
    """本地业务库（SQLite）里该用户自己的预警记录——Mock 通路唯一的真实数据来源。

    个人端业务库目前只有 alerts 一张表（推理自动落库的预警），所以这里只读它：
    有什么读什么，没有就返回空列表，绝不为凑字段补默认值。库/表不存在时也按
    "没有记录"处理，不因为一个可选数据源把整份报告打挂。
    """
    from . import alert_service  # 延迟导入：只有 Mock 通路用得到

    try:
        return [row.model_dump() for row in alert_service.list_alerts(user_id=user_id)]
    except Exception:
        return []


def _run_mock(user_id: str) -> RiskReport:
    """Mock 通路：Neo4j 不可用但处于 Mock 模式时，用本地已有记录组装报告。

    为什么这样改：run_inference 原先在 Neo4j 不可用时一律抛 RuntimeError，
    路由层回 503 —— 于是"演示模式"下推理接口整个不可用。演示模式本来就不查图谱，
    那就该走一条**明确标注**的通路，而不是假装能推理：

      · 只用本地 SQLite 里确实存在的记录（当前是预警记录），不编造分数与历史；
      · 没有任何本地记录时，factors 里如实写明"没有可评分的数据"，风险等级取绿；
      · 报告正文仍走 _assemble_summary（Mock 下 llm_client.chat 返回空串 → 模板文案）；
      · 建议列表用 recommendation_agent 的仓库内置内容（reason 里标注演示模式）；
      · report.mock = True，界面据此标注"演示模式 · 模板生成"。

    真实通路（Neo4j 可用）完全不受影响，仍是下面 run_inference 里那套图谱推理。
    """
    alerts = _local_alert_records(user_id)

    factors: list[str] = [MOCK_NOTICE]
    level = "green"
    if alerts:
        # list_alerts 按 id 倒序，第一条即最近一条。等级与标题都来自这条真实记录，
        # 不是重新评估出来的——所以下面 factors 里必须写清出处。
        latest = alerts[0]
        level = latest.get("level") or "green"
        factors.append(
            f"本地最近一条预警记录：{latest.get('created_at', '')} {latest.get('title', '')}"
        )
        if len(alerts) > 1:
            factors.append(f"本地另有 {len(alerts) - 1} 条历史预警记录（未逐条参与评分）")
    else:
        factors.append("本地记录中暂无该用户的量表得分与预警记录，本次没有可参与评分的个人数据")

    report = RiskReport(
        user_id=user_id,
        risk_level=level,  # type: ignore[arg-type]
        risk_label=RISK_LABELS.get(level, RISK_LABELS["green"]),
        overall_score=0.0,  # 没跑评分：0 表示"未评分"，不表示"很健康"
        crisis=False,
        factors=factors,
        matched_disorders=[],  # 没查图谱就没有相似线索，不编
        recommendations=recommendation_agent.mock_fallback_feed(),
        summary="",
        disclaimer=DISCLAIMER,
        alert_created=False,
        created_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
        mock=True,
    )
    report.summary = _assemble_summary(report, [])
    return report


def run_inference(user_id: str) -> RiskReport:
    if not neo4j_health():
        # Mock 模式走本地数据通路（明确标注 mock），其余情况保持原样报错。
        if llm_client.mock_mode():
            return _run_mock(user_id)
        raise RuntimeError("Neo4j 未连接，无法执行推理")

    driver = get_driver()
    with driver.session() as session:
        symptoms = _run(session, "symptoms", user_id)
        emotions = _run(session, "emotions", user_id)
        scale_scores = _run(session, "scale_scores", user_id)
        events = _run(session, "events", user_id)
        triggers = _run(session, "triggers", user_id)
        coping = _run(session, "coping", user_id)
        interests = _run(session, "interests", user_id)
        totals = {r["disorder"]: r["total"] for r in _run(session, "disorder_symptom_totals", user_id)}
        matched_rows = _run(session, "disorder_matched", user_id)
        trig_rows = _run(session, "disorder_trigger_matched", user_id)
        coping_rows = _run(session, "disorder_coping", user_id)

    now_ts = time.time()

    # 1. 危机信号直判（永不衰减，安全优先）
    named = [r["name"] for r in symptoms] + [r["name"] for r in emotions]
    crisis_hits = [n for n in named if any(k in n for k in CRISIS_KEYWORDS)]

    # 2. 障碍匹配评分（症状/诱因分别按时间衰减加权）
    matched = {r["disorder"]: r for r in matched_rows}
    trig_map = {r["disorder"]: r for r in trig_rows}

    matched_disorders: list[MatchedDisorder] = []
    for disorder, row in matched.items():
        syms = row["matched"]
        trig_row = trig_map.get(disorder)
        trigs = trig_row["matched"] if trig_row else []
        # 症状得分：每个匹配症状按"最近提及时间"衰减后求和
        sym_decay = _decay(row.get("last_seen"), HALF_LIFE["symptom"], now_ts)
        sym_score = sum(sym_decay for _ in syms)
        # 诱因得分同理
        trig_decay = _decay(trig_row.get("last_seen") if trig_row else None,
                            HALF_LIFE["trigger"], now_ts)
        trig_score = 0.5 * sum(trig_decay for _ in trigs)
        score = sym_score + trig_score
        matched_disorders.append(MatchedDisorder(
            name=disorder,
            matched_symptoms=syms,
            matched_triggers=trigs,
            score=round(score, 2),
            coverage=round(len(syms) / totals[disorder], 2) if totals.get(disorder) else 0.0,
        ))
    matched_disorders.sort(key=lambda d: d.score, reverse=True)

    # ---- 风险评分 v2 + 时间衰减 ----

    # 分量 A：量表得分（取最新一次，归一化到 0-10，按 7 天半衰期衰减）
    scale_score = 0.0
    scale_name = None
    scale_raw = None
    for r in scale_scores:
        if r.get("score") is not None:
            scale_max = SCALE_MAX_BY_NAME.get(r["name"], 27.0)
            scale_score = min(10.0, (r["score"] / scale_max) * SCALE_NORM)
            scale_score *= _decay(r.get("at"), HALF_LIFE["scale"], now_ts)
            scale_name = r["name"]
            scale_raw = r["score"]
            break

    # 分量 B：症状匹配分（已含衰减的最高分障碍 score）
    symptom_score = matched_disorders[0].score if matched_disorders else 0.0

    # 分量 C：情绪分（多次低强度负面情绪，每条按 14 天半衰期衰减，封顶 2 分）
    low_emotions = []
    for r in emotions:
        if r["avg_value"] is None or r["avg_value"] > 3 or r["cnt"] < 2:
            continue
        if _expired(r.get("last_seen"), HALF_LIFE["emotion"], now_ts):
            continue  # 过期情绪不再影响当前评分
        low_emotions.append(r)
    emotion_score = min(2.0, 0.5 * len(low_emotions))

    # 加权综合（各分量归一化后按权重求和，满分 10）
    weighted_scale = scale_score * W_SCALE         # scale_score 已是 0-10
    weighted_symptom = symptom_score * W_SYMPTOM   # symptom_score 是匹配计数，典型 0-3
    weighted_emotion = emotion_score * W_EMOTION   # emotion_score 0-2

    overall_score = round(weighted_scale + weighted_symptom + weighted_emotion, 2)

    # 4. 风险等级
    if crisis_hits or overall_score >= THRESHOLD_RED:
        level = "red"
    elif overall_score >= THRESHOLD_ORANGE:
        level = "orange"
    elif overall_score >= THRESHOLD_YELLOW:
        level = "yellow"
    else:
        level = "green"

    # 5. 可解释风险因素
    factors: list[str] = []
    if scale_name and scale_raw is not None:
        factors.append(f"最近量表「{scale_name}」得分 {scale_raw:.0f}（归一化 {scale_score:.1f}/10，权重 {W_SCALE:.0%}）")
    for d in matched_disorders[:3]:
        factors.append(f"症状匹配「{d.name}」：{ '、'.join(d.matched_symptoms) }"
                       + (f"（诱因：{'、'.join(d.matched_triggers)}）" if d.matched_triggers else ""))
    for r in low_emotions:
        factors.append(f"情绪「{r['name']}」多次出现且强度偏低（均值 {r['avg_value']:.1f}，共 {r['cnt']} 次）")
    if crisis_hits:
        factors.append(f"命中危机信号：{'、'.join(crisis_hits)}")
    if not factors:
        factors.append("个人图谱中暂无明显风险信号")

    # 6. 兴趣感知的应对推荐
    interest_cats = {i["category"] for i in interests if i.get("category")}
    effective = {c["name"] for c in coping if c.get("value") == "有效"}
    recommendations: list[CopingRecommendation] = []
    seen: set[str] = set()
    top_disorders = {d.name for d in matched_disorders[:2]}
    for row in coping_rows:
        if row["disorder"] not in top_disorders or row["name"] in seen:
            continue
        seen.add(row["name"])
        if row["name"] in effective:
            reason = "你在个人记录中标记为有效"
        elif row.get("category") and row["category"] in interest_cats:
            reason = f"结合你的兴趣画像（{row['category']}）优先推荐"
        else:
            reason = f"来自领域KG对「{row['disorder']}」的常规建议"
        recommendations.append(CopingRecommendation(
            name=row["name"], category=row.get("category"),
            suggestion=row.get("suggestion"), reason=reason,
        ))

    report = RiskReport(
        user_id=user_id,
        risk_level=level,  # type: ignore[arg-type]
        risk_label=RISK_LABELS[level],
        overall_score=round(overall_score, 2),
        crisis=bool(crisis_hits),
        factors=factors,
        matched_disorders=matched_disorders,
        recommendations=recommendations,
        summary="",
        disclaimer=DISCLAIMER,
        alert_created=False,  # 由路由层在写入预警后置 True
        created_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
    )
    report.summary = _assemble_summary(report, interests)
    return report


_SUMMARY_PROMPT = """你是心理状况推理报告撰写助手。基于以下结构化推理结果，写一段 150 字以内的中文报告正文：
1. 客观陈述匹配到的风险因素，不夸大、不诊断；
2. 给出 2-3 条缓解建议（优先使用 recommendations 中结合兴趣的条目）；
3. 语气温暖、支持性，第二人称。直接输出正文，不要标题。"""


def _assemble_summary(report: RiskReport, interests: list[dict]) -> str:
    payload = report.model_dump(exclude={"summary"})
    text = llm_client.chat(_SUMMARY_PROMPT, str(payload))
    if text:
        return text
    lines = [
        f"综合个人知识图谱与领域知识推理，当前风险等级为【{report.risk_label}】"
        f"（综合分 {report.overall_score}）。",
        f"主要因素：{'；'.join(report.factors)}。",
    ]
    if report.recommendations:
        recs = "；".join(f"{r.name}（{r.reason}）" for r in report.recommendations[:3])
        lines.append(f"建议尝试：{recs}。")
    if interests:
        lines.append("系统将持续结合你的兴趣画像提供更贴合的缓解内容。")
    return "\n".join(lines)
