"""检索与分析接口 handler（动态跨模态哈希检索 + RAG 报告）。"""
from app.core.responses import success_response
from app.core.auth import RequestContext, get_current_user
from app.core.exceptions import HttpError
from app.services import screening_service, agent_graph
from app.db import database as db
from app.engines import get_hashing_engine, get_rag_engine
from app.engines.agent import build_evidence_pack
from app.engines.hashing.query_media import (
    MediaQueryError, decode_media_query, remove_media_query,
)

# 前端可选的检索范围：全部 / 文本 / 图像 / 语音
_MODALITY_FILTERS = ("text", "image", "audio")


def viewer_of(ctx: RequestContext) -> dict:
    """把登录态转成检索可见性身份。管理员看全部，普通用户看公共池加本人数据。"""
    user = get_current_user(ctx)
    try:
        uid = int(user.get("sub"))
    except (TypeError, ValueError):
        uid = None
    return {"user_id": uid, "role": user.get("role") or "user"}


def _params(data: dict, default_top_k: int = 5):
    """解析检索参数：模态过滤、返回条数、查询模态。"""
    mf = data.get("modality_filter") or data.get("scope")
    if mf in ("", "all", "any", None):
        mf = None
    if mf not in _MODALITY_FILTERS and mf is not None:
        mf = None
    modality = data.get("modality") or "text"
    if modality not in _MODALITY_FILTERS:
        modality = "text"
    try:
        top_k = int(data.get("top_k") or default_top_k)
    except (TypeError, ValueError):
        top_k = default_top_k
    return modality, mf, max(1, min(50, top_k))


def _image_corpus_search(data: dict, top_k: int):
    """图像搜图像：走全量 FER2013 独立索引，不经过跨模态引擎。"""
    from app.engines import get_image_index
    from app.engines.hashing import real_features as RF

    index = get_image_index()
    if index is None:
        raise HttpError(503, "图像库未就绪，请先运行 scripts/build_image_corpus.py")
    raw = data.get("media_base64") or data.get("media")
    tmp_path = None
    if raw:
        try:
            tmp_path = decode_media_query(raw, data.get("media_name") or "", "image")
        except MediaQueryError as exc:
            raise HttpError(400, str(exc)) from exc
    try:
        items = index.search(path=tmp_path or "", top_k=top_k)
    finally:
        remove_media_query(tmp_path)

    hits = []
    for it in items:
        label = it.get("label") or ""
        hits.append({
            "id": it["image_id"], "record_id": it["image_id"],
            "modality": "image", "modality_label": "图像",
            "similarity": it["similarity"],
            "summary": f"FER2013 · {label}",
            "tags": [label] if label else [],
            "alert_level": "green", "date": "",
            "cross_modal": False,
            "media": RF.media_data_url(it.get("path"), "image"),
            "media_kind": "image",
            "media_meta": {"label": label, "dataset": "FER2013"},
            "data_source": "fer-image-corpus", "dataset": "FER2013",
            "explain": {
                "hamming_distance": None,
                "hamming_similarity": it["similarity"],
                "asymmetric_score": it["similarity"],
                "code_hex": "", "query_code_hex": "",
                "window": None, "shared_themes": [], "source": "fer-image-corpus",
            },
        })
    info = {"corpus": "image", "index_size": len(index.meta),
            "candidates": len(items), "probed_windows": [], "scoring": "image-only"}
    return hits, info, "image", "image"


async def perform_search(data: dict, default_top_k: int = 5, viewer: dict = None):
    """执行一次跨模态检索，返回 (命中列表, 过程信息, 查询模态, 模态过滤)。

    图像 / 语音查询：把请求体里的 base64（`media_base64`，兼容 `media`）
    落盘成临时文件供特征抽取，检索结束（含异常）即删除。
    查询文本 `query` 始终参与主题抽取与"为什么相似"解释，图像/语音查询也可以带。
    viewer 为调用者身份；为 None 时不做可见性过滤（仅内部调用）。
    """
    modality, modality_filter, top_k = _params(data, default_top_k)
    # 路由规则：
    #   上传图像 + 范围「仅图像线索」→ 全量图像库（同模态近邻，35887 张）
    #   上传图像 + 范围「全部模态」  → 主引擎（跨模态，图搜文/图搜语音）
    #   文字 / 语音查询              → 主引擎（跨模态）
    # 前端上传图像时默认把范围设为「仅图像线索」，因此图搜图自动走新库，
    # 无需前端改动；corpus=image 仍保留为显式覆盖入口。
    has_media = bool(data.get("media_base64") or data.get("media"))
    if modality == "image" and has_media and (
            modality_filter == "image"
            or (data.get("corpus") or "").strip() == "image"):
        return _image_corpus_search(data, top_k)
    engine = get_hashing_engine()
    tmp_path = None
    try:
        raw = data.get("media_base64") or data.get("media")
        if modality in ("image", "audio") and raw:
            try:
                tmp_path = decode_media_query(raw, data.get("media_name") or "", modality)
            except MediaQueryError as exc:
                raise HttpError(400, str(exc)) from exc
        results, info = await engine.search_with_info(
            query=data.get("query", ""), modality=modality,
            top_k=top_k, modality_filter=modality_filter, media_path=tmp_path,
            viewer=viewer,
        )
    finally:
        remove_media_query(tmp_path)
    return results, info, modality, modality_filter


def to_frontend_hit(hit: dict) -> dict:
    """把引擎返回的命中项转成前端字段风格（camelCase + 保留 explain）。

    引擎内部保持 snake_case，前端统一用 camelCase，转换集中在这里，
    学生端 / 管理端 / 分析端三处共用。
    """
    return {
        **hit,
        "recordId": hit.get("record_id"),
        "alertLevel": hit.get("alert_level", "green"),
        "modalityLabel": hit.get("modality_label"),
        "crossModal": hit.get("cross_modal", False),
        # 前端按 camelCase 取用；漏掉这个别名会让语音命中被判成图像分支
        # （显示"查看原图"而不是播放按钮）
        "mediaKind": hit.get("media_kind"),
        "mediaMeta": hit.get("media_meta"),
    }


async def search(ctx: RequestContext):
    """跨模态检索：文本 / 图像线索 / 语音线索都可以作为查询。

    图像 / 语音查询走 base64 上传（`media_base64` + `media_name`），
    返回体除结果列表外还带 `index` 字段（检索过程信息：候选数、探测桶数、
    查询码、命中主题、数据来源），供前端展示"哈希命中率"与可解释信息。
    """
    data = ctx.body or {}
    results, info, modality, modality_filter = await perform_search(
        data, viewer=viewer_of(ctx))
    return success_response(data={
        "query": data.get("query"),
        "modality": modality,
        "modality_filter": modality_filter,
        "results": [to_frontend_hit(r) for r in results],
        "total": len(results),
        "index": info,
    })


async def index_stats(ctx: RequestContext):
    """哈希索引状态：规模、码长、时间窗表健康度（σ 信息量 / ρ 语义一致性）。"""
    engine = get_hashing_engine()
    if hasattr(engine, "_ensure_initialized"):
        await engine._ensure_initialized()
    if not hasattr(engine, "stats"):
        return success_response(data={"source": "mock"})
    return success_response(data=engine.stats())


async def get_media(ctx: RequestContext, unit_id: str):
    """按需返回某单元的真实媒体文件（语音可播放 / 图像原图）。

    数据集在仓库外，前端拿不到文件路径，故由后端读成 data URL 返回。
    只有语料里登记过的 unit_id 能取到文件（按 id 查表，不接受任意路径）。
    """
    engine = get_hashing_engine()
    if hasattr(engine, "_ensure_initialized"):
        await engine._ensure_initialized()
    if not hasattr(engine, "media_payload"):
        raise HttpError(503, "当前引擎不支持媒体取用")
    payload = engine.media_payload(unit_id)
    if not payload:
        raise HttpError(404, "该单元没有可用的媒体文件（或数据集未就位）")
    return success_response(data=payload)


async def analyze(ctx: RequestContext):
    data = ctx.body or {}
    screening = await screening_service.get_screening_by_id(data.get("screening_id"))
    if not screening:
        return success_response(data=None, message="筛查记录不存在")

    history = await _safe_history(screening)
    initial_pack = build_evidence_pack(screening, history=history)
    retrieval_results = None
    if data.get("include_retrieval"):
        modality, modality_filter, top_k = _params(data)
        engine = get_hashing_engine()
        results, info = await engine.search_with_info(
            query=f"{screening.get('name')} {screening.get('questionnaire_name') or ''}",
            modality=modality, top_k=top_k, modality_filter=modality_filter,
            viewer=viewer_of(ctx),
        )
        retrieval_results = {
            "query": initial_pack["local_retrieval_query"], "results": results,
            "total": len(results), "index": info,
        }

    await agent_graph.ensure_seeded()
    paths = await agent_graph.evidence_paths(initial_pack)
    decisions = await agent_graph.evaluate(initial_pack)
    evidence_pack = build_evidence_pack(screening, history=history, retrieval_results=retrieval_results, knowledge_paths=paths)
    rag_engine = get_rag_engine()
    await rag_engine.initialize()
    report = await rag_engine.generate_report(evidence_pack["rag_context"])

    return success_response(data={
        "screening_id": data.get("screening_id"),
        "retrieval_results": retrieval_results,
        "rag_report": report,
        "evidence_pack": evidence_pack,
        "knowledge_graph": {"paths": paths, "rule_decisions": decisions},
    })


async def get_report(ctx: RequestContext, screening_id: int):
    screening = await screening_service.get_screening_by_id(screening_id)
    if not screening:
        return success_response(data=None, message="筛查记录不存在")
    history = await _safe_history(screening)
    initial_pack = build_evidence_pack(screening, history=history)
    await agent_graph.ensure_seeded()
    paths = await agent_graph.evidence_paths(initial_pack)
    decisions = await agent_graph.evaluate(initial_pack)
    evidence_pack = build_evidence_pack(screening, history=history, knowledge_paths=paths)
    rag_engine = get_rag_engine()
    await rag_engine.initialize()
    report = await rag_engine.generate_report(evidence_pack["rag_context"])
    return success_response(data={"rag_report": report, "evidence_pack": evidence_pack, "knowledge_graph": {"paths": paths, "rule_decisions": decisions}})


def _screening_report_input(s: dict) -> dict:
    return {
        "id": s.get("id"),
        "name": s.get("name"),
        "questionnaire": s.get("questionnaire_name") or "未知量表",
        "score": s.get("score"),
        "max_score": s.get("max_score"),
        "alert_level": s.get("alert_level"),
    }

async def _safe_history(screening: dict):
    case_id = screening.get("case_id")
    if not case_id:
        return []
    return await db.query_a("SELECT id, score, max_score, alert_level, screening_date, created_at FROM screenings WHERE case_id = ? AND id != ? ORDER BY COALESCE(screening_date, created_at) DESC LIMIT 5", (case_id, screening.get("id")))