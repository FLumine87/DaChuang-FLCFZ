"""检索与分析接口 handler（动态跨模态哈希检索 + RAG 报告）。"""
from app.core.responses import success_response
from app.core.auth import RequestContext
from app.core.exceptions import HttpError
from app.services import screening_service
from app.engines import get_hashing_engine, get_rag_engine
from app.engines.hashing.query_media import (
    MediaQueryError, decode_media_query, remove_media_query,
)

# 前端可选的检索范围：全部 / 文本 / 图像 / 语音
_MODALITY_FILTERS = ("text", "image", "audio")


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


async def perform_search(data: dict, default_top_k: int = 5):
    """执行一次跨模态检索，返回 (命中列表, 过程信息, 查询模态, 模态过滤)。

    图像 / 语音查询：把请求体里的 base64（`media_base64`，兼容 `media`）
    落盘成临时文件供特征抽取，检索结束（含异常）即删除。
    查询文本 `query` 始终参与主题抽取与"为什么相似"解释，图像/语音查询也可以带。
    """
    modality, modality_filter, top_k = _params(data, default_top_k)
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
    results, info, modality, modality_filter = await perform_search(data)
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

    retrieval_results = None
    if data.get("include_retrieval"):
        modality, modality_filter, top_k = _params(data)
        engine = get_hashing_engine()
        results, info = await engine.search_with_info(
            query=f"{screening.get('name')} {screening.get('questionnaire_name') or ''}",
            modality=modality, top_k=top_k, modality_filter=modality_filter,
        )
        retrieval_results = {
            "query": screening.get("name"), "results": results,
            "total": len(results), "index": info,
        }

    rag_engine = get_rag_engine()
    await rag_engine.initialize()
    report = await rag_engine.generate_report(_screening_report_input(screening))

    return success_response(data={
        "screening_id": data.get("screening_id"),
        "retrieval_results": retrieval_results,
        "rag_report": report,
    })


async def get_report(ctx: RequestContext, screening_id: int):
    screening = await screening_service.get_screening_by_id(screening_id)
    if not screening:
        return success_response(data=None, message="筛查记录不存在")
    rag_engine = get_rag_engine()
    await rag_engine.initialize()
    report = await rag_engine.generate_report(_screening_report_input(screening))
    return success_response(data=report)


def _screening_report_input(s: dict) -> dict:
    return {
        "id": s.get("id"),
        "name": s.get("name"),
        "questionnaire": s.get("questionnaire_name") or "未知量表",
        "score": s.get("score"),
        "max_score": s.get("max_score"),
        "alert_level": s.get("alert_level"),
    }