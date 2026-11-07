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


def _merged_score(main_score: float, bridge_score: float,
                  weight: float) -> float:
    """主引擎与桥接的分数线性加权。

    实测（文搜图，同一实验内对比）：
        main 0.2351 / bridge 0.2756 / w0.5 0.3292
    两个通道看到的是不同的相关性（主引擎靠弱语义图像特征 + 文-音锚点，
    桥接靠 CNN 判别特征 + 大 λ 的主题结构），互补而非冗余。
    权重 0.5 最优；RRF 与交错合并都更差（rrf 0.2242 / interleave 0.2105）。
    """
    return weight * main_score + (1.0 - weight) * bridge_score


async def _merged_search(data: dict, modality: str, result_modality: str,
                         top_k: int, tmp_path, viewer: dict):
    """主引擎与桥接的合并检索（文→图 / 音→图）。

    单通道都不够好：主引擎文搜图 0.2351、桥接 0.2756，
    分数线性加权（w=0.5）后 0.3292（同一实验内对比，+9.4 点）。
    两通道的相关性来源不同，互补而非冗余。

    桥接不可用时返回 None，由调用方降级到纯主引擎。
    """
    from app.engines.hashing.bridge_manager import get_bridge_manager

    mgr = get_bridge_manager()
    pair = (modality, "image")
    br = mgr.get(pair)
    if br is None:
        return None
    feat = _bridge_query_feature(modality, data, tmp_path)
    if not feat:
        return None

    engine = get_hashing_engine()
    # 主引擎侧：取混合命中后按结果模态过滤（与九格评测同口径）
    main_hits, _ = await engine.search_with_info(
        query=data.get("query", ""), modality=modality,
        top_k=max(top_k * 6, 60), viewer=viewer, media_path=tmp_path,
    )
    main_score, main_order = {}, []
    for h in main_hits:
        if h.get("modality") != result_modality:
            continue
        rid = h.get("record_id") or h.get("id")
        if rid in main_score:
            continue
        main_score[rid] = float(h.get("score") or h.get("similarity") or 0.0)
        main_order.append(rid)
    if not main_order:
        return None

    # 桥接侧
    bhits = br.search(feat, modality, top_k=max(top_k * 6, 60),
                      result_modality=result_modality)
    bridge_score, bridge_order = {}, []
    for h in bhits:
        rid = h["record_id"]
        if rid in bridge_score:
            continue
        bridge_score[rid] = float(h.get("sim") or 0.0)
        bridge_order.append(rid)
    if not bridge_order:
        return None

    # 分数线性加权合并（w=0.5 最优，见 _merged_score 注释）
    weight = 0.5
    keys = set(main_order) | set(bridge_order)
    merged = []
    for rid in keys:
        merged.append((_merged_score(main_score.get(rid, 0.0),
                                     bridge_score.get(rid, 0.0), weight), rid))
    merged.sort(key=lambda x: -x[0])

    unit_meta_by_rid = {}
    for h in bhits:
        unit_meta_by_rid.setdefault(h["record_id"], h.get("unit_meta") or {})

    results = []
    for score, rid in merged[:top_k]:
        rec = (engine.records or {}).get(rid) or {}
        umeta = unit_meta_by_rid.get(rid) or {}
        prov = reference_labels(umeta) if umeta else {}
        results.append({
            "record_id": rid,
            "unit_id": (umeta.get("unit_id") or ""),
            "modality": result_modality,
            "score": round(score, 4),
            "similarity": round(score, 4),
            "tags": prov.get("tags") or rec.get("tags") or [],
            "window": rec.get("window"),
            "scope": rec.get("scope"),
            "source": "merged",
            **prov,
            "explain": {
                "route": f"merged:main+bridge:{pair[0]}-{pair[1]}",
                "note": "主引擎与弱监督桥接的分数加权合并",
            },
        })
    info = {
        "route": f"merged:main+bridge:{pair[0]}-{pair[1]}",
        "merge_weight": weight,
        "main_candidates": len(main_order),
        "bridge_candidates": len(bridge_order),
        "bridge_stats": mgr.status(),
    }
    return results, info


def _bridge_query_feature(modality: str, data: dict, tmp_path):
    """按查询模态取特征，���训练侧同口径（bge 531 维 / MFCC 64 / CNN 1280）。"""
    from app.engines.hashing import features as F
    from app.engines.hashing import real_features as RF
    from app.engines.hashing.fer_encoder import FerEncoder

    try:
        if modality == "text":
            return list(F.semantic_feature(data.get("query") or ""))
        if modality == "audio":
            return RF.audio_feature(tmp_path) if tmp_path else None
        enc = FerEncoder()
        if enc.available and tmp_path:
            return enc.feature(tmp_path)
        return None
    except Exception:
        return None


def _bridge_search(data: dict, modality: str, result_modality: str,
                   top_k: int, tmp_path, viewer: dict):
    """走弱监督桥接检索（图↔文 / 图↔音）。

    桥接是独立码空间，与主引擎完全隔离：主引擎的文-音共享码空间里，
    图像视图是情绪弱配对（FER2013 与文本/语音无同源关系），
    图搜文只有 0.2231；桥接用同一套 CMFH 公式但只喂两个模态、
    并把监督权重 λ 提到 20/50，图搜文实测 0.5776、图搜音 0.4193。

    桥接模型未构建时返回 None，由调用方降级到主引擎。
    """
    from app.engines.hashing.bridge_manager import get_bridge_manager

    mgr = get_bridge_manager()
    channel, payload = mgr.route(modality, result_modality)
    if channel != "bridge":
        return None
    _pair, br = payload

    feat = _bridge_query_feature(modality, data, tmp_path)
    if not feat:
        import logging
        logging.getLogger(__name__).warning(
            "桥接检索：查询特征抽取失败（modality=%s, 有临时文件=%s），降级主引擎",
            modality, bool(tmp_path))
        return None

    # 桥接索引里的单元是语料单元；可见性过滤交回主引擎的规则
    hits = br.search(feat, modality, top_k=max(top_k * 3, 20),
                     result_modality=result_modality)
    if not hits:
        import logging
        logging.getLogger(__name__).warning(
            "桥接检索无命中（modality=%s -> %s, 特征维度=%s），降级主引擎",
            modality, result_modality, len(feat))
        return None

    # 取回主引擎的记录级信息（告警等级、主题、窗口）以便前端展示
    engine = get_hashing_engine()
    results = []
    for h in hits:
        rid = h.get("record_id")
        rec = (engine.records or {}).get(rid) or {}
        unit_meta = h.get("unit_meta") or {}
        # 标签溯源按**单元**算，不按记录：同一条记录里 FER 表情图只有表情标签、
        # EATD 文本才有 SDS 筛查标签，按记录给 alert_level 会把两者混为一谈。
        prov = reference_labels(unit_meta) if unit_meta else {}
        results.append({
            "record_id": rid,
            "unit_id": h.get("unit_id"),
            "modality": h.get("modality"),
            "score": h.get("sim"),
            "similarity": h.get("sim"),
            "tags": prov.get("tags") or rec.get("tags") or h.get("tags") or [],
            "window": rec.get("window"),
            "scope": rec.get("scope"),
            "source": "bridge",
            **prov,
            "explain": {
                "route": f"bridge:{_pair[0]}-{_pair[1]}",
                "note": "弱监督桥接码空间（该模态对无真同源数据，走独立桥接）",
            },
        })
    info = {
        "route": f"bridge:{_pair[0]}-{_pair[1]}",
        "index_size": len(br.units),
        "code_length": br.K,
        "lambda_s": br.lambda_s,
        "bridge_stats": mgr.status(),
    }
    return results[:top_k], info


def _bridge_search_all(data: dict, modality: str, top_k: int,
                        tmp_path, viewer: dict):
    """「全部模态」范围下的多通道合并检索。

    前端的检索范围默认是「全部模态」（modality_filter=None），此时
    主引擎会把文/音/图三个模态混在一起返回 —— 图像查询时，
    主引擎的图文对齐能力弱（图搜文仅 0.2231），混排会把桥接能命中的
    文本结果挤到后面去。

    这里按「查询模态 × 结果模态」拆成多条通道，各自取 top_k，
    再按记录去重合并：
        图查询 → 文-图桥接（图→text）+ 音-图桥接（图→audio）+ 主引擎（图→image）
        文查询 → 主引擎（文↔文/文↔音，真同源，四格 0.44，主引擎已足够）
        音查询 → 主引擎（音↔文/音↔音，同上）
    """
    from app.engines.hashing.bridge_manager import (
        get_bridge_manager, TEXT_IMAGE, AUDIO_IMAGE,
    )

    mgr = get_bridge_manager()
    feat = _bridge_query_feature(modality, data, tmp_path)
    if not feat:
        return None

    channels = []
    # 图像查询：文本与语音结果分别走对应桥接
    if modality == "image":
        for pair in (TEXT_IMAGE, AUDIO_IMAGE):
            br = mgr.get(pair)
            if br is None:
                continue
            rmod = "text" if pair is TEXT_IMAGE else "audio"
            hits = br.search(feat, modality, top_k=max(top_k * 2, 20),
                             result_modality=rmod)
            if hits:
                channels.append((f"bridge:{pair[0]}-{pair[1]}", rmod, hits))
    if not channels:
        return None

    # 合并：按记录去重，同一记录保留分数最高的一条
    engine = get_hashing_engine()
    merged = {}
    order = []
    for route, rmod, hits in channels:
        for h in hits:
            rid = h.get("record_id")
            score = h.get("sim") or 0.0
            prev = merged.get(rid)
            if prev is None:
                merged[rid] = {
                    "record_id": rid, "unit_id": h.get("unit_id"),
                    "modality": h.get("modality"), "score": score,
                    "similarity": score, "_route": route,
                    "tags": h.get("tags") or [],
                    "unit_meta": h.get("unit_meta") or {},
                }
                order.append(rid)
            elif score > prev["score"]:
                prev.update({"unit_id": h.get("unit_id"),
                             "modality": h.get("modality"),
                             "score": score, "similarity": score,
                             "_route": route,
                             "unit_meta": h.get("unit_meta") or prev.get("unit_meta")})
    if not order:
        return None

    order.sort(key=lambda rid: -(merged[rid]["score"]))
    results = []
    for rid in order[:top_k]:
        m = merged[rid]
        rec = (engine.records or {}).get(rid) or {}
        prov = reference_labels(m.get("unit_meta") or {}) if m.get("unit_meta") else {}
        results.append({
            "record_id": rid,
            "unit_id": m.get("unit_id"),
            "modality": m.get("modality"),
            "score": m.get("score"),
            "similarity": m.get("similarity"),
            "tags": prov.get("tags") or rec.get("tags") or m.get("tags") or [],
            "window": rec.get("window"),
            "scope": rec.get("scope"),
            "source": "bridge",
            **prov,
            "explain": {
                "route": m.get("_route"),
                "note": "弱监督桥接码空间（该模态对无真同源数据，走独立桥接）",
            },
        })
    info = {
        "route": "bridge:multi",
        "channels": [c[0] for c in channels],
        "bridge_stats": mgr.status(),
    }
    return results, info


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
    #   图↔文 / 图↔音              → 弱监督桥接（独立码空间，图搜文实测 0.5776）
    #   其余（文↔文、文↔音、音↔音）→ 主引擎共享码空间（真同源，四格 0.44）
    #   上传图像 + 范围「全部模态」  → 主引擎（跨模态，图搜文/图搜语音）
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
        # 桥接分支：
        #   结果模态明确指定且与查询模态构成桥接对 → 走对应桥接
        #   文→图 且结果模态是「图像」          → 主引擎 + 桥接分数合并
        #   结果模态不限（「全部模态」）且查询是图像 → 多通道合并
        #     （主引擎的图文对齐弱，图搜文仅 0.26；混排会挤掉桥接命中的文本）
        if modality_filter and modality_filter != modality:
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
                    return results, info, modality, modality_filter
            bridged = _bridge_search(data, modality, modality_filter,
                                     top_k, tmp_path, viewer)
            if bridged is not None:
                results, info = bridged
                return results, info, modality, modality_filter
        elif not modality_filter and modality == "image":
            merged = _bridge_search_all(data, modality, top_k,
                                         tmp_path, viewer)
            if merged is not None:
                results, info = merged
                return results, info, modality, modality_filter
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
