"""个人知识图谱参考 Agent（不承担主业务的心理筛查定级）。

流程（对应论文 Agent 2 "情绪识别 + 结果组装"的个性化升级版）：
1. 聚合个人 KG：症状频次、情绪均值、事件、诱因、应对有效性、兴趣画像
2. 症状/诱因**归一化**（口语名 → 领域规范名，词典见 clinical_lexicon）
3. 对照领域 KG：匹配各 Disorder 的 HAS_SYMPTOM / HAS_TRIGGER
   - 症状按**特异性（IDF）**加权：被越多障碍共享的症状区分度越低
   - 诱因与症状**各自都能独立触发匹配**（只有情境线索也能给出候选）
   - EXPERIENCED_EVENT 与 HAS_TRIGGER 都算诱因证据（二者词面高度重叠）
4. 兼容旧版匹配支持分及参考排序：
   - 量表得分（PHQ-9/GAD-7/SCL-90）× 权重 40%，半衰期 7 天
   - 症状匹配分 × 权重 35%，半衰期 30 天
   - 情绪强度（多次低强度负面情绪）× 权重 25%，半衰期 14 天
   - 诱因/生活事件半衰期 21 天
   - 兴趣画像不衰减；危机关键词永不衰减（保安全）
   三个分量统一归一化到 0-10，加权和满分 10（改造前量纲不一致，实际最高约 5.5）
   加权数值仅供旧客户端兼容，不映射心理风险等级
5. 兴趣感知推荐：领域 KG 的应对建议按用户 LIKES 的兴趣类别优先排序
6. 报告组装：优先 LLM 生成自然语言报告，Mock/失败时回退模板

纯 Cypher 图谱参考，Neo4j 可用即可运行，不依赖 LLM。
下文保留旧匹配支持分兼容历史客户端，但不再将该启发式分数输出为心理风险等级；
标准量表及本人多日观察的统一筛查判断由主业务后端负责。

—— 2026-11-08 逻辑修正（均有实测证据，详见各函数注释）——
· 归一化：实测全库用户写的是"入睡困难/疲乏/心悸/社交回避/自卑"等口语名，
  与领域规范名（失眠/疲惫/心慌/回避社交/无价值感）逐字不同 → 匹配率仅 1/12。
· 诱因单通：原实现只按症状命中建候选集，"只有诱因没有症状"时恒为空。
· 事件≠诱因：EXPERIENCED_EVENT 与 HAS_TRIGGER 是两套节点，用户只写事件时诱因证据全丢。
· IDF：'失眠'被 5 个障碍全部引用，导致 5 路得分并列 6.5、排序退化为字典序。
· 量纲：症状分是计数(0-3)、情绪分封顶 2，与 0-10 的量表分直接按权重相加。
· 危机：Mock 词表无危机词、抽取 prompt 无安全条款、"活着没意思"被归一成"无意义感"
  后不含任何危机关键词 → 整条安全链路失效。现改为文本入口直检 + 规范节点名落图。
· 未映射词如实列出（unmapped_terms），不静默丢弃。
"""

import math
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
from .clinical_lexicon import (
    CRISIS_CANONICAL,
    normalize_symptoms,
    normalize_triggers,
)

DISCLAIMER = "本报告由系统基于个人知识图谱自动生成，仅作参考，不构成医学诊断。如有需要请联系学校心理咨询中心或专业医疗机构。"

# 权重（量表:症状:情绪 = 40:35:25）
# 三个分量**都已归一化到 0-10**，因此加权和的理论满分是 10.0（可达）。
# 改造前症状分是"匹配计数"（典型 0-3）、情绪分封顶 2，与 0-10 的量表分
# 直接按 40:35:25 相加 → 实际最高只有约 5.5，标称的"满分 10"永远取不到。
W_SCALE = 0.40
W_SYMPTOM = 0.35
W_EMOTION = 0.25

# 每条匹配诱因的权重（症状权重按 IDF 逐条计算，诱因固定）。
W_TRIGGER = 0.5

# 症状分归一化基准：累计加权症状分达到该值即视为"满分"。
# 特异性症状的 IDF 约 1.7-2.1，所以约 3 个特异性症状即达上限。
SYMPTOM_FULL_SCORE = 3.0

# 情绪分饱和点：加权情绪单位达到该值即视为"满分"（改造前是硬封顶 2.0）。
EMOTION_FULL_UNITS = 2.0

# 危机线索的新鲜度窗口（天）：窗口内出现的视为"当前正在表达的关切"，
# 超过则按历史线索处理（仍需核实，但不当作即时危机）。
CRISIS_RECENT_DAYS = 7.0

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
        RETURN s.name AS name,
               sum(coalesce(r.cnt, 1)) AS cnt,
               max(r.updated_at) AS last_seen
        ORDER BY cnt DESC
    """,
    "emotions": """
        MATCH (u:User {user_id: $uid})-[r:EXPERIENCED_EMOTION]->(e:Emotion)
        RETURN e.name AS name,
               sum(coalesce(r.cnt, 1)) AS cnt,
               avg(toFloat(r.value)) AS avg_value,
               max(r.updated_at) AS last_seen
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
        MATCH (u:User {user_id: $uid})-[r:LIKES|FOLLOWS]->(i:Interest)
        RETURN i.name AS name, coalesce(r.category, i.category) AS category
    """,
    # ---- 领域匹配 ----
    "disorder_symptom_totals": """
        MATCH (d:Disorder)-[:HAS_SYMPTOM]->(s:Symptom)
        RETURN d.name AS disorder, count(s) AS total
    """,
    # 每个症状被多少个障碍共享 —— 用来算特异性（IDF）。
    # "失眠"被 5 个障碍共享 → 信息量低；"回避社交"只被 1 个障碍引用 → 指向性强。
    # 没有它，5 个障碍会被同一个共有症状打成并列（实测确实如此）。
    "symptom_doc_freq": """
        MATCH (d:Disorder)-[:HAS_SYMPTOM]->(s:Symptom)
        RETURN s.name AS symptom, count(DISTINCT d) AS doc_freq
    """,
    "disorder_total_count": """
        MATCH (d:Disorder) RETURN count(d) AS total
    """,
    # 领域索引：取回"障碍-症状"与"障碍-诱因"的完整对应表，在 Python 侧做归一后匹配。
    # 不下推成 Cypher 等值连接，因为口语名与规范名对不上（详见 run_inference 注释）。
    "domain_symptom_index": """
        MATCH (d:Disorder)-[:HAS_SYMPTOM]->(s:Symptom)
        RETURN d.name AS disorder, s.name AS symptom
    """,
    "domain_trigger_index": """
        MATCH (d:Disorder)-[:HAS_TRIGGER]->(t:Trigger)
        RETURN d.name AS disorder, t.name AS name
    """,
    "disorder_matched": """
        MATCH (d:Disorder)-[:HAS_SYMPTOM]->(s:Symptom)<-[r:SHOWS_SYMPTOM]-(u:User {user_id: $uid})
        RETURN d.name AS disorder,
               collect(DISTINCT s.name) AS matched,
               sum(coalesce(r.cnt, 1)) AS mention_total,
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
      · 没有任何本地记录时，如实写明"没有可评分的数据"，筛查状态未知；
      · 报告正文仍走 _assemble_summary（Mock 下 llm_client.chat 返回空串 → 模板文案）；
      · 建议列表用 recommendation_agent 的仓库内置内容（reason 里标注演示模式）；
      · report.mock = True，界面据此标注"演示模式 · 模板生成"。

    与真实图谱通路一样，本模块仅提供参考，不覆盖主业务后端的筛查判断。
    """
    alerts = _local_alert_records(user_id)

    factors: list[str] = [MOCK_NOTICE]
    level = "unknown"
    if alerts:
        # 最近历史记录仅作为有出处的参考，不迁移为当前用户的风险等级。
        latest = alerts[0]
        factors.append(
            f"本地最近一条预警记录：{latest.get('created_at', '')} {latest.get('title', '')}"
        )
        if len(alerts) > 1:
            factors.append(f"本地另有 {len(alerts) - 1} 条历史预警记录（未逐条参与评分）")
    else:
        factors.append("本地记录中暂无该用户的量表得分与预警记录，本次没有可参与评分的个人数据")

    # 安全线索在 Mock 通路同样要判：演示模式查不到图谱，但本地预警记录里
    # 长期存在的 red 级记录就是已知的安全线索，不该因为"没连图谱"而消失。
    crisis_hits = [a.get("title", "") for a in alerts if str(a.get("level")) == "red"]
    if crisis_hits:
        factors.append("本地存在红色级预警记录，属已知安全线索；演示模式下未做实时核实，"
                       "以业务后端的处置结论为准")

    report = RiskReport(
        user_id=user_id,
        risk_level=level,  # type: ignore[arg-type]
        risk_label=RISK_LABELS[level],
        overall_score=0.0,  # 没跑评分：0 表示"未评分"，不表示"很健康"
        crisis=bool(crisis_hits),
        factors=factors,
        matched_disorders=[],  # 没查图谱就没有相似线索，不编
        recommendations=recommendation_agent.mock_fallback_feed(),
        summary="",
        disclaimer=DISCLAIMER,
        alert_created=False,
        created_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
        mock=True,
        crisis_sources=["local_alert"] if crisis_hits else [],
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
        doc_freq = {r["symptom"]: r["doc_freq"] for r in _run(session, "symptom_doc_freq", user_id)}
        total_disorders = (_run(session, "disorder_total_count", user_id) or [{"total": 1}])[0]["total"] or 1
        # 症状/诱因的匹配**不下推到 Cypher 里按名字等值连接**，改为取回双方名称后在
        # Python 侧做词典归一。原因：Cypher 的等值连接要求两边名字逐字相同，而实测
        # 用户写进图谱的是"入睡困难/疲乏/心悸/社交回避"这类口语名，与领域规范名
        # （失眠/疲惫/心慌/回避社交）对不上，连接结果恒为空。
        domain_symptoms = _run(session, "domain_symptom_index", user_id)
        domain_triggers = _run(session, "domain_trigger_index", user_id)
        coping_rows = _run(session, "disorder_coping", user_id)

    now_ts = time.time()

    # 1. 危机信号直判（永不衰减，安全优先）。
    #    两个来源分别标注：graph=图谱里的历史线索，text=本次文本直检（在抽取接口写入）。
    #    图谱侧同时看症状与情绪节点名——用户可能把"绝望"写进情绪、"自杀意念"写进症状。
    named = [r["name"] for r in symptoms] + [r["name"] for r in emotions]
    graph_crisis = [n for n in named if any(k in n for k in CRISIS_KEYWORDS)]
    crisis_sources: list[str] = []
    if graph_crisis:
        crisis_sources.append("graph")
    crisis_hits = list(graph_crisis)
    # 用图谱边的最近提及时间判断"是否仍在当前关切范围内"：
    # 危机线索永不衰减（安全优先），但要区分"正在表达"与"历史残留"。
    crisis_recent = False
    if graph_crisis:
        for r in symptoms:
            if r["name"] in graph_crisis:
                ts = _parse_ts(r.get("last_seen"))
                if ts is None or (now_ts - ts) / 86400.0 <= CRISIS_RECENT_DAYS:
                    crisis_recent = True
                    break

    # 2. 症状/诱因归一 —— 把口语名映射到领域规范名，再做匹配。
    #    没有这一步，实测 12 个领域症状只能命中 1 个，matched_disorders 几乎恒为空。
    user_symptoms: dict[str, dict] = {}
    unmapped: list[str] = []
    for r in symptoms:
        raw_name = r["name"]
        # 危机节点单独走安全通路，不进"词表未覆盖"清单 ——
        # 它没参与障碍匹配是**设计如此**（领域 KG 里不存在"自杀意念"这个症状），
        # 把它列进 unmapped 会让报告出现"安全线索"与"未纳入分析"两条互相矛盾的说明。
        if any(k in raw_name for k in CRISIS_KEYWORDS):
            continue
        normed = normalize_symptoms(raw_name)
        if not normed:
            unmapped.append(raw_name)
            continue
        for n in normed:
            if n in doc_freq:
                cur = user_symptoms.setdefault(n, {"cnt": 0, "last_seen": None, "raw": set()})
                cur["cnt"] += r.get("cnt") or 1
                cur["raw"].add(raw_name)
                ts = r.get("last_seen")
                if ts and (cur["last_seen"] is None or ts > cur["last_seen"]):
                    cur["last_seen"] = ts
            elif raw_name not in unmapped:
                # 归一后仍不在领域词表里：如实记为未映射，不静默丢弃
                unmapped.append(raw_name)

    # 诱因：HAS_TRIGGER 与 EXPERIENCED_EVENT 都算诱因证据。
    # 二者在词面上高度重叠（"考试"既是事件也是诱因），实测用户常常只写事件
    # （EXPERIENCED_EVENT 考试）而从不写 HAS_TRIGGER，于是诱因证据全丢。
    user_triggers: dict[str, dict] = {}
    domain_trigger_names = {t["name"] for t in domain_triggers}
    for r in list(triggers) + list(events):
        # 量表节点（PHQ-9 等）也是 EXPERIENCED_EVENT，别当诱因
        if r["name"] in SCALE_MAX_BY_NAME:
            continue
        for n in normalize_triggers(r["name"]):
            if n in domain_trigger_names:
                cur = user_triggers.setdefault(n, {"last_seen": None, "raw": set()})
                cur["raw"].add(r["name"])
                ts = r.get("last_seen")
                if ts and (cur["last_seen"] is None or ts > cur["last_seen"]):
                    cur["last_seen"] = ts

    def _idf(sym: str) -> float:
        """症状特异性（IDF）：被越多障碍共享，区分度越低。

        log(N / df) + 1：df=N 时得 1.0（无区分度），df=1 时得 log(N)+1（最强指向）。
        实测 N=5：失眠 df=5 → 1.0；回避社交 df=1 → 2.61。
        这就是"五路并列"的解法——共有症状不再和特异症状等价。
        """
        df = doc_freq.get(sym, total_disorders)
        return math.log(total_disorders / max(1, df)) + 1.0

    # 3. 障碍匹配评分：症状按 IDF 加权，诱因与症状**各自都能独立触发匹配**。
    #    改造前只按"症状命中"建候选集，于是"只有诱因、没有症状"的用户
    #    matched_disorders 恒为空（实测确认）。
    sym_by_disorder: dict[str, list[str]] = {}
    for row in domain_symptoms:
        d = row["disorder"]
        n = row["symptom"]
        if n in user_symptoms:
            sym_by_disorder.setdefault(d, []).append(n)
    trig_by_disorder: dict[str, list[str]] = {}
    for row in domain_triggers:
        d = row["disorder"]
        n = row["name"]
        if n in user_triggers:
            trig_by_disorder.setdefault(d, []).append(n)

    matched_disorders: list[MatchedDisorder] = []
    for disorder in totals:
        syms = sorted(set(sym_by_disorder.get(disorder, [])))
        trigs = sorted(set(trig_by_disorder.get(disorder, [])))
        if not syms and not trigs:
            continue
        # 症状分：Σ IDF × 衰减 × 频次加成
        sym_raw = 0.0
        sym_weighted = 0.0
        idf_sum = 0.0
        for n in syms:
            info = user_symptoms[n]
            d = _decay(info.get("last_seen"), HALF_LIFE["symptom"], now_ts)
            cnt = info.get("cnt") or 1
            # 首次提及记满，重复提及按半权累加（"只说一次"与"说了五次"不该等价）
            freq_boost = 1.0 + 0.5 * max(0, cnt - 1)
            sym_raw += d * freq_boost
            sym_weighted += _idf(n) * d * freq_boost
            idf_sum += _idf(n)
        # 诱因分
        trig_decay = _decay(max((user_triggers[t].get("last_seen") or "") for t in trigs) if trigs else None,
                            HALF_LIFE["trigger"], now_ts)
        trig_score = W_TRIGGER * len(trigs) * trig_decay
        score = sym_weighted + trig_score
        # specificity 只反映"命中的症状有多指向性"（纯 IDF 均值），
        # 不掺频次与衰减——否则它会随时间/次数漂移，不再是一个可比较的量。
        avg_specificity = (idf_sum / len(syms)) if syms else 0.0
        matched_disorders.append(MatchedDisorder(
            name=disorder,
            matched_symptoms=syms,
            matched_triggers=trigs,
            score=round(score, 2),
            raw_score=round(sym_raw + trig_score, 2),
            coverage=round(len(syms) / totals[disorder], 2) if totals.get(disorder) else 0.0,
            specificity=round(avg_specificity, 2),
        ))
    # 排序：分数降序；分数相同则依次看「症状解释度(coverage)」→「特异性」→「命中症状数」。
    #
    # 为什么并列时选 coverage：当两个障碍被**完全相同的症状集**支持时（如"失眠+疲惫"
    # 同时命中广泛性焦虑、抑郁发作、失眠障碍），区分依据只能是"哪一套症状画像被解释得
    # 更充分"。实测 失眠障碍 被解释 2/4=50%，广泛性焦虑 2/6=33% —— 前者更贴。
    # 改造前没有这一层，5 个障碍同分，top2 实际由**名字的字典序**决定（实测取到
    # "适应障碍""学业压力反应"，仅仅因为它们在字典序里靠前）。
    def _rank(d: MatchedDisorder) -> tuple:
        return (d.score, d.coverage, d.specificity, len(d.matched_symptoms), len(d.matched_triggers))

    matched_disorders.sort(key=_rank, reverse=True)

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

    # 分量 B：症状匹配分。
    # 改造前直接取 top 障碍的原始匹配计数（典型 0-3）就与 0-10 的量表分相加，
    # 量纲不一致 —— 这里先归一化到 0-10（SYMPTOM_FULL_SCORE 为满分基准）。
    symptom_score = min(10.0, (matched_disorders[0].score / SYMPTOM_FULL_SCORE) * 10.0) if matched_disorders else 0.0

    # 分量 C：情绪分（多次低强度负面情绪，每条按 14 天半衰期衰减，归一化到 0-10）
    # cnt 为累计提及次数：情绪分 = 出现次数 × 单次权重 × 时间衰减，而非"情绪种类数"。
    # 常态情绪（开心/平静）不计入低情绪项，只有强度≤3 的负面情绪才参与。
    low_emotions = []
    emotion_units = 0.0
    for r in emotions:
        if r["avg_value"] is None or r["avg_value"] > 3 or r["cnt"] < 2:
            continue
        if _expired(r.get("last_seen"), HALF_LIFE["emotion"], now_ts):
            continue  # 过期情绪不再影响当前评分
        decay = _decay(r.get("last_seen"), HALF_LIFE["emotion"], now_ts)
        low_emotions.append({**r, "decay": decay})
        emotion_units += r["cnt"] * decay
    emotion_score = min(10.0, (0.5 * emotion_units / EMOTION_FULL_UNITS) * 10.0)

    # 加权综合：三个分量都已归一化到 0-10，加权和满分 10。
    weighted_scale = scale_score * W_SCALE
    weighted_symptom = symptom_score * W_SYMPTOM
    weighted_emotion = emotion_score * W_EMOTION

    overall_score = round(weighted_scale + weighted_symptom + weighted_emotion, 2)

    # 图谱匹配不承担标准筛查分层。固定权重/时间衰减只是参考排序机制，
    # 不能与主后端量表、本人观察的判断竞争，也不能自动生成风险预警。
    level = "unknown"

    # 5. 可解释风险因素
    factors: list[str] = []
    if scale_name and scale_raw is not None:
        factors.append(f"图谱记录中的量表「{scale_name}」原始得分 {scale_raw:.0f}；当前筛查结论以业务后端为准")
    # 只把"有症状或诱因证据"的障碍写进因素。仅有诱因命中的条目单独措辞，
    # 避免让读者以为已经匹配上了症状（诱因只是情境线索，不是症状证据）。
    for d in [x for x in matched_disorders if x.matched_symptoms or x.matched_triggers][:3]:
        if d.matched_symptoms:
            line = f"症状匹配「{d.name}」：{'、'.join(d.matched_symptoms)}"
            if d.matched_triggers:
                line += f"（诱因：{'、'.join(d.matched_triggers)}）"
            factors.append(line)
        else:
            # 只有诱因：如实说明"仅情境线索"，并提示缺少症状证据
            factors.append(f"情境线索接近「{d.name}」：{'、'.join(d.matched_triggers)}"
                           "（暂无对应症状记录，线索强度有限）")
    for r in low_emotions:
        # "多次出现"必须由真实计数支撑，否则不写具体次数（避免把 1 次说成多次）
        if r["cnt"] >= 2:
            factors.append(f"情绪「{r['name']}」多次出现且强度偏低（均值 {r['avg_value']:.1f}，共 {r['cnt']:.0f} 次）")
        else:
            factors.append(f"情绪「{r['name']}」强度偏低（均值 {r['avg_value']:.1f}）")
    if unmapped:
        # 如实告知"有些内容没能参与分析"，而不是静默丢弃后让用户以为系统什么都看懂了
        factors.append(f"以下个人记录暂未纳入推断（词表未覆盖）：{'、'.join(sorted(set(unmapped)))}")
    if crisis_hits:
        if crisis_recent:
            factors.append(f"检测到安全线索：{'、'.join(crisis_hits)}；请立即核实本人当前状态，"
                           "必要时联系学校心理咨询中心或拨打 12356 心理援助热线")
        else:
            factors.append(f"图谱存在历史安全线索：{'、'.join(crisis_hits)}；需核实本人、时间与语境，"
                           "不要把历史关键词当作当前已确认危机")
    if not factors:
        factors.append("个人图谱信息不足，无法据此判断当前心理风险")

    # 6. 兴趣感知的应对推荐
    interest_cats = {i["category"] for i in interests if i.get("category")}
    effective = {c["name"] for c in coping if c.get("value") == "有效"}
    recommendations: list[CopingRecommendation] = []
    seen: set[str] = set()
    # top_disorders 优先取"有症状证据"的条目：诱因单通（只有情境线索、没有症状）
    # 的障碍不该抢占有限的推荐位，否则真正的症状匹配会被挤掉。
    with_symptoms = [d for d in matched_disorders if d.matched_symptoms]
    top_disorders = {d.name for d in (with_symptoms[:2] or matched_disorders[:2])}
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
        crisis_verified=crisis_recent,
        crisis_sources=crisis_sources,
        unmapped_terms=sorted(set(unmapped)),
    )
    report.summary = _assemble_summary(report, interests)
    return report


_SUMMARY_PROMPT = """你是心理状况推理报告撰写助手。基于以下结构化推理结果，写一段 150 字以内的中文报告正文：
1. 客观陈述匹配到的风险因素，不夸大、不诊断；
2. 给出 2-3 条缓解建议（优先使用 recommendations 中结合兴趣的条目）；
3. 本模块只输出图谱参考，overall_score 是匹配支持分；不能据此评定健康、疾病或风险等级。
4. 安全线索分两种情形，措辞必须区分：crisis_verified=true 表示本人近期直接表达过，
   应立即建议联系学校心理中心或拨打 12356 心理援助热线；crisis_verified=false 时
   只说明"图谱中有历史线索、待核实"，不得渲染成当前已确认危机。
5. 若 unmapped_terms 非空，用一句话如实说明"部分记录未纳入分析"，不要假装已全部理解。
6. 语气温暖、支持性，第二人称。直接输出正文，不要标题。"""


def _assemble_summary(report: RiskReport, interests: list[dict]) -> str:
    payload = report.model_dump(exclude={"summary"})
    text = llm_client.chat(_SUMMARY_PROMPT, str(payload))
    if text:
        return text
    lines = [
        "本次提供个人知识图谱与领域知识的匹配参考，不生成心理风险等级。"
        "当前筛查分层请查看本次业务筛查结果。",
        f"主要因素：{'；'.join(report.factors)}。",
    ]
    if report.recommendations:
        recs = "；".join(f"{r.name}（{r.reason}）" for r in report.recommendations[:3])
        lines.append(f"建议尝试：{recs}。")
    if interests:
        lines.append("系统将持续结合你的兴趣画像提供更贴合的缓解内容。")
    return "\n".join(lines)
