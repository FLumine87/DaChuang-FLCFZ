"""动态跨模态哈希检索引擎（真实实现）。

对接 HashingEngineInterface，整合三个部分：

  * features          : 文本特征（TF 哈希桶 ⊕ 主题语义桥）
  * real_features     : 真实图像 / 语音特征（48×48 面部图像描述子、MFCC+韵律）
  * cmfh              : 在线监督集体矩阵分解跨模态哈希（共享二值码 + 各模态投影）
  * multi_table_index : 时间窗 × 位带 的多哈希表索引（可证明召回 + 表质量评估）

核心设计（与旧版相比的四处关键修正）
------------------------------------
1. **单元级索引**：索引对象是「某条记录在某个模态下的视图」，而不是整条记录。
   一条记录 = 一个文本自述单元 + 一个图像单元 + 一个语音单元，三者共享同一二值码。
   因此用文本查询可以直接命中该记录的图像/语音单元（即真正的跨模态检索）。

2. **真实模态特征**：图像走 `real_features.image_feature`（强度分块 ⊕ HOG，192 维），
   语音走 `real_features.audio_feature`（MFCC ⊕ 韵律，64 维），
   文本走 `features.semantic_feature`（256 桶 ⊕ 主题语义，275 维）。
   三个模态维度不同，各自由 CMFH 学一个投影矩阵 W_m。
   旧实现里图像/语音特征是由文本派生的占位，所谓"跨模态"其实是自证。

3. **配对训练**：三个模态视图按记录行对齐组成 X_text / X_image / X_audio，
   共同重建同一码矩阵 B —— 跨模态对齐来自共享的 B 与重构项，
   语义监督 S 来自记录级主题 Jaccard（含风险类别主题）。

4. **查询只走本模态编码器**：文本查询只用 W_text，图像查询只用 W_image，
   再与所有模态的码比汉明距离 / 非对称距离。跨模态是靠训练学出来的，不是造出来的。

数据来源优先级（`_corpus_paths` 依次尝试）：
    real_corpus.db（真实数据集语料）→ corpus.db（合成语料）
    → 主库业务表 → retrieval_seed.db → demo_data 兜底

状态（模型 W + 单元码 + 元数据）持久化为本地 JSON，重启后直接复用；
新数据走 index_case 增量插入，无需全量重训。
"""
import asyncio
import datetime
import json
import os
import random
from typing import Any, Dict, List, Optional, Tuple

from app.engines.hashing import real_features as RF
from app.engines.hashing.cmfh import OnlineSupervisedCMFH
from app.engines.hashing.demo_data import build_demo_dataset
from app.engines.hashing.interface import HashingEngineInterface
from app.engines.hashing.multi_table_index import MultiTableHashIndex
from app.engines.hashing import features as F

try:
    from app.config import settings
except Exception:  # 依赖未安装时（如独立跑算法脚本）使用兜底默认
    class _DefaultSettings:
        HASHING_CODE_LENGTH = 64
        HASHING_LAMBDA_S = 0.6
        HASHING_BAND_BITS = 8
        HASHING_TABLE_RHO_MIN = 0.10
        HASHING_TABLE_SIGMA_MIN = 0.02
        HASHING_WINDOW_DAYS = 122
        HASHING_EPOCH = "2025-08-01"
        HASHING_DATA_DIR = "./data/hashing"
        HASHING_CORPUS_DB = "./data/hashing/real_corpus.db"
        HASHING_FALLBACK_CORPUS_DB = "./data/hashing/corpus.db"
        HASHING_USE_CORPUS = True
        HASHING_TRAIN_MAX = 300
        HASHING_BALANCE_MODALITIES = True
        RETRIEVAL_SEED_DB = "./data/retrieval_seed.db"
    settings = _DefaultSettings()

# 状态文件版本：结构不兼容时自动重建（旧版本文件不会被误用）
# v4：单元新增 media_path / media_kind / dataset，且图像/语音改用真实特征
# v5：状态新增 corpus_meta（数据集来源标注需重启后仍可展示）
# v6：单元新增 media_meta（图像/语音命中展示真实文件名与数据集自带标注）
STATE_VERSION = 6
TRAIN_MODALITIES = ("text", "image", "audio")
MODALITY_LABEL = {"text": "文本", "image": "图像", "audio": "语音"}
# 媒体缩略图缓存上限（条）；超出后整体清空，避免长期运行内存膨胀
_MEDIA_CACHE_MAX = 600


def _date_iso(v) -> str:
    """日期兼容：sqlite3 返回 'YYYY-MM-DD HH:MM:SS' 字符串，ORM 可能返回 datetime。"""
    if not v:
        return ""
    if hasattr(v, "isoformat"):
        return v.isoformat()[:10]
    return str(v)[:10]


def _jaccard(a, b) -> float:
    sa, sb = set(a or []), set(b or [])
    u = sa | sb
    return (len(sa & sb) / len(u)) if u else 0.0


def _bits_to_hex(bits) -> str:
    """二值码 -> 十六进制串（64 位 -> 16 个 hex 字符），便于前端展示。"""
    if not bits:
        return ""
    s = "".join("1" if b else "0" for b in bits)
    width = (len(s) + 3) // 4
    return format(int(s, 2), "0{}x".format(width))


def _loads(raw, default=None):
    try:
        return json.loads(raw) if raw else (default if default is not None else [])
    except Exception:
        return default if default is not None else []


class DynamicCrossModalHashingEngine(HashingEngineInterface):
    def __init__(self):
        self._initialized = False
        self.code_length = int(getattr(settings, "HASHING_CODE_LENGTH", 64))
        self.model = OnlineSupervisedCMFH(
            code_length=self.code_length, lambda_s=settings.HASHING_LAMBDA_S
        )
        self.index = self._new_index()
        self.records: Dict[str, Dict] = {}   # record_id -> {tags, alert_level, date, window, views}
        self.units: Dict[str, Dict] = {}     # unit_id -> {record_id, modality, excerpt, tags, code, ...}
        self.state_path = os.path.join(settings.HASHING_DATA_DIR, "hashing_state.json")
        self._init_lock = asyncio.Lock()
        self._train_cap = int(getattr(settings, "HASHING_TRAIN_MAX", 300))
        self._source = ""          # corpus-real | corpus | db | seedfile | demo
        self._source_count = 0
        self._seeded_from_db = False
        self._corpus_path = ""     # 当前生效的语料库路径
        self._corpus_meta: Dict[str, str] = {}
        self._media_cache: Dict[str, Optional[str]] = {}
        self.last_search_info: Dict = {}

    def _new_index(self) -> MultiTableHashIndex:
        return MultiTableHashIndex(
            code_length=self.code_length,
            band_bits=int(getattr(settings, "HASHING_BAND_BITS", 8)),
            probe_bits=int(getattr(settings, "HASHING_PROBE_BITS", 2)),
            rho_min=float(getattr(settings, "HASHING_TABLE_RHO_MIN", 0.10)),
            sigma_min=float(getattr(settings, "HASHING_TABLE_SIGMA_MIN", 0.02)),
            epoch=str(getattr(settings, "HASHING_EPOCH", "2025-08-01")),
            window_days=int(getattr(settings, "HASHING_WINDOW_DAYS", 122)),
        )

    # ------------------------- 生命周期 -------------------------

    async def _ensure_initialized(self):
        """惰性初始化（并发安全）：首次使用前自动训练 / 加载，避免每次请求重训。"""
        if self._initialized:
            return
        async with self._init_lock:
            if self._initialized:
                return
            await self.initialize()

    async def initialize(self) -> None:
        self._do_initialize()

    def _do_initialize(self):
        """加载已有状态；状态缺失 / 版本不兼容 / 数据源增长时按来源重建。

        注意：版本不兼容要走「按来源重建」而不是「退回演示集」，
        否则升级结构后会把真实语料丢掉。
        """
        loaded = False
        if os.path.exists(self.state_path):
            try:
                self._load_state()
                loaded = bool(self.units)
            except Exception:
                loaded = False
        try:
            if not loaded or self._source_grew():
                self._rebuild()
        except Exception:
            # 任何异常都退回演示集重建，保证引擎始终可用
            self._rebuild_demo()
            self._save_state()
        self._initialized = True

    async def health_check(self) -> bool:
        return self._initialized

    # ------------------------- 来源判定与播种 -------------------------

    def _corpus_paths(self) -> List[str]:
        """按优先级返回候选语料库路径。

        real_corpus.db 由 scripts/build_real_corpus.py 依据真实数据集生成
        （仓库外数据，本地构建，不入库）；corpus.db 是随仓库发布的合成语料。
        真实语料存在时优先使用，缺失时自动退回合成语料，保证开箱可用。
        """
        cands = [getattr(settings, "HASHING_CORPUS_DB", ""),
                 getattr(settings, "HASHING_FALLBACK_CORPUS_DB", "")]
        out, seen = [], set()
        for p in cands:
            if not p:
                continue
            ap = os.path.abspath(p)
            if ap not in seen:
                seen.add(ap)
                out.append(ap)
        return out

    def _rebuild(self):
        """按来源优先级重建索引：真实语料 -> 合成语料 -> 主库 -> 种子库 -> 演示集。"""
        self.model = OnlineSupervisedCMFH(
            code_length=self.code_length, lambda_s=settings.HASHING_LAMBDA_S
        )
        self.index = self._new_index()
        self.records = {}
        self.units = {}
        self._seeded_from_db = False
        self._media_cache = {}

        if getattr(settings, "HASHING_USE_CORPUS", True):
            for corpus in self._corpus_paths():
                if not os.path.exists(corpus):
                    continue
                if self._seed_from_corpus(corpus):
                    self._corpus_path = corpus
                    self._source = ("corpus-real"
                                    if self._corpus_meta.get("kind") == "real" else "corpus")
                    self._source_count = self._count_corpus_units()
                    self._save_state()
                    return

        rows = self._collect_db_rows()
        if rows and self._seed_from_rows(rows):
            self._source = "db"
            self._source_count = self._count_db_rows()
            self._seeded_from_db = True
            self._save_state()
            return

        seed_db = getattr(settings, "RETRIEVAL_SEED_DB", "")
        if seed_db and os.path.exists(seed_db):
            rows = self._collect_rows_from_file(seed_db)
            if rows and self._seed_from_rows(rows):
                self._source = "seedfile"
                self._source_count = len(rows)
                self._seeded_from_db = True
                self._save_state()
                return

        self._rebuild_demo()
        self._save_state()

    def _rebuild_demo(self):
        self.model = OnlineSupervisedCMFH(
            code_length=self.code_length, lambda_s=settings.HASHING_LAMBDA_S
        )
        self.index = self._new_index()
        self.records = {}
        self.units = {}
        self._corpus_path = ""
        self._corpus_meta = {}
        ds = build_demo_dataset()
        cases = ds["cases"]
        self._train([{"record_id": c["id"], "views": {"text": c["summary"]},
                      "tags": c.get("tags") or []} for c in cases])
        for c in cases:
            self._add_unit(c["id"], {
                "record_id": c["id"], "modality": "text",
                "tags": c.get("tags") or [],
                "alert_level": c.get("alert_level", "green"), "date": c.get("date", ""),
                "content": c["summary"],
            })
        self._source = "demo"
        self._source_count = 0

    def _source_grew(self) -> bool:
        """判断数据源在停机期间是否增长（增长则重建）。"""
        if self._source in ("corpus", "corpus-real"):
            return self._count_corpus_units() > self._source_count
        if self._source in ("db", "seedfile"):
            return self._count_db_rows() > self._source_count
        return False

    def _count_corpus_units(self) -> int:
        path = self._corpus_path or next(
            (p for p in self._corpus_paths() if os.path.exists(p)), "")
        if not path or not os.path.exists(path):
            return 0
        try:
            import sqlite3
            conn = sqlite3.connect(path)
            try:
                return conn.execute("SELECT COUNT(*) FROM units").fetchone()[0]
            finally:
                conn.close()
        except Exception:
            return 0

    def _count_db_rows(self) -> int:
        """统计四张业务表的总行数，用于判断是否需要重新播种。"""
        try:
            from app.db import database as db
            total = 0
            for table in ("screenings", "cases", "alerts", "media_files"):
                row = db.query_one(f"SELECT COUNT(*) AS c FROM {table}")
                total += row["c"] if row else 0
            return total
        except Exception:
            return 0

    # ------------------------- 特征 -------------------------

    def _feature_of(self, modality: str, text: str, media_path: Optional[str] = None) -> Dict[str, List[float]]:
        """按模态取特征，返回 {modality: vector}。

        * 文本：TF 哈希桶 ⊕ 主题语义桥（`features.semantic_feature`）
        * 图像：`real_features.image_feature`（192 维手工描述子）
        * 语音：`real_features.audio_feature`（64 维 MFCC ⊕ 韵律）

        媒体特征抽取失败（文件损坏 / 缺 Pillow）时退回文本编码器，
        保证编码永远能产出有效码，不会退化成全零码。
        """
        if modality == "image" and media_path:
            f = RF.image_feature(media_path)
            if f:
                return {"image": f}
        if modality == "audio" and media_path:
            f = RF.audio_feature(media_path)
            if f:
                return {"audio": f}
        return {"text": F.semantic_feature(text)}

    def _feature_vec(self, modality: str, text: str,
                     media_path: Optional[str] = None) -> List[float]:
        """取单模态特征向量（训练时按模态列对齐用）。"""
        return list(self._feature_of(modality, text, media_path).values())[0]

    def _view_text(self, view: Any) -> str:
        """视图兼容取值：新结构是 {text, path}，旧结构是纯字符串。"""
        if isinstance(view, dict):
            return view.get("text") or ""
        return view if isinstance(view, str) else str(view or "")

    def _view_path(self, view: Any) -> Optional[str]:
        return view.get("path") if isinstance(view, dict) else None

    # ------------------------- 训练 -------------------------

    def _train(self, records: List[Dict]) -> bool:
        """在「配对记录」上训练 CMFH。

        records: [{record_id, views: {modality: text | {text, path}}, tags: [...]}]
        三个模态视图按记录行对齐，共享同一码矩阵 B —— 这是跨模态对齐的来源。
        每个模态独立特征维度（文本 275 / 图像 192 / 语音 64），
        CMFH 为每个模态学一个 W_m，因此维度不同不影响配对训练。
        """
        recs = [r for r in records if r.get("views")]
        if not recs:
            return False
        mods = [m for m in TRAIN_MODALITIES if all(m in r["views"] for r in recs)]
        if not mods:
            mods = ["text"]
            recs = [{"record_id": r["record_id"],
                     "views": {"text": self._view_text(list(r["views"].values())[0])},
                     "tags": r.get("tags")} for r in recs]

        feats: Dict[str, List[List[float]]] = {}
        for m in mods:
            vecs = [self._feature_vec(m, self._view_text(r["views"][m]),
                                      self._view_path(r["views"][m])) for r in recs]
            # 同一模态内维度必须一致，否则 Gram 矩阵无法构造。
            # 个别媒体抽取失败会退回文本特征（维度不同）→ 该模态整体不参与配对训练，
            # 而不是静默算出错误结果。语料由 build_real_corpus.py 预抽取并校验，
            # 正常情况不会触发这条分支。
            if len({len(v) for v in vecs}) != 1:
                continue
            feats[m] = vecs
        if not feats:
            return False

        sim = [[_jaccard(recs[i].get("tags"), recs[j].get("tags")) for j in range(len(recs))]
               for i in range(len(recs))]
        for i in range(len(recs)):
            sim[i][i] = 1.0
        self.model.fit(feats, sim)
        return True

    def _add_unit(self, unit_id: str, meta: Dict) -> None:
        """编码并入索引（单元 = 记录在某模态下的视图），同时登记记录级信息。"""
        modality = meta.get("modality", "text")
        content = meta.get("content") or meta.get("summary") or ""
        feature = meta.get("feature")
        if feature and self.model.W.get(modality) and len(feature) == len(self.model.W[modality][0]):
            # 语料预抽取的离线特征：直接用，省去重复解码媒体
            feat = {modality: feature}
        else:
            feat = self._feature_of(modality, content, meta.get("media_path"))
        code = self.model.encode(feat)
        meta = dict(meta)
        meta["code"] = list(code)
        meta.pop("feature", None)      # 特征可由媒体/文本重算，不必进状态文件
        self.units[unit_id] = meta
        rid = meta.get("record_id")
        if rid and rid not in self.records:
            self.records[rid] = {
                "record_id": rid, "tags": meta.get("tags") or [],
                "alert_level": meta.get("alert_level", "green"),
                "date": meta.get("date", ""), "window": meta.get("window"),
            }
        self.index.insert(unit_id, code, meta, window=meta.get("window"))

    # ------------------------- 语料播种（真实 / 合成多模态数据）-------------------------

    def _seed_from_corpus(self, path: str) -> bool:
        """从语料库播种索引。

        语料 schema 见 scripts/generate_retrieval_corpus.py（合成）与
        scripts/build_real_corpus.py（真实，额外含 media_path / feature / dataset）。
        两种语料共用同一段播种逻辑：真实语料多了媒体路径与离线特征，
        合成语料的图像/语音视图是文本派生文本，因此走文本特征即可。
        """
        try:
            import sqlite3
            conn = sqlite3.connect(path)
            conn.row_factory = sqlite3.Row
            try:
                rows = [dict(r) for r in conn.execute(
                    "SELECT * FROM units ORDER BY record_id, modality")]
                meta = {}
                try:
                    meta = {r["key"]: r["value"] for r in conn.execute("SELECT * FROM meta")}
                except Exception:
                    meta = {}
            finally:
                conn.close()
        except Exception:
            return False
        if not rows:
            return False

        self._corpus_meta = meta

        by_rec: Dict[str, Dict[str, Dict]] = {}
        for u in rows:
            by_rec.setdefault(u["record_id"], {})[u["modality"]] = u
        rec_ids = sorted(by_rec.keys())
        sample_ids = (rec_ids if len(rec_ids) <= self._train_cap
                      else random.sample(rec_ids, self._train_cap))
        train_records = []
        for rid in sample_ids:
            views = {}
            for m, v in by_rec[rid].items():
                if m in TRAIN_MODALITIES:
                    views[m] = {"text": v.get("content") or "",
                                "path": v.get("media_path")}
            if not views:
                continue
            any_unit = next(iter(by_rec[rid].values()))
            train_records.append({"record_id": rid, "views": views,
                                  "tags": _loads(any_unit.get("themes"))})
        if not self._train(train_records):
            return False

        for u in rows:
            content = u.get("content") or ""
            self._add_unit(u["unit_id"], {
                "record_id": u["record_id"],
                "modality": u.get("modality", "text"),
                "tags": _loads(u.get("themes")),
                "alert_level": u.get("alert_level") or "green",
                "date": (u.get("created_at") or "")[:10],
                "window": u.get("window"),
                "content": content,
                "media_path": u.get("media_path"),
                "media_kind": u.get("media_kind"),
                "feature": _loads(u.get("feature"), None),
                "media_meta": _loads(u.get("meta"), None),
                "dataset": u.get("dataset"),
            })
        return True

    # ------------------------- 业务表播种 -------------------------

    def _make_row(self, cid, summary, tags, alert_level, modality, date, deid_terms=None) -> Dict:
        return {
            "id": cid, "summary": summary, "tags": tags or [],
            "alert_level": alert_level, "modality": modality, "date": date,
            "deid_terms": deid_terms or [],
        }

    def _seed_from_rows(self, rows: List[Dict]) -> bool:
        sample = (rows if len(rows) <= self._train_cap
                  else random.sample(rows, self._train_cap))
        if not self._train([{"record_id": r["id"],
                             "views": {"text": r.get("summary") or ""},
                             "tags": r.get("tags") or []} for r in sample]):
            return False
        for r in rows:
            summary = r.get("summary") or ""
            self._add_unit(r["id"], {
                "record_id": r["id"], "modality": r.get("modality", "text"),
                "tags": r.get("tags") or [],
                "alert_level": r.get("alert_level", "green"),
                "date": r.get("date", ""), "content": summary,
                "deid_terms": r.get("deid_terms") or [],
            })
        return True

    def _collect_db_rows(self) -> List[Dict]:
        """读取四张业务表，构造可被索引的行（含主题标签与脱敏用词）。"""
        try:
            from app.db import database as db
        except Exception:
            return []
        rows: List[Dict] = []
        try:
            for s in db.query("SELECT * FROM screenings"):
                q = ""
                if s.get("questionnaire_id"):
                    qr = db.query_one(
                        "SELECT name FROM questionnaires WHERE id = ?", (s["questionnaire_id"],))
                    q = qr["name"] if qr else ""
                summary = f"{s.get('name') or ''}。{s.get('answers') or ''} {s.get('notes') or ''} {q}".strip()
                if len(summary) <= len(s.get("name") or "") + 1:
                    summary = f"{s.get('name')} 完成{q or '心理'}筛查，评分 {s.get('score')}。"
                rows.append(self._make_row(
                    cid=f"scr-{s['id']}", summary=summary,
                    tags=F.extract_themes(summary),
                    alert_level=s.get("alert_level") or "green", modality="text",
                    date=_date_iso(s.get("created_at")),
                    deid_terms=[s.get("name")],
                ))
            for c in db.query("SELECT * FROM cases"):
                summary = f"{c.get('name')}。{c.get('notes') or ''}".strip()
                tags = [t["name"] for t in db.query(
                    "SELECT t.name FROM case_tags_association a JOIN case_tag_master t ON a.tag_id = t.id "
                    "WHERE a.case_id = ?", (c["id"],))] or F.extract_themes(summary)
                rows.append(self._make_row(
                    cid=f"case-{c['id']}", summary=summary, tags=tags,
                    alert_level=c.get("alert_level") or "green", modality="text",
                    date=_date_iso(c.get("created_at")),
                    deid_terms=[c.get("name")],
                ))
            for a in db.query("SELECT * FROM alerts"):
                summary = f"{a.get('name')}。{a.get('trigger') or ''} {a.get('description') or ''}".strip()
                rows.append(self._make_row(
                    cid=f"alt-{a['id']}", summary=summary,
                    tags=F.extract_themes(summary),
                    alert_level=a.get("level") or "green", modality="text",
                    date=_date_iso(a.get("created_at")),
                ))
            for m in db.query("SELECT * FROM media_files"):
                summary = f"{m.get('description') or ''} {m.get('file_type') or ''} 资料".strip()
                modality_map = {"audio": "audio", "image": "image", "document": "text"}
                modality = modality_map.get(m.get("file_type"), m.get("file_type")) or "text"
                if modality not in ("text", "audio", "image", "multimodal"):
                    modality = "text"
                rows.append(self._make_row(
                    cid=f"media-{m['id']}", summary=summary,
                    tags=F.extract_themes(summary),
                    alert_level="green", modality=modality,
                    date=_date_iso(m.get("created_at")),
                ))
        except Exception:
            return []
        return rows

    def _collect_rows_from_file(self, path: str) -> List[Dict]:
        """从独立的 SQLite 文件（检索种子库）读取四张检索表，复用同一套行构造逻辑。"""
        try:
            import sqlite3
            conn = sqlite3.connect(path)
            conn.row_factory = sqlite3.Row
        except Exception:
            return []
        rows: List[Dict] = []
        try:
            def all_(table):
                return [dict(r) for r in conn.execute(f"SELECT * FROM {table}")]

            for s in all_("screenings"):
                q = ""
                if s.get("questionnaire_id"):
                    r = conn.execute(
                        "SELECT name FROM questionnaires WHERE id = ?", (s["questionnaire_id"],)).fetchone()
                    q = r["name"] if r else ""
                summary = f"{s.get('name') or ''}。{s.get('answers') or ''} {s.get('notes') or ''} {q}".strip()
                if len(summary) <= len(s.get("name") or "") + 1:
                    summary = f"{s.get('name')} 完成{q or '心理'}筛查，评分 {s.get('score')}。"
                rows.append(self._make_row(
                    cid=f"scr-{s['id']}", summary=summary,
                    tags=F.extract_themes(summary),
                    alert_level=s.get("alert_level") or "green", modality="text",
                    date=_date_iso(s.get("created_at")),
                    deid_terms=[s.get("name")],
                ))
            for c in all_("cases"):
                summary = f"{c.get('name')}。{c.get('notes') or ''}".strip()
                tags = [r["name"] for r in conn.execute(
                    "SELECT t.name FROM case_tags_association a JOIN case_tag_master t ON a.tag_id = t.id "
                    "WHERE a.case_id = ?", (c["id"],)).fetchall()] or F.extract_themes(summary)
                rows.append(self._make_row(
                    cid=f"case-{c['id']}", summary=summary, tags=tags,
                    alert_level=c.get("alert_level") or "green", modality="text",
                    date=_date_iso(c.get("created_at")),
                    deid_terms=[c.get("name")],
                ))
            for a in all_("alerts"):
                summary = f"{a.get('name')}。{a.get('trigger') or ''} {a.get('description') or ''}".strip()
                rows.append(self._make_row(
                    cid=f"alt-{a['id']}", summary=summary,
                    tags=F.extract_themes(summary),
                    alert_level=a.get("level") or "green", modality="text",
                    date=_date_iso(a.get("created_at")),
                ))
            for m in all_("media_files"):
                summary = f"{m.get('description') or ''} {m.get('file_type') or ''} 资料".strip()
                modality_map = {"audio": "audio", "image": "image", "document": "text"}
                modality = modality_map.get(m.get("file_type"), m.get("file_type")) or "text"
                if modality not in ("text", "audio", "image", "multimodal"):
                    modality = "text"
                rows.append(self._make_row(
                    cid=f"media-{m['id']}", summary=summary,
                    tags=F.extract_themes(summary),
                    alert_level="green", modality=modality,
                    date=_date_iso(m.get("created_at")),
                ))
        except Exception:
            rows = []
        finally:
            conn.close()
        return rows

    # ------------------------- 接口实现 -------------------------

    def _extract_query_features(self, data: Any, modality: str,
                                media_path: Optional[str] = None) -> Dict[str, List[float]]:
        """查询编码：只使用查询模态自己的编码器（跨模态靠训练学出的共享码空间）。

        data        : 文本内容（也可以是媒体文件路径，兼容旧调用）
        media_path  : 媒体查询的本地文件路径（图像/语音上传后落盘的位置）
        """
        src = media_path
        text = ""
        if isinstance(data, (bytes, bytearray)):
            text = data.decode("utf-8", "ignore") or str(len(data))
        elif isinstance(data, str):
            if os.path.exists(data) and not src:
                src = data            # 旧调用：直接把文件路径当查询
            else:
                text = data
        else:
            text = str(data)

        # 该模态没有投影矩阵时（例如演示语料只训练了文本），退回文本编码器，
        # 否则 encode_continuous 会因维度不匹配返回全零码 → 所有相似度相等。
        if modality in ("image", "audio") and modality in (self.model.W or {}):
            f = (RF.image_feature(src) if modality == "image" and src
                 else RF.audio_feature(src) if modality == "audio" and src else None)
            if f:
                return {modality: f}
        return {"text": F.semantic_feature(text or (src or ""))}

    async def encode(self, data: Any, modality: str) -> List[int]:
        await self._ensure_initialized()
        return self.model.encode(self._extract_query_features(data, modality))

    async def search_with_info(
        self, query: str, modality: str = "text", top_k: int = 5,
        modality_filter: Optional[str] = None, exclude_ids: Optional[List[str]] = None,
        media_path: Optional[str] = None,
    ) -> Tuple[List[Dict], Dict]:
        """检索并返回 (结果列表, 检索过程信息)。

        media_path 供图像/语音查询使用：特征取自媒体文件，
        `query` 仍是该次查询的文字描述（用于抽取主题、展示"为什么相似"）。
        """
        await self._ensure_initialized()
        feat = self._extract_query_features(query, modality, media_path)
        code = self.model.encode(feat)
        qvec = self.model.encode_continuous(feat)
        # 混合视图（未指定结果模态）默认按模态轮转交错：
        # 真实语料下同模态码更相近，全局排序的前若干名会被查询模态占满
        # （实测文本查询 top-24 全为文本单元），跨模态命中根本进不了结果页。
        # 因此这里对每个模态各取 top_k 再轮转合并，保证跨模态结果可见。
        balance = (bool(getattr(settings, "HASHING_BALANCE_MODALITIES", True))
                   and not modality_filter and len(self.units) > top_k)
        if balance:
            info = None
            pool_ids: List[str] = []
            pool_sims: List[float] = []
            cand_total = 0
            probed_total = 0
            present = self.index.modality_distribution()
            for m in TRAIN_MODALITIES:
                if present.get(m, 0) == 0:
                    continue
                mids, msims, minfo = self.index.search(
                    code, top_k=top_k, modality_filter=m,
                    exclude_ids=exclude_ids, query_vec=qvec,
                )
                if info is None:
                    info = minfo
                # 候选 / 探测桶按各模态检索累加，否则展示的是单模态的局部统计
                cand_total += minfo["candidates"]
                probed_total += minfo["keys_probed"]
                pool_ids.extend(mids)
                pool_sims.extend(msims)
            ids, sims = self._interleave_by_modality(pool_ids, pool_sims, top_k)
            info["candidates"] = cand_total
            info["keys_probed"] = probed_total
            info["balanced"] = True
            info["modalities_present"] = sorted(
                {(self.units.get(u) or {}).get("modality", "text") for u in pool_ids})
        else:
            ids, sims, info = self.index.search(
                code, top_k=top_k, modality_filter=modality_filter,
                exclude_ids=exclude_ids, query_vec=qvec,
            )
        q_themes = F.extract_themes(query) if isinstance(query, str) else []
        hits = [self._to_hit(uid, sim, code, q_themes, modality, qvec)
                for uid, sim in zip(ids, sims)]
        info.update({
            "query_code_hex": _bits_to_hex(code),
            "query_themes": q_themes,
            "query_modality": modality,
            "query_media": bool(media_path),
            "modality_filter": modality_filter,
            "data_source": self._source,
            "dataset": self._corpus_meta.get("dataset_name") or "",
        })
        self.last_search_info = info
        return hits, info

    async def search(self, query: str, modality: str = "text", top_k: int = 5,
                     modality_filter: Optional[str] = None,
                     exclude_ids: Optional[List[str]] = None,
                     media_path: Optional[str] = None) -> List[Dict]:
        hits, _ = await self.search_with_info(
            query, modality=modality, top_k=top_k,
            modality_filter=modality_filter, exclude_ids=exclude_ids,
            media_path=media_path,
        )
        return hits

    def _interleave_by_modality(self, ids: List[str], sims: List[float],
                                top_k: int) -> Tuple[List[str], List[float]]:
        """混合视图按模态轮转交错取结果（各模态内部仍按相似度降序）。

        动机：真实语料下同一模态的码天然更接近同模态查询，纯全局排序会让
        top-k 被查询模态自身占满（实测文本查询 top5 全为文本单元），
        跨模态命中的单元被挤到很后面，前端看不到"跨模态检索"的效果。
        轮转交错保证每个模态都有代表进入结果页，是跨模态检索的可解释呈现方式；
        需要纯相似度排序时把 HASHING_BALANCE_MODALITIES 置 False（或指定
        modality_filter）即可回到全局排序。
        """
        buckets: Dict[str, List[Tuple[float, str]]] = {}
        for uid, sim in zip(ids, sims):
            m = (self.units.get(uid) or {}).get("modality", "text")
            buckets.setdefault(m, []).append((float(sim), uid))
        if len(buckets) < 2:
            return ids[:top_k], sims[:top_k]
        for m in buckets:
            buckets[m].sort(key=lambda x: -x[0])
        # 首个模态按"该模态最高分"排序，保证最相关的模态先出场
        order = sorted(buckets, key=lambda m: -buckets[m][0][0])
        cursor = {m: 0 for m in buckets}
        out_ids, out_sims = [], []
        while len(out_ids) < top_k:
            progressed = False
            for m in order:
                if len(out_ids) >= top_k:
                    break
                i = cursor[m]
                if i < len(buckets[m]):
                    sim, uid = buckets[m][i]
                    cursor[m] = i + 1
                    out_ids.append(uid)
                    out_sims.append(sim)
                    progressed = True
            if not progressed:
                break
        return out_ids, out_sims

    def _media_url(self, path: Optional[str], modality: str) -> Optional[str]:
        """媒体缩略图（内联 data URL）。数据集在仓库外，前端无法直接访问文件路径。

        生成一次后缓存：单张图像 ~5ms / 频谱 ~12ms，若每次检索都重算，
        top-50 的结果页会多花 300ms+。
        """
        if not path or modality not in ("image", "audio"):
            return None
        key = f"{modality}|{path}"
        if key in self._media_cache:
            return self._media_cache[key]
        if len(self._media_cache) >= _MEDIA_CACHE_MAX:
            self._media_cache.clear()
        url = RF.media_data_url(path, modality)
        self._media_cache[key] = url
        return url

    def media_payload(self, unit_id: str) -> Optional[dict]:
        """单元的真实媒体文件（非缩略图），按需取用。

        检索响应只带缩略图：语音平均 124KB，若随结果内联下发，
        每次检索的响应体会膨胀数百 KB。前端在用户点击播放/查看时再单独取。
        """
        meta = self.units.get(unit_id)
        if not meta:
            return None
        path, modality = meta.get("media_path"), meta.get("modality")
        if not path or modality not in ("image", "audio"):
            return None
        key = f"full|{modality}|{path}"
        url = self._media_cache.get(key)
        if url is None:
            url = RF.media_file_data_url(path, modality)
            if url is None:
                return None
            if len(self._media_cache) >= _MEDIA_CACHE_MAX:
                self._media_cache.clear()
            self._media_cache[key] = url
        return {
            "unit_id": unit_id,
            "modality": modality,
            "media_kind": meta.get("media_kind"),
            "media": url,
            "media_meta": meta.get("media_meta"),
        }

    def _to_hit(self, unit_id: str, sim: float, query_code: List[int],
                query_themes: List[str], query_modality: str,
                query_vec: Optional[List[float]] = None) -> Dict:
        meta = self.units.get(unit_id) or {}
        code = meta.get("code") or []
        ham = sum(1 for a, b in zip(query_code, code) if a != b)
        shared = sorted(set(query_themes or []) & set(meta.get("tags") or []))
        asym = None
        if query_vec is not None and code:
            asym = round(self.index.asym_score(query_vec, code), 4)
        modality = meta.get("modality", "text")
        # 展示摘要在此处脱敏（索引内部保留原文用于编码，返回前端时去掉姓名/手机号）
        excerpt = meta.get("excerpt") or F.deidentify(
            meta.get("content") or meta.get("summary") or "", meta.get("deid_terms"))
        return {
            "id": unit_id,
            "record_id": meta.get("record_id") or unit_id,
            "modality": modality,
            "modality_label": MODALITY_LABEL.get(modality, "文本"),
            "similarity": round(float(sim), 4),
            "summary": excerpt,
            "tags": meta.get("tags") or [],
            "alert_level": meta.get("alert_level", "green"),
            "date": meta.get("date", ""),
            "cross_modal": modality != query_modality,
            # 真实媒体缩略图（图像 -> 灰度图；语音 -> 梅尔频谱），供前端直接展示
            "media": self._media_url(meta.get("media_path"), modality),
            "media_kind": meta.get("media_kind"),
            # 媒体真实元数据（文件名 / 来源目录 / 语音的情绪·说话人·发音·时长）
            "media_meta": meta.get("media_meta"),
            "data_source": self._source,
            "dataset": meta.get("dataset") or self._corpus_meta.get("dataset_name") or "",
            "explain": {
                "hamming_distance": ham,
                "hamming_similarity": round(1.0 - ham / max(1, self.code_length), 4),
                "asymmetric_score": asym,
                "code_hex": _bits_to_hex(code),
                "query_code_hex": _bits_to_hex(query_code),
                "window": meta.get("window"),
                "shared_themes": shared,
                "source": self._source,
            },
        }

    async def index_case(self, case_data: Dict) -> bool:
        """增量写入一个案例（动态，异步入口）。"""
        await self._ensure_initialized()
        return self._index_case_impl(case_data)

    def index_case_sync(self, case_data: Dict) -> bool:
        """增量写入（同步入口），供同步的业务 Service / 脚本使用。"""
        try:
            if not self._initialized:
                self._do_initialize()
            return self._index_case_impl(case_data)
        except Exception:
            return False

    def _index_case_impl(self, case_data: Dict) -> bool:
        """索引写入核心实现。case_data 至少含 id/summary，可选 modality / tags /
        alert_level / date；未给 tags 时从 summary 自动抽取主题。"""
        cid = str(case_data.get("id") or case_data.get("case_id")
                  or f"CASE-{len(self.units) + 1}")
        summary = case_data.get("summary") or case_data.get("name") or ""
        tags = case_data.get("tags") or F.extract_themes(summary)
        modality = case_data.get("modality") or "text"
        date = _date_iso(case_data.get("date")) or datetime.date.today().isoformat()
        self._add_unit(cid, {
            "record_id": case_data.get("record_id") or cid,
            "modality": modality, "tags": tags,
            "alert_level": case_data.get("alert_level") or "green",
            "date": date, "content": summary,
            "deid_terms": case_data.get("deid_terms") or [],
        })
        self._source_count = self._source_count + 1
        self._save_state()
        return True

    # ------------------------- 运维 / 展示 -------------------------

    def retrain(self) -> bool:
        """全量重训（数据积累到一定程度后调用，等价于"增量重训"的触发点）。"""
        self._rebuild()
        return self.model.trained

    def rebuild_tables(self) -> List[Dict]:
        """重算时间窗哈希表的质量（σ 信息量 / ρ 语义一致性 / 是否活跃）。"""
        return self.index.evaluate_tables()

    def stats(self) -> Dict:
        tables = self.index.table_stats_list()
        return {
            "source": self._source,
            "units": len(self.units),
            "records": len(self.records),
            "code_length": self.code_length,
            "trained": self.model.trained,
            "modalities": self.index.modality_distribution(),
            "windows": self.index.window_distribution(),
            "tables": tables,
            "num_bands": self.index.num_bands,
            "guaranteed_radius": self.index.guaranteed_radius,
            "guaranteed_similarity": round(1.0 - self.index.guaranteed_radius / max(1, self.code_length), 4),
            "trained_modalities": list((self.model.W or {}).keys()),
        }

    def reset(self):
        """清空状态并重建（开发调试用）。"""
        if os.path.exists(self.state_path):
            os.remove(self.state_path)
        self._rebuild()
        self._save_state()

    # ------------------------- 持久化 -------------------------

    def _feature_dim(self) -> int:
        """当前特征提取器的输出维度（用于校验状态文件是否与特征版本匹配）。"""
        try:
            return len(F.semantic_feature("维度探测"))
        except Exception:
            return 0

    def _save_state(self):
        os.makedirs(settings.HASHING_DATA_DIR, exist_ok=True)
        state = {
            "version": STATE_VERSION,
            "feature_dim": self._feature_dim(),
            "code_length": self.code_length,
            "lambda_s": self.model.lambda_s,
            "modalities": self.model.modalities,
            "W": self.model.W,
            "units": self.units,        # 不含 features（可由 content 重算），控制文件体积
            "records": self.records,    # 记录级信息（主题 / 风险 / 时间窗）
            "source": self._source,
            "source_count": self._source_count,
            "seeded_from_db": self._seeded_from_db,
            # 语料元信息（数据集名称 / 配对规则 / 特征规格）：前端要展示
            # "数据来源"标注，重启后从状态文件恢复，避免显示为空
            "corpus_meta": self._corpus_meta,
        }
        with open(self.state_path, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)

    def _load_state(self):
        with open(self.state_path, "r", encoding="utf-8") as f:
            state = json.load(f)
        if state.get("version") != STATE_VERSION:
            raise ValueError("状态文件版本不兼容，需要重建")
        # 特征维度变化（换特征提取器）会让投影矩阵失配 → 必须重建，
        # 否则编码会静默退化成全零码（所有相似度都相等，检索质量崩掉）。
        if state.get("feature_dim") != self._feature_dim():
            raise ValueError("特征维度已变化，需要重建")
        self.code_length = state["code_length"]
        self.model = OnlineSupervisedCMFH(
            code_length=self.code_length, lambda_s=state.get("lambda_s", 0.6)
        )
        self.model.modalities = state.get("modalities") or []
        self.model.W = state.get("W") or {}
        self.model.trained = True
        self.units = state.get("units") or {}
        self.records = state.get("records") or {}
        self._source = state.get("source", "")
        self._source_count = state.get("source_count", 0)
        self._seeded_from_db = state.get("seeded_from_db", False)
        self._corpus_meta = state.get("corpus_meta") or {}
        self.index = self._new_index()
        for uid, meta in self.units.items():
            self.index.insert(uid, meta.get("code") or [], meta, window=meta.get("window"))