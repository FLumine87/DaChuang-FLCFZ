"""检索与分析接口 handler（动态跨模态哈希检索 + RAG 报告）。"""
from app.core.responses import success_response
from app.core.auth import RequestContext, get_current_user
from app.core.exceptions import HttpError
from app.services import screening_service, agent_graph
from app.services.screening_assessment import build_symptom_query
from app.db import database as db
from app.engines import get_hashing_engine, get_rag_engine
from app.engines.agent import build_evidence_pack
from app.engines.hashing.query_media import (
    MediaQueryError, decode_media_query, remove_media_query,
)
from app.engines.hashing.label_provenance import reference_labels

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


def _bridge_query_feature(modality: str, data: dict, tmp_path):
    from app.engines.hashing import features as F, real_features as RF
    from app.engines.hashing.fer_encoder import get_encoder
    try:
        if modality == 'text':
            return list(F.semantic_feature(data.get('query') or ''))
        if modality == 'audio':
            return RF.audio_feature(tmp_path) if tmp_path else None
        encoder = get_encoder()
        return encoder.feature(tmp_path) if encoder and encoder.available and tmp_path else None
    except Exception:
        return None


def _bridge_units(engine, bridge, viewer):
    """Resolve bridge aliases to canonical main-index units; use current permissions."""
    canonical = {}
    for uid, meta in engine.units.items():
        canonical.setdefault((meta.get('record_id'), meta.get('modality')), uid)
    allowed = engine._allowed_ids(viewer)
    aliases = {}
    for uid, meta in bridge.units.items():
        target = uid if uid in engine.units else canonical.get((meta.get('record_id'), meta.get('modality')))
        if target is not None and (allowed is None or target in allowed):
            aliases[uid] = target
    return aliases


def _bridge_hit(engine, hit, uid, query_modality, route):
    """Return the same unit identity, labels and media contract as normal retrieval."""
    from app.engines.hashing import features as F
    import math
    meta = engine.units[uid]
    score = float(hit.get('sim') or 0)
    if not math.isfinite(score):
        raise ValueError('Invalid bridge similarity')
    score = max(0., min(1., score))
    provenance = reference_labels(meta)
    return {
        'id': uid, 'unit_id': uid, 'record_id': meta.get('record_id') or uid,
        'modality': meta['modality'], 'modality_label': {'text':'文本','image':'图像','audio':'语音'}[meta['modality']],
        'summary': meta.get('excerpt') or F.deidentify(meta.get('content') or meta.get('summary') or '', meta.get('deid_terms')),
        'similarity': round(score, 4), 'score': round(score, 4),
        'tags': meta.get('tags') or [], 'date': meta.get('date') or '',
        'cross_modal': meta['modality'] != query_modality,
        'media': engine._media_url(meta.get('media_path'), meta['modality']),
        'media_kind': meta.get('media_kind'), 'media_meta': meta.get('media_meta'),
        'dataset': meta.get('dataset') or '', 'data_source': 'bridge', **provenance,
        'explain': {'route':route, 'source':'bridge', 'hamming_distance':None,
                    'hamming_similarity':None, 'asymmetric_score':round(score,4),
                    'note':'弱监督桥接参考；跨数据集配对不代表本人多模态一致性'},
    }


def _bridge_search(data, modality, result_modality, top_k, tmp_path, viewer):
    from app.engines.hashing.bridge_manager import get_bridge_manager
    manager = get_bridge_manager()
    channel, payload = manager.route(modality, result_modality)
    if channel != 'bridge':
        return None
    pair, bridge = payload
    feature = _bridge_query_feature(modality, data, tmp_path)
    if not feature:
        return None
    engine = get_hashing_engine()  # Initialized by perform_search before any bridge lookup.
    aliases = _bridge_units(engine, bridge, viewer)
    hits = bridge.search(feature, modality, top_k=top_k, result_modality=result_modality, allowed_ids=set(aliases))
    route = f'bridge:{pair[0]}-{pair[1]}'
    results = [_bridge_hit(engine, hit, aliases[hit['unit_id']], modality, route)
               for hit in hits if hit.get('unit_id') in aliases]
    if not results:
        return None
    return results, {'route':route,'index_size':len(bridge.units),'bridge_stats':manager.status()}


def _merged_score(main_score, bridge_score, weight):
    return weight * main_score + (1. - weight) * bridge_score


def _merge_dataset_hits(engine, hits, query, modality, result_modality,
                        tmp_path, top_k):
    """把后加入的数据集（AVDD-TCMI）按全局模型补进现有结果。

    AVDD 没有参与主引擎的时间窗训练，直接走窗口排序会排到很后面；
    这里用全局 W 重新打分，并只补 1~2 条，保证现有页面能看到新数据，
    同时不改变主结果的顺序与前端页面。
    """
    if result_modality not in ("image", "audio"):
        return hits
    try:
        feat = engine._extract_query_features(query, modality, tmp_path)
        extra = engine.dataset_hits(
            "AVDD-TCMI", feat, modality, result_modality,
            top_k=2, query=query, min_sim=0.30,
        )
    except Exception:
        return hits
    if not isinstance(extra, list) or not extra:
        return hits
    seen = {h.get("id") for h in hits}
    extra = [h for h in extra if h.get("id") not in seen]
    if not extra:
        return hits
    quota = min(2, max(1, int(top_k) // 5))
    extra = extra[:quota]
    for hit in extra:
        hit.setdefault("explain", {})["dataset_merge"] = "AVDD-TCMI"
    if len(hits) >= top_k:
        return hits[:max(0, int(top_k) - len(extra))] + extra
    return list(hits) + extra


async def _merged_search(data, modality, result_modality, top_k, tmp_path, viewer):
    bridged = _bridge_search(data, modality, result_modality, max(top_k * 6,60), tmp_path, viewer)
    if bridged is None:
        return None
    engine = get_hashing_engine()
    main_hits, _ = await engine.search_with_info(query=data.get('query',''), modality=modality,
        top_k=max(top_k * 6,60), modality_filter=result_modality, media_path=tmp_path, viewer=viewer)
    main = {hit['id']:hit for hit in main_hits}
    bridge = {hit['id']:hit for hit in bridged[0]}
    results = []
    for uid in main.keys() | bridge.keys():
        hit = dict(bridge.get(uid) or main[uid])
        hit['similarity'] = hit['score'] = round(_merged_score(main.get(uid,{}).get('similarity',0), bridge.get(uid,{}).get('similarity',0), .5),4)
        hit['explain'] = {**(hit.get('explain') or {}), 'route':'merged:main+bridge',
                          'main_score':main.get(uid,{}).get('similarity'), 'bridge_score':bridge.get(uid,{}).get('similarity'),
                          'note':'两通道相似度加权；不表示患病概率'}
        results.append(hit)
    results.sort(key=lambda hit:(-hit['similarity'],hit['id']))
    return results[:top_k], {'route':'merged:main+bridge','merge_weight':.5}


async def _bridge_search_all(data, modality, top_k, tmp_path, viewer):
    """Keep all result modalities and canonical unit IDs, not one view per record."""
    engine = get_hashing_engine()
    channels = {}
    used = []
    for target in ('text','audio'):
        result = _bridge_search(data, modality, target, top_k, tmp_path, viewer)
        if result is not None:
            channels[target] = result[0]
            used.append(result[1]['route'])
    if not used:
        return None
    for target in ('text','audio','image'):
        if target not in channels:
            channels[target], _ = await engine.search_with_info(query=data.get('query',''), modality=modality,
                top_k=top_k, modality_filter=target, media_path=tmp_path, viewer=viewer)
    results, seen = [], set()
    for offset in range(top_k):
        for target in ('text','audio','image'):
            if offset < len(channels[target]):
                hit = channels[target][offset]
                if hit['id'] not in seen:
                    seen.add(hit['id']); results.append(hit)
        if len(results) >= top_k:
            break
    return results[:top_k], {'route':'bridge:multi','channels':used,'balanced':True}


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
            "alert_level": "unknown", "date": "",
            "emotion_label": label, "screening_label": "unknown",
            "label_source": "FER2013 expression annotation", "label_validity": "emotion_only",
            "pairing_type": "image_only", "screening_usable": False, "reference_only": True,
            "label_description": "仅表情类别，无心理筛查标签",
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
    #   图→文 / 图→音              → 可用的弱监督桥接；模型缺失回退主引擎
    #   文→图                     → 主引擎和桥接加权；音→图保留主引擎
    #   其余                       → 主引擎共享码空间
    #   上传图像 + 范围「全部模态」  → 按结果模态交错展示，保留不同模态单元
    # 前端上传图像时默认把范围设为「仅图像线索」，因此图搜图自动走新库，
    # 无需前端改动；corpus=image 仍保留为显式覆盖入口。
    has_media = bool(data.get("media_base64") or data.get("media"))
    if modality == "image" and has_media and (
            modality_filter == "image"
            or (data.get("corpus") or "").strip() == "image"):
        return _image_corpus_search(data, top_k)
    engine = get_hashing_engine()
    if getattr(engine, '_initialized', False) is not True:
        await engine.initialize()
    tmp_path = None
    try:
        raw = data.get("media_base64") or data.get("media")
        if modality in ("image", "audio") and raw:
            try:
                tmp_path = decode_media_query(raw, data.get("media_name") or "", modality)
            except MediaQueryError as exc:
                raise HttpError(400, str(exc)) from exc
        # AVDD 等后加入的数据集：在现有结果末尾补 1~2 条，不改页面与主排序。
        def finalize(results, info, mod, filter_):
            result_mod = filter_ or ("audio" if mod == "image" else "image")
            results = _merge_dataset_hits(
                engine, results, data.get("query", ""), mod,
                result_mod, tmp_path, top_k,
            )
            return results, info, mod, filter_

        # 桥接分支：
        #   结果模态明确指定且与查询模态构成桥接对 → 走对应桥接
        #   文→图 且结果模态是「图像」          → 主引擎 + 桥接分数合并
        #   结果模态不限（「全部模态」）且查询是图像 → 多通道合并
        #     （主引擎的图文对齐弱，图搜文仅 0.26；混排会挤掉桥接命中的文本）
        bridge_capable = hasattr(engine, 'units') and hasattr(engine, '_allowed_ids')
        if bridge_capable and modality_filter and modality_filter != modality:
            if modality_filter == "image" and modality == "text":
                # 只对文→图启用合并：实测文搜图合并 +9.4 点
                # （main 0.2351 / bridge 0.2756 / w0.5 0.3292），
                # 而音→图合并是负收益（main 0.1664 / bridge 0.1118 /
                # 所有合并策略 0.104~0.117）—— 桥接在音搜图上本身更弱，
                # 合并进来只会稀释主引擎的结果。
                merged = await _merged_search(data, modality, modality_filter,
                                              top_k, tmp_path, viewer)
                if merged is not None:
                    results, info = merged
                    return finalize(results, info, modality, modality_filter)
            bridged = None if (modality, modality_filter) == ("audio", "image") else _bridge_search(data, modality, modality_filter,
                                     top_k, tmp_path, viewer)
            if bridged is not None:
                results, info = bridged
                return finalize(results, info, modality, modality_filter)
        elif bridge_capable and not modality_filter and modality == "image":
            merged = await _bridge_search_all(data, modality, top_k,
                                         tmp_path, viewer)
            if merged is not None:
                results, info = merged
                return finalize(results, info, modality, modality_filter)
        results, info = await engine.search_with_info(
            query=data.get("query", ""), modality=modality,
            top_k=top_k, modality_filter=modality_filter, media_path=tmp_path,
            viewer=viewer,
        )
        result = finalize(results, info, modality, modality_filter)
    finally:
        remove_media_query(tmp_path)
    return result


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
        "emotionLabel": hit.get("emotion_label"),
        "screeningLabel": hit.get("screening_label"),
        "labelSource": hit.get("label_source"),
        "labelValidity": hit.get("label_validity"),
        "pairingType": hit.get("pairing_type"),
        "screeningUsable": hit.get("screening_usable"),
        "referenceOnly": hit.get("reference_only"),
        "labelDescription": hit.get("label_description"),
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
    screening["symptom_query"] = await _symptom_query(screening)
    initial_pack = build_evidence_pack(screening, history=history)
    retrieval_results = None
    if data.get("include_retrieval"):
        modality, modality_filter, top_k = _params(data)
        engine = get_hashing_engine()
        results, info = await engine.search_with_info(
            query=initial_pack["local_retrieval_query"],
            modality=modality, top_k=top_k, modality_filter=modality_filter,
            viewer=viewer_of(ctx),
        )
        retrieval_results = {
            "query": initial_pack["local_retrieval_query"], "results": results,
            "total": len(results), "index": info,
        }

    await agent_graph.ensure_seeded()
    combined_pack = build_evidence_pack(screening, history=history, retrieval_results=retrieval_results)
    paths = await agent_graph.evidence_paths(combined_pack)
    decisions = await agent_graph.evaluate(combined_pack)
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
    screening["symptom_query"] = await _symptom_query(screening)
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
    return await db.query_a("SELECT id, questionnaire_id, score, max_score, alert_level, screening_date, created_at FROM screenings WHERE case_id = ? AND id != ? AND questionnaire_id=? AND max_score=? ORDER BY COALESCE(screening_date, created_at) DESC LIMIT 5", (case_id, screening.get("id"), screening.get("questionnaire_id"), screening.get("max_score")))


async def _symptom_query(screening: dict) -> str:
    supplements = await db.query_a("SELECT kind, text FROM screening_supplements WHERE screening_id=? AND user_id=? ORDER BY id DESC LIMIT 10", (screening.get("screening_id"), screening.get("user_id")))
    return build_symptom_query(screening, supplements)
