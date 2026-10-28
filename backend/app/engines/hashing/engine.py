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
   文本走 `features.semantic_feature`（bge 512 维 ⊕ 主题 19 维 = 531 维；
   可用 HASHING_TEXT_BACKEND=tf 切回 256 桶 ⊕ 主题的 275 维实现）。
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
import math
import os
import random
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from app.engines.hashing import real_features as RF
from app.engines.hashing.cmfh import OnlineSupervisedCMFH
from app.engines.hashing.demo_data import build_demo_dataset
from app.engines.hashing.interface import HashingEngineInterface
from app.engines.hashing.multi_table_index import MultiTableHashIndex
from app.engines.hashing.store import HashingStore
from app.engines.hashing.window_models import WindowModelBank
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
        HASHING_WINDOW_DAYS = 30
        HASHING_EPOCH = "2025-01-01"
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
        self.window_bank = WindowModelBank(
            code_length=self.code_length,
            lambda_s=float(getattr(settings, "HASHING_LAMBDA_S", 0.6)),
            tau_days=int(getattr(settings, "HASHING_DECAY_TAU_DAYS", 365)),
        )
        self._window_trained: Dict[int, int] = {}
        self.index = self._new_index()
        self.records: Dict[str, Dict] = {}   # record_id -> {tags, alert_level, date, window, views}
        self.units: Dict[str, Dict] = {}     # unit_id -> {record_id, modality, excerpt, tags, code, ...}
        self.state_path = os.path.join(settings.HASHING_DATA_DIR, "hashing_state.json")
        self.index_db_path = os.path.join(settings.HASHING_DATA_DIR, "index.db")
        self._store = HashingStore(self.index_db_path)
        self._init_lock = asyncio.Lock()
        self._train_cap = int(getattr(settings, "HASHING_TRAIN_MAX", 300))
        self._source = ""          # corpus-real | corpus | db | seedfile | demo | store
        self._source_count = 0
        self._seeded_from_db = False
        self._corpus_path = ""     # 当前生效的语料库路径
        self._corpus_meta: Dict[str, str] = {}
        self._media_cache: Dict[str, Optional[str]] = {}
        self._feat_cache: Dict[Tuple, List[float]] = {}
        self._scope_epoch = 0      # 可见性缓存版本，审核变更时递增
        self._visible_cache: Dict[Tuple, set] = {}
        self._weight_cache: Tuple[float, Dict[int, float]] = (0.0, {})
        self._train_lock = threading.Lock()
        self._retrain_thread: Optional[threading.Thread] = None
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
        """加载索引：SQLite 索引库优先，其次迁移旧状态文件，最后按来源冷启动。

        与旧版的关键差别：索引库一旦有数据就以其为准，不再因为语料库条数变化
        而整体重建——否则每次语料更新都会把运行时新增数据冲掉。
        """
        self._store.init_schema()

        loaded = self._load_from_store()
        if not loaded and os.path.exists(self.state_path):
            try:
                migrated = self._store.migrate_state_file(self.state_path)
                if migrated:
                    loaded = self._load_from_store()
            except Exception:
                loaded = False

        if not loaded:
            try:
                self._rebuild()
            except Exception:
                self._rebuild_demo()
                self._persist_all()

        # 模型参数与索引分开存：索引在 SQLite，投影矩阵在 state.json
        if not self._load_model():
            # 投影矩阵缺失或与特征维度不匹配 → 用库内数据重训，而不是清库重播
            self._retrain_in_place()

        self._initialized = True

    def _load_from_store(self) -> bool:
        """把 SQLite 中的单元与记录载入内存索引。"""
        try:
            units = self._store.load_units()
        except Exception:
            return False
        if not units:
            return False
        self.units = units
        self.records = self._store.load_records()
        self.index = self._new_index()
        fixed: List[str] = []
        for uid, meta in units.items():
            code = meta.get("code") or []
            if not code:
                continue
            # 运行时数据的窗口每次按当前口径重算：旧版本用 122 天 / 2025-08-01 起算，
            # 会把 2026 年的新数据算进 2025 年 4 月的窗口，与历史数据混表。
            if (meta.get("source") or "") == "runtime":
                expect = self.index.window_of(meta.get("date"))
                if expect != meta.get("window"):
                    meta["window"] = expect
                    rec = self.records.get(meta.get("record_id") or "")
                    if rec is not None:
                        rec["window"] = expect
                    fixed.append(uid)
            self.index.insert(uid, code, meta, window=meta.get("window"))
        if fixed:
            try:
                self._store.upsert_units({u: self.units[u] for u in fixed})
                self._store.upsert_records({self.units[u].get("record_id"): 
                                            self.records[self.units[u].get("record_id")]
                                            for u in fixed
                                            if self.units[u].get("record_id") in self.records})
            except Exception:
                pass
        self._source = self._store.meta_get("source") or "store"
        self._source_count = int(self._store.meta_get("source_count") or len(units))
        raw_meta = self._store.meta_get("corpus_meta")
        if raw_meta:
            try:
                self._corpus_meta = json.loads(raw_meta)
            except Exception:
                self._corpus_meta = {}
        self._scope_epoch += 1
        return True

    def _allowed_ids(self, viewer: Optional[Dict]) -> Optional[set]:
        """按调用者身份算出可见单元集合。

        admin      全部（含待审与已拒，用于审核与排障）
        user       公共池 + 本人数据（本人数据无论审核状态都可自查）
        viewer 为 None 或 "all" 时不过滤，供内部评测与离线脚本使用。
        """
        if viewer is None or viewer == "all":
            return None
        role = (viewer or {}).get("role") or "user"
        uid = (viewer or {}).get("user_id")
        key = (role, uid, self._scope_epoch)
        cached = self._visible_cache.get(key)
        if cached is not None:
            return cached
        if role == "admin":
            ids = set(self.units.keys())
        else:
            ids = set()
            for unit_id, meta in self.units.items():
                scope = meta.get("scope") or "public"
                if scope == "public" or (uid is not None and meta.get("user_id") == uid):
                    ids.add(unit_id)
        # 只保留最新一份，避免长时间运行缓存膨胀
        self._visible_cache = {key: ids}
        return ids

    def _persist_all(self) -> None:
        """整库落盘（冷启动播种 / 重建后调用）。"""
        try:
            self._store.upsert_units(self.units)
            self._store.upsert_records(self.records)
            self._store.meta_set("source", self._source)
            self._store.meta_set("source_count", str(self._source_count))
            self._store.meta_set("corpus_meta", json.dumps(self._corpus_meta, ensure_ascii=False))
            self._store.meta_set("window_epoch", str(getattr(settings, "HASHING_EPOCH", "")))
            self._store.meta_set("window_days", str(getattr(settings, "HASHING_WINDOW_DAYS", "")))
        except Exception:
            pass

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
                    self._persist_all()
                    self._save_state()
                    return

        rows = self._collect_db_rows()
        if rows and self._seed_from_rows(rows):
            self._source = "db"
            self._source_count = self._count_db_rows()
            self._seeded_from_db = True
            self._persist_all()
            self._save_state()
            return

        seed_db = getattr(settings, "RETRIEVAL_SEED_DB", "")
        if seed_db and os.path.exists(seed_db):
            rows = self._collect_rows_from_file(seed_db)
            if rows and self._seed_from_rows(rows):
                self._source = "seedfile"
                self._source_count = len(rows)
                self._seeded_from_db = True
                self._persist_all()
                self._save_state()
                return

        self._rebuild_demo()
        self._persist_all()
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
        # CMFH 的特征分解要求样本数不少于码长，演示集只有 24 条。
        # 样本不足时按样本数缩短码长，否则 symmetric_eig_largest 会越界。
        if len(cases) < self.code_length:
            self.code_length = max(8, len(cases))
            self.model = OnlineSupervisedCMFH(
                code_length=self.code_length, lambda_s=settings.HASHING_LAMBDA_S)
            self.window_bank = WindowModelBank(
                code_length=self.code_length,
                lambda_s=float(getattr(settings, "HASHING_LAMBDA_S", 0.6)),
                tau_days=int(getattr(settings, "HASHING_DECAY_TAU_DAYS", 365)),
            )
            self.index = self._new_index()
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
            key = ("image", media_path)
            if key in self._feat_cache:
                return {"image": self._feat_cache[key]}
            f = RF.image_feature(media_path)
            if f:
                self._remember_feature(key, f)
                return {"image": f}
        if modality == "audio" and media_path:
            key = ("audio", media_path)
            if key in self._feat_cache:
                return {"audio": self._feat_cache[key]}
            f = RF.audio_feature(media_path)
            if f:
                self._remember_feature(key, f)
                return {"audio": f}
        return {"text": F.semantic_feature(text)}

    def _remember_feature(self, key, vec) -> None:
        """媒体特征缓存：训练与重编码会反复用到同一批图像/语音。

        不缓存的话，每次重训 + 重编码都要重新解码全部媒体文件，
        5000 个单元的窗口重编码会从秒级退化到分钟级。
        """
        if len(self._feat_cache) >= 8000:
            self._feat_cache.clear()
        self._feat_cache[key] = vec

    def _feature_vec(self, modality: str, text: str,
                     media_path: Optional[str] = None,
                     feature: Optional[List[float]] = None) -> List[float]:
        """取单模态特征向量（训练时按模态列对齐用）。

        feature 为索引库里存的已抽取特征：命中则直接复用，
        避免每次重训都把几千个图像/语音文件重新解码一遍。
        """
        if feature and modality in ("image", "audio"):
            return list(feature)
        return list(self._feature_of(modality, text, media_path).values())[0]

    def _view_text(self, view: Any) -> str:
        """视图兼容取值：新结构是 {text, path}，旧结构是纯字符串。"""
        if isinstance(view, dict):
            return view.get("text") or ""
        return view if isinstance(view, str) else str(view or "")

    def _view_path(self, view: Any) -> Optional[str]:
        return view.get("path") if isinstance(view, dict) else None

    # ------------------------- 训练 -------------------------

    def _prepare_training(self, records: List[Dict]):
        """把配对记录整理成 (feature_by_modality, similarity)，供单窗口训练复用。"""
        recs = [r for r in records if r.get("views")]
        if not recs:
            return None
        # 不同数据集的记录可能带不同的模态集合（例如纯图像记录与「文本+语音」记录混合）。
        # 若直接取全局交集会得到空集并静默退化为「纯文本」，导致图像/语音编码器根本没被训练
        # （表现为图像/语音检索指标全 0）。这里改为取「模态集合相同的最大分组」做配对训练：
        # 同组内模态严格对齐，跨组不影响；只有单模态可用时才退回纯文本兜底。
        groups: Dict[frozenset, List[Dict]] = {}
        for r in recs:
            sig = frozenset(m for m in r["views"] if m in TRAIN_MODALITIES)
            groups.setdefault(sig, []).append(r)
        best_sig = max(groups, key=lambda s: (len(s), len(groups[s])))
        if len(best_sig) >= 2:
            recs = groups[best_sig]
            mods = [m for m in TRAIN_MODALITIES if m in best_sig]
        else:
            mods = ["text"]
            recs = [{"record_id": r["record_id"],
                     "views": {"text": self._view_text(list(r["views"].values())[0])},
                     "tags": r.get("tags")} for r in recs]

        feats: Dict[str, List[List[float]]] = {}
        for m in mods:
            vecs = [self._feature_vec(m, self._view_text(r["views"][m]),
                                      self._view_path(r["views"][m]),
                                      (r["views"][m] or {}).get("feature")
                                      if isinstance(r["views"][m], dict) else None)
                    for r in recs]
            # 同一模态内维度必须一致，否则 Gram 矩阵无法构造。
            # 个别媒体抽取失败会退回文本特征（维度不同）→ 该模态整体不参与配对训练，
            # 而不是静默算出错误结果。语料由 build_real_corpus.py 预抽取并校验，
            # 正常情况不会触发这条分支。
            if len({len(v) for v in vecs}) != 1:
                continue
            feats[m] = vecs
        if not feats:
            return None

        sim = [[_jaccard(recs[i].get("tags"), recs[j].get("tags")) for j in range(len(recs))]
               for i in range(len(recs))]
        for i in range(len(recs)):
            sim[i][i] = 1.0
        return feats, sim

    def _balance_supervision(self, records: List[Dict]) -> List[Dict]:
        """可选的监督比例采样，默认关闭。

        项目书的"有标签样本占 70%"是实验设置，描述批次构成，不是训练约束。
        默认不裁剪：无标签样本照样参与重构，模型才能见过新数据的分布。
        需要复现实验口径时把 HASHING_LABELED_RATIO 设成 0.7 再跑。
        """
        ratio = float(getattr(settings, "HASHING_LABELED_RATIO", 0) or 0)
        if ratio <= 0 or ratio >= 1:
            return records
        labeled = [r for r in records if r.get("tags")]
        unlabeled = [r for r in records if not r.get("tags")]
        if not labeled or not unlabeled:
            return records
        allowed = int(len(labeled) * (1 - ratio) / ratio)
        if len(unlabeled) <= allowed:
            return records
        keep = random.sample(unlabeled, min(allowed, len(unlabeled)))
        return labeled + keep

    def _train(self, records: List[Dict]) -> bool:
        """在「配对记录」上训练全局 CMFH（无窗口模型时的兜底编码器）。

        records: [{record_id, views: {modality: text | {text, path}}, tags: [...]}]
        三个模态视图按记录行对齐，共享同一码矩阵 B —— 这是跨模态对齐的来源。
        """
        prepared = self._prepare_training(self._balance_supervision(records))
        if not prepared:
            return False
        feats, sim = prepared
        self.model.fit(feats, sim)
        return True

    def _error_samples(self, window: int, records: List[Dict],
                       top_k: int = 3, threshold: float = 0.3) -> List[int]:
        """挑出映射冲突样本：近邻主题与自身明显不一致的记录。

        对应项目书 4.7.2 的"错误哈希样本校正"。增量训练时把这些样本
        重复纳入，让新表优先纠正它们，而不是只拟合新到数据。
        """
        model = (self.window_bank.get(window) or self.window_bank.nearest(window)
                 or self.model)
        if model is None or not getattr(model, "trained", False):
            return []
        codes: List[Optional[List[int]]] = []
        for r in records:
            view = r["views"].get("text")
            if not view:
                codes.append(None)
                continue
            try:
                codes.append(model.encode({"text": F.semantic_feature(self._view_text(view))}))
            except Exception:
                codes.append(None)
        bad: List[int] = []
        n = len(records)
        for i in range(n):
            # 无标签样本不参与判定：它没有"正确答案"，不能算映射冲突。
            # 之前的实现把 Jaccard 恒为 0 的无标签样本全部判成错误样本，
            # 等于给噪声加权（实测小窗口三条无标签记录全中）。
            if codes[i] is None or not records[i].get("tags"):
                continue
            dists = []
            for j in range(n):
                if i == j or codes[j] is None:
                    continue
                # 近邻也必须带标签，否则"主题不一致"只是没标签的假象
                if not records[j].get("tags"):
                    continue
                d = sum(1 for a, b in zip(codes[i], codes[j]) if a != b)
                dists.append((d, j))
            if not dists:
                continue
            dists.sort(key=lambda x: x[0])
            neigh = [j for _, j in dists[:top_k]]
            sim = sum(_jaccard(records[i].get("tags"), records[j].get("tags"))
                      for j in neigh) / len(neigh)
            if sim < threshold:
                bad.append(i)
        return bad

    def _train_window(self, window: int, records: List[Dict]) -> bool:
        """为单个时间窗训练独立模型（项目书的「基于不同时间子集训练的哈希表」）。"""
        if self.window_bank.code_length != self.code_length:
            self.window_bank = WindowModelBank(
                code_length=self.code_length,
                lambda_s=float(getattr(settings, "HASHING_LAMBDA_S", 0.6)),
                tau_days=int(getattr(settings, "HASHING_DECAY_TAU_DAYS", 365)),
            )
        if len(records) < self.code_length:
            return False
        records = self._balance_supervision(records)
        if getattr(settings, "HASHING_ERROR_CORRECTION", True) and len(records) >= 30:
            try:
                bad = self._error_samples(window, records)
                if bad:
                    # 冲突样本重复两遍，最多占训练集的 30%，避免挤掉正常样本
                    cap = max(1, int(len(records) * 0.3))
                    extra = [records[i] for i in bad[:cap]]
                    records = list(records) + extra + extra
            except Exception:
                pass
        prepared = self._prepare_training(records)
        if not prepared:
            return False
        feats, sim = prepared
        ok = self.window_bank.fit(window, feats, sim, n_samples=len(sim))
        if ok:
            self._window_trained[window] = len(sim)
        return ok

    def _encoder_for(self, window: Optional[int]):
        """取某窗口的编码器：优先窗口模型，其次最近窗口模型，最后全局兜底。"""
        if window is not None:
            model = self.window_bank.model_for(int(window))
            if model is not None:
                return model
        return self.model

    def _add_unit(self, unit_id: str, meta: Dict) -> None:
        """编码并入索引（单元 = 记录在某模态下的视图），同时登记记录级信息。

        编码器按窗口选取：单元属于哪个时间窗，就用该窗训练的模型编码。
        窗口尚无模型时借用最近窗口的模型，避免新数据落到未训练的空间里。
        """
        modality = meta.get("modality", "text")
        content = meta.get("content") or meta.get("summary") or ""
        window = meta.get("window")
        if window is None:
            window = self.index.window_of(meta.get("date"))
        encoder = self._encoder_for(window)
        feature = meta.get("feature")
        if feature and encoder.W.get(modality) and len(feature) == len(encoder.W[modality][0]):
            # 语料预抽取的离线特征：直接用，省去重复解码媒体
            feat = {modality: feature}
        else:
            feat = self._feature_of(modality, content, meta.get("media_path"))
        code = encoder.encode(feat)
        meta = dict(meta)
        meta["code"] = list(code)
        # 媒体特征随单元落库：重训与重编码直接复用，不必重新解码图像/语音。
        # 文本特征重算只要零点几毫秒，不占存储。
        if modality in ("image", "audio"):
            if not meta.get("feature"):
                vec = feat.get(modality)
                if vec:
                    meta["feature"] = list(vec)
        else:
            meta.pop("feature", None)
        # 时间窗只算一次并写回单元：否则重启后重复推算，且 units 里 window 为空
        meta["window"] = window
        meta.setdefault("scope", "public")          # 语料与业务播种默认公共池
        meta.setdefault("source", "corpus" if self._source.startswith("corpus") else "runtime")
        self.units[unit_id] = meta
        rid = meta.get("record_id")
        if rid and rid not in self.records:
            self.records[rid] = {
                "record_id": rid, "tags": meta.get("tags") or [],
                "alert_level": meta.get("alert_level", "green"),
                "date": meta.get("date", ""), "window": meta.get("window"),
                "scope": meta.get("scope"), "source": meta.get("source"),
                "user_id": meta.get("user_id"),
            }
        elif rid and rid in self.records:
            # 同一记录的多模态视图可能带不同标签，补齐记录级字段
            rec = self.records[rid]
            if rec.get("window") is None:
                rec["window"] = meta.get("window")
            if meta.get("user_id") is not None:
                rec["user_id"] = meta.get("user_id")
            if meta.get("scope") and rec.get("scope") in (None, "", "reviewing"):
                rec["scope"] = meta.get("scope")
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

        def _train_record(rid: str) -> Optional[Dict]:
            views = {}
            for m, v in by_rec[rid].items():
                if m in TRAIN_MODALITIES:
                    views[m] = {"text": v.get("content") or "",
                                "path": v.get("media_path"),
                                "feature": _loads(v.get("feature"), None)}
            if not views:
                return None
            any_unit = next(iter(by_rec[rid].values()))
            return {"record_id": rid, "views": views,
                    "tags": _loads(any_unit.get("themes"))}

        # 全局兜底模型（窗口模型缺失时使用）
        sample_ids = (rec_ids if len(rec_ids) <= self._train_cap
                      else random.sample(rec_ids, self._train_cap))
        train_records = [r for r in (_train_record(rid) for rid in sample_ids) if r]
        if not self._train(train_records):
            return False

        # 分窗口训练：每个时间窗一套投影矩阵（窗口即模型分区）
        per_window: Dict[int, List[str]] = {}
        for rid in rec_ids:
            w = next(iter(by_rec[rid].values())).get("window")
            per_window.setdefault(int(w or 0), []).append(rid)
        cap = int(getattr(settings, "HASHING_WINDOW_TRAIN_MAX", 150))
        for w, ids in sorted(per_window.items()):
            pick = ids if len(ids) <= cap else random.sample(ids, cap)
            recs = [r for r in (_train_record(rid) for rid in pick) if r]
            if len(recs) >= 8:
                self._train_window(w, recs)

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

    def _window_weights(self) -> Dict[int, float]:
        """各时间窗表的融合权重（rho × sigma × 时效衰减）。

        评估有成本（每个窗口做近邻一致性抽样），30 秒内复用同一份结果。
        """
        now = time.time()
        if self._weight_cache and (now - self._weight_cache[0]) < 30:
            return self._weight_cache[1]
        try:
            stats = {s["window"]: s for s in self.index.evaluate_tables()}
        except Exception:
            return {}
        try:
            epoch = datetime.date.fromisoformat(str(getattr(settings, "HASHING_EPOCH", "2025-01-01")))
        except Exception:
            epoch = datetime.date(2025, 1, 1)
        days = int(getattr(settings, "HASHING_WINDOW_DAYS", 30))
        dual = bool(getattr(settings, "HASHING_DUAL_METRIC_WEIGHT", True))
        out: Dict[int, float] = {}
        for w, s in stats.items():
            rho = s.get("rho") or 0.0
            sigma = s.get("sigma") or 0.0
            if dual and not s.get("cold_start"):
                # 双指标：语义-汉明一致性（交叉熵的补） + 与全局模型的正交程度
                ce_score = min(1.0, rho / 0.4)
                redundancy = self._model_redundancy(int(w))
                quality = 0.55 * ce_score + 0.25 * (1.0 - redundancy) + 0.20 * min(1.0, sigma / 0.3)
                w_base = self.window_bank.weight_from_quality(
                    int(w), quality, epoch, days, cold_start=False)
            else:
                w_base = self.window_bank.weight(
                    int(w), rho, sigma, epoch, days,
                    cold_start=bool(s.get("cold_start")),
                )
            # 标签覆盖率折价：全无标签的窗口只保留下限权重
            floor = float(getattr(settings, "HASHING_LABEL_COVERAGE_FLOOR", 0.55))
            coverage = self._label_coverage(int(w))
            out[int(w)] = round(w_base * (floor + (1.0 - floor) * coverage), 6)
        self._weight_cache = (now, out)
        return out

    def _label_coverage(self, window: int) -> float:
        """该窗口记录中有主题标签的比例。

        无标签窗口训出来的模型只保留特征层面的相似，主题语义弱，
        融合时应按覆盖率打折，而不是和有监督的窗口同权。
        """
        total = labeled = 0
        for rec in self.records.values():
            if int(rec.get("window") or 0) != int(window):
                continue
            total += 1
            if rec.get("tags"):
                labeled += 1
        return (labeled / total) if total else 1.0

    def _model_redundancy(self, window: int) -> float:
        """该窗口模型与全局模型的平均余弦相似度，越低说明信息越独立。

        对应项目书 4.7.3 的双指标之一：余弦距离衡量不同模态哈希函数间的
        正交程度，用于判断表间信息重叠，重叠高的表降低权重。
        """
        model = self.window_bank.get(window)
        if model is None or not model.W or not self.model.W:
            return 0.5
        scores: List[float] = []
        for key in set(model.W) & set(self.model.W):
            rows_a, rows_b = model.W[key], self.model.W[key]
            for ra, rb in zip(rows_a, rows_b):
                na = math.sqrt(sum(x * x for x in ra))
                nb = math.sqrt(sum(x * x for x in rb))
                if not na or not nb:
                    continue
                scores.append(abs(sum(x * y for x, y in zip(ra, rb)) / (na * nb)))
        if not scores:
            return 0.5
        return sum(scores) / len(scores)

    def _multi_window_search(self, feat, top_k: int, modality_filter: Optional[str],
                             exclude_ids: Optional[List[str]], allowed: Optional[set],
                             balance: bool):
        """多窗口检索：每个窗口用自己的模型编码查询、各自召回，再按表权重融合。

        同一单元只属于一个时间窗，理论上不会重复命中；仍保留去重，
        以便窗口模型调整后出现跨窗口重叠时不会返回两条。
        """
        windows = self.index._active_windows()
        weights = self._window_weights()
        scored: List[Dict] = []
        cand_total = 0
        keys_total = 0
        for w in windows:
            encoder = self._encoder_for(w)
            code = encoder.encode(feat)
            qvec = encoder.encode_continuous(feat)
            ids, sims, winfo = self.index.search(
                code, top_k=max(int(top_k) * 4, 40), modality_filter=modality_filter,
                exclude_ids=exclude_ids, windows=[w], query_vec=qvec,
                allowed_ids=allowed,
            )
            cand_total += winfo.get("candidates") or 0
            keys_total += winfo.get("keys_probed") or 0
            weight = weights.get(int(w), 0.5)
            # 查询自适应重排序：同一张表对不同查询的表征能力不同。
            # 用该窗口首位命中的相似度作为适配度，对权重做 ±25% 的微调，
            # 避免固定权重把"这张表明显不适合当前查询"的结果仍按原权重计入。
            adaptive = 1.0
            if getattr(settings, "HASHING_QUERY_ADAPTIVE", True) and sims:
                affinity = max(0.0, min(1.0, float(sims[0])))
                adaptive = 0.75 + 0.5 * max(0.0, affinity - 0.5)
                weight = weight * adaptive
            for uid, sim in zip(ids, sims):
                scored.append({"uid": uid, "sim": float(sim),
                               "rank": float(sim) * weight,
                               "code": code, "qvec": qvec, "window": int(w),
                               "weight": weight, "adaptive": round(adaptive, 4)})
        best: Dict[str, Dict] = {}
        for item in scored:
            cur = best.get(item["uid"])
            if cur is None or item["rank"] > cur["rank"]:
                best[item["uid"]] = item
        items = sorted(best.values(), key=lambda x: -x["rank"])
        items = self._interleave_scored(items, top_k) if balance else items[: int(top_k)]
        info = {
            "candidates": cand_total,
            "scanned_all": False,
            "keys_probed": keys_total,
            "probed_windows": sorted(int(w) for w in windows),
            "index_size": len(self.index.records),
            "scoring": "multi-window",
            "balanced": bool(balance),
            "query_adaptive": bool(getattr(settings, "HASHING_QUERY_ADAPTIVE", True)),
            "window_weights": {str(k): round(v, 4) for k, v in sorted(weights.items())},
        }
        return items, info

    def _interleave_scored(self, items: List[Dict], top_k: int) -> List[Dict]:
        """按模态轮转交错（保持各模态内部按融合分降序）。"""
        buckets: Dict[str, List[Dict]] = {}
        for it in items:
            m = (self.units.get(it["uid"]) or {}).get("modality", "text")
            buckets.setdefault(m, []).append(it)
        if len(buckets) < 2:
            return items[: int(top_k)]
        order = sorted(buckets, key=lambda m: -buckets[m][0]["rank"])
        cursor = {m: 0 for m in buckets}
        out: List[Dict] = []
        while len(out) < int(top_k):
            progressed = False
            for m in order:
                if len(out) >= int(top_k):
                    break
                i = cursor[m]
                if i < len(buckets[m]):
                    out.append(buckets[m][i])
                    cursor[m] = i + 1
                    progressed = True
            if not progressed:
                break
        return out

    async def search_with_info(
        self, query: str, modality: str = "text", top_k: int = 5,
        modality_filter: Optional[str] = None, exclude_ids: Optional[List[str]] = None,
        media_path: Optional[str] = None, viewer: Optional[Dict] = None,
    ) -> Tuple[List[Dict], Dict]:
        """检索并返回 (结果列表, 检索过程信息)。

        media_path 供图像/语音查询使用：特征取自媒体文件，
        `query` 仍是该次查询的文字描述（用于抽取主题、展示"为什么相似"）。
        viewer 为调用者身份 {"user_id": int, "role": "admin"|"user"}：
        传 None 表示内部调用 / 评测，不做可见性过滤。
        """
        await self._ensure_initialized()
        allowed = self._allowed_ids(viewer)
        feat = self._extract_query_features(query, modality, media_path)
        # 混合视图（未指定结果模态）默认按模态轮转交错：
        # 真实语料下同模态码更相近，全局排序的前若干名会被查询模态占满
        # （实测文本查询 top-24 全为文本单元），跨模态命中根本进不了结果页。
        # 因此这里对每个模态各取 top_k 再轮转合并，保证跨模态结果可见。
        balance = (bool(getattr(settings, "HASHING_BALANCE_MODALITIES", True))
                   and not modality_filter and len(self.units) > top_k)

        if self.window_bank.models and len(self.index._active_windows()) > 1:
            # 多窗口路径：每个时间窗用各自的模型编码查询，按表权重融合排序
            items, info = self._multi_window_search(
                feat, top_k, modality_filter, exclude_ids, allowed, balance)
            ids = [it["uid"] for it in items]
            sims = [it["sim"] for it in items]
            codes = [it["code"] for it in items]
            qvecs = [it["qvec"] for it in items]
            code = codes[0] if codes else self.model.encode(feat)
            qvec = qvecs[0] if qvecs else self.model.encode_continuous(feat)
            window_items = items
        else:
            window_items = None
            code = self.model.encode(feat)
            qvec = self.model.encode_continuous(feat)
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
                        allowed_ids=allowed,
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
                    allowed_ids=allowed,
                )
            codes = [code] * len(ids)
            qvecs = [qvec] * len(ids)
        q_themes = F.extract_themes(query) if isinstance(query, str) else []
        hits = [self._to_hit(uid, sim, c, q_themes, modality, qv)
                for uid, sim, c, qv in zip(ids, sims, codes, qvecs)]
        if window_items:
            # 融合排序的中间量一并返回，便于前端解释"为什么这条排在前面"
            for hit, it in zip(hits, window_items):
                hit["explain"]["table_weight"] = round(float(it.get("weight") or 0), 4)
                hit["explain"]["rank_score"] = round(float(it.get("rank") or 0), 4)
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
                     media_path: Optional[str] = None,
                     viewer: Optional[Dict] = None) -> List[Dict]:
        hits, _ = await self.search_with_info(
            query, modality=modality, top_k=top_k,
            modality_filter=modality_filter, exclude_ids=exclude_ids,
            media_path=media_path, viewer=viewer,
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
        alert_level / date / scope / user_id。未给 tags 时从 summary 自动抽取主题。

        新数据默认 scope=reviewing（待审）：本人可检索，不进公共池，也不进训练池。
        审核通过后由 review service 改为 public 并入训练队列。
        """
        cid = str(case_data.get("id") or case_data.get("case_id")
                  or f"CASE-{len(self.units) + 1}")
        summary = case_data.get("summary") or case_data.get("name") or ""
        tags = case_data.get("tags") or F.extract_themes(summary)
        modality = case_data.get("modality") or "text"
        date = _date_iso(case_data.get("date")) or datetime.date.today().isoformat()
        scope = case_data.get("scope") or "reviewing"
        self._add_unit(cid, {
            "record_id": case_data.get("record_id") or cid,
            "modality": modality, "tags": tags,
            "alert_level": case_data.get("alert_level") or "green",
            "date": date, "content": summary,
            "deid_terms": case_data.get("deid_terms") or [],
            "scope": scope,
            "source": case_data.get("source") or "runtime",
            "user_id": case_data.get("user_id"),
        })
        # 只落这一条，不重写整库
        try:
            self._store.upsert_unit(cid, self.units[cid])
            rid = self.units[cid].get("record_id")
            if rid and rid in self.records:
                self._store.upsert_record(rid, self.records[rid])
            self._source_count = max(self._source_count, len(self.units))
            self._store.meta_set("source_count", str(self._source_count))
        except Exception:
            pass
        self._scope_epoch += 1
        return True

    # ------------------------- 运维 / 展示 -------------------------

    def retrain(self) -> bool:
        """用库内现有数据重训投影矩阵，不重建索引、不丢增量。

        旧实现走 `_rebuild()`，会从语料库重新播种，把运行时新增数据全部冲掉。
        """
        return self._retrain_in_place()

    def _window_records(self, window: int) -> List[Dict]:
        """取某窗口的全部配对记录（用于该窗口的独立训练）。"""
        by_rec: Dict[str, Dict[str, Dict]] = {}
        for _uid, meta in self.units.items():
            if int(meta.get("window") or 0) != int(window):
                continue
            rid = meta.get("record_id")
            if rid:
                by_rec.setdefault(rid, {})[meta.get("modality") or "text"] = meta
        out = []
        for rid, views in by_rec.items():
            rec_views = {m: {"text": v.get("content") or "", "path": v.get("media_path"),
                             "feature": v.get("feature")}
                         for m, v in views.items() if m in TRAIN_MODALITIES}
            if not rec_views:
                continue
            any_meta = next(iter(views.values()))
            out.append({"record_id": rid, "views": rec_views,
                        "tags": any_meta.get("tags") or []})
        return out

    def _donor_records(self, window: int, limit: int = 120) -> List[Dict]:
        """借邻近窗口的数据做冷启动训练。

        按窗口号接近程度依次累积，不要求单个窗口自身够 8 条——
        小数据集（如演示集）每个窗口只有几条，按单窗判断会永远借不到。
        """
        others = sorted({int(m.get("window") or 0) for m in self.units.values()}
                        - {int(window)}, key=lambda w: abs(w - int(window)))
        out: List[Dict] = []
        for w in others:
            out.extend(self._window_records(w))
            if len(out) >= limit:
                break
        return out[:limit] if len(out) >= 8 else []

    def _reencode_window(self, window: int) -> int:
        """用该窗口当前模型重编码其全部单元，返回重编码数量。"""
        model = self.window_bank.get(window)
        if model is None:
            return 0
        # 先算码、再整体重建索引：避免边删边插时检索线程读到半个索引
        new_codes: Dict[str, List[int]] = {}
        changed: Dict[str, Dict] = {}
        for uid, meta in self.units.items():
            if int(meta.get("window") or 0) != int(window):
                continue
            mod = meta.get("modality") or "text"
            if meta.get("feature") and mod in ("image", "audio"):
                feat = {mod: meta["feature"]}
            else:
                feat = self._feature_of(mod, meta.get("content") or "",
                                        meta.get("media_path"))
            code = list(model.encode(feat))
            meta["code"] = code
            new_codes[uid] = code
            changed[uid] = meta
        if not new_codes:
            return 0
        rebuilt = self._new_index()
        for uid, meta in self.units.items():
            rebuilt.insert(uid, meta.get("code") or [], meta, window=meta.get("window"))
        self.index = rebuilt
        self._store.upsert_units(changed)
        return len(changed)

    def retrain_pending(self, max_tables: Optional[int] = None) -> Dict:
        """消费训练队列：只重训有新样本的窗口，其余窗口不动。

        对应项目书的「增量重训」：新批次到达 → 该窗口重训 → 淘汰权重最低的表，
        而不是整库重构。
        """
        pending = self._store.pending_training()
        version = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
        result = {"version": version, "pending": len(pending),
                  "retrained": [], "skipped": [], "dropped": []}
        if not pending:
            return result

        by_window: Dict[int, List[Dict]] = {}
        for row in pending:
            wid = row.get("window")
            if wid is None:
                rec = self.records.get(row.get("record_id") or "") or {}
                wid = rec.get("window")
            if wid is None:
                result["skipped"].append({"record_id": row.get("record_id"),
                                          "reason": "无法确定所属时间窗"})
                continue
            by_window.setdefault(int(wid), []).append(row)

        for window, rows in sorted(by_window.items()):
            recs = self._window_records(window)
            cold_start = False
            if len(recs) < 8:
                # 冷启动：新窗口自己的样本太少，借最近窗口的数据一起训，
                # 否则这批审核通过的记录永远排不进训练、队列只涨不消化。
                donor = self._donor_records(window)
                if donor:
                    recs = donor + recs
                    cold_start = True
            if len(recs) < 8:
                result["skipped"].append({"window": window,
                                          "reason": f"样本不足（{len(recs)} 条，且无可借窗口）"})
                continue
            cap = int(getattr(settings, "HASHING_WINDOW_TRAIN_MAX", 150))
            pick = recs if len(recs) <= cap else random.sample(recs, cap)
            if not self._train_window(window, pick):
                result["skipped"].append({"window": window, "reason": "训练失败"})
                continue
            n = self._reencode_window(window)
            self._store.mark_consumed([r["id"] for r in rows], version)
            self._store.save_train_run(
                version=version,
                started_at=version, finished_at=datetime.datetime.now().isoformat(timespec="seconds"),
                windows=[window], n_samples=len(pick),
                note=f"incremental; reencoded={n}")
            result["retrained"].append({"window": window, "samples": len(pick),
                                        "reencoded": n, "cold_start": cold_start})

        # 活跃表超限时淘汰权重最低者。
        # 注意：淘汰模型会让该窗口的存量码失去对应编码器（查询走最近窗口模型，
        # 与库内码不同源），因此默认关闭；开启前必须先做数据迁移。
        weights = self._window_weights()
        limit = int(max_tables if max_tables is not None
                    else getattr(settings, "HASHING_MAX_TABLES", 0))
        if limit > 0:
            dropped = self.window_bank.prune(limit, weights)
            for w in dropped:
                self._store.delete_table_meta(w)
                result["dropped"].append(w)

        self._weight_cache = (0.0, {})
        self._save_state()
        return result

    def schedule_retrain(self) -> bool:
        """后台线程消费训练队列，避免阻塞审核请求。

        同一时刻只允许一个重训任务；重训期间检索照常可用，
        索引在重编码完成后一次性替换。
        """
        if self._retrain_thread and self._retrain_thread.is_alive():
            return False
        t = threading.Thread(target=self._retrain_bg, name="hashing-retrain", daemon=True)
        self._retrain_thread = t
        t.start()
        return True

    def _retrain_bg(self) -> None:
        with self._train_lock:
            try:
                self.retrain_pending()
            except Exception:
                pass

    def retrain_status(self) -> Dict:
        return {
            "running": bool(self._retrain_thread and self._retrain_thread.is_alive()),
            "pending": self._store.pending_count(),
            "last_version": self._store.last_train_version(),
            "windows": len(self.window_bank.models),
        }

    def drift_report(self, window: Optional[int] = None) -> Dict:
        """漂移检测：主题分布偏移、新词 OOV 率、近邻一致性下降。

        三个信号分别对应数据分布、词汇表覆盖、编码质量三个层面。
        任一越阈即可触发重训，不做定期无条件重训。
        """
        stats = {s["window"]: s for s in self.index.evaluate_tables()}
        windows = sorted(stats.keys())
        if not windows:
            return {"drift": False, "reason": "索引为空"}
        target = int(window) if window is not None else windows[-1]
        history = [w for w in windows if w != target]
        if not history:
            return {"drift": False, "reason": "只有一个时间窗", "window": target}

        def _theme_dist(wids: List[int]) -> Dict[str, float]:
            counts: Dict[str, int] = {}
            total = 0
            for meta in self.units.values():
                if int(meta.get("window") or 0) not in wids:
                    continue
                for t in (meta.get("tags") or []):
                    counts[t] = counts.get(t, 0) + 1
                total += 1
            if not total:
                return {}
            return {k: v / total for k, v in counts.items()}

        cur = _theme_dist([target])
        ref = _theme_dist(history)
        kl = 0.0
        for k, p in cur.items():
            q = ref.get(k, 1e-6)
            if p > 0:
                kl += p * math.log(p / q)
        theme_drift = round(max(0.0, kl), 4)

        # OOV：新窗口文本中未命中主题词典的字符占比
        oov_total = oov_hit = 0
        for meta in self.units.values():
            if int(meta.get("window") or 0) != target:
                continue
            text = meta.get("content") or ""
            if not text:
                continue
            oov_total += len(text)
            covered = sum(1 for kw in F.THEME_KEYWORDS.values() for k in kw if k in text)
            oov_hit += min(len(text), covered * 2)
        oov_rate = round(1.0 - (oov_hit / oov_total), 4) if oov_total else 0.0

        rho_now = (stats.get(target) or {}).get("rho") or 0.0
        rho_ref = sum((stats.get(w) or {}).get("rho") or 0.0 for w in history) / max(1, len(history))
        rho_drop = round(max(0.0, rho_ref - rho_now), 4)

        flags = {
            "theme_kl": theme_drift >= 0.5,
            "oov": oov_rate >= 0.6,
            "rho": rho_drop >= 0.1,
        }
        return {
            "window": target,
            "theme_kl": theme_drift,
            "oov_rate": oov_rate,
            "rho_now": round(rho_now, 4),
            "rho_ref": round(rho_ref, 4),
            "rho_drop": rho_drop,
            "flags": flags,
            "drift": any(flags.values()),
        }

    def rebuild_tables(self) -> List[Dict]:
        """重算时间窗哈希表的质量（σ 信息量 / ρ 语义一致性 / 是否活跃）。"""
        stats = self.index.evaluate_tables()
        try:
            self._store.save_table_meta(stats)
        except Exception:
            pass
        return stats

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
            "storage": "sqlite",
            "index_db": self.index_db_path,
            "scope": self.scope_distribution(),
            "pending_training": self._store.pending_count(),
            "train_version": self._store.last_train_version(),
        }

    def scope_distribution(self) -> Dict[str, int]:
        dist: Dict[str, int] = {}
        for meta in self.units.values():
            s = meta.get("scope") or "public"
            dist[s] = dist.get(s, 0) + 1
        return dict(sorted(dist.items()))

    def reset(self):
        """清空索引并重新冷启动（开发调试用，会丢弃运行时增量）。"""
        if os.path.exists(self.state_path):
            os.remove(self.state_path)
        self._store.clear_all()
        self._rebuild()
        self._persist_all()
        self._save_state()

    # ------------------------- 持久化 -------------------------

    def _feature_dim(self) -> int:
        """当前特征提取器的输出维度（用于校验状态文件是否与特征版本匹配）。"""
        try:
            return len(F.semantic_feature("维度探测"))
        except Exception:
            return 0

    def _save_state(self):
        """只存模型参数与来源元信息（几十 KB）。

        索引单元与记录已迁到 SQLite（`index.db`），不再全量序列化：
        旧实现每次增量写入都要重写数 MB 的 JSON，写入成本随库增长线性上升。
        """
        os.makedirs(settings.HASHING_DATA_DIR, exist_ok=True)
        from app.engines.hashing import features as _F
        state = {
            "version": STATE_VERSION,
            "feature_dim": self._feature_dim(),
            "code_length": self.code_length,
            "text_backend": _F.TEXT_BACKEND,
            "lambda_s": self.model.lambda_s,
            "modalities": self.model.modalities,
            "W": self.model.W,
            "source": self._source,
            "source_count": self._source_count,
            "seeded_from_db": self._seeded_from_db,
            # 语料元信息（数据集名称 / 配对规则 / 特征规格）：前端要展示
            # "数据来源"标注，重启后从状态文件恢复，避免显示为空
            "corpus_meta": self._corpus_meta,
            "storage": "sqlite",
            "window_epoch": str(getattr(settings, "HASHING_EPOCH", "")),
            "window_days": int(getattr(settings, "HASHING_WINDOW_DAYS", 0)),
            "window_models": self.window_bank.to_state(),
        }
        with open(self.state_path, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)

    def _load_model(self) -> bool:
        """从 state.json 恢复投影矩阵；不兼容时返回 False 由调用方重训。"""
        if not os.path.exists(self.state_path):
            return False
        try:
            with open(self.state_path, "r", encoding="utf-8") as f:
                state = json.load(f)
        except Exception:
            return False
        if state.get("version") != STATE_VERSION:
            return False
        # 特征维度变化（换特征提取器）会让投影矩阵失配，必须重训，
        # 否则编码会静默退化成全零码（所有相似度都相等，检索质量崩掉）。
        if state.get("feature_dim") != self._feature_dim():
            return False
        # 文本后端切换（tf 275 维 / bge 531 维）同样要重训：
        # 维度校验已能拦住两者，这里再加一道显式判断，防止将来出现同维度的后端
        from app.engines.hashing import features as _F
        if state.get("text_backend") not in (None, _F.TEXT_BACKEND):
            return False
        W = state.get("W") or {}
        if not W:
            return False
        self.code_length = state.get("code_length") or self.code_length
        self.model = OnlineSupervisedCMFH(
            code_length=self.code_length, lambda_s=state.get("lambda_s", 0.6)
        )
        self.model.modalities = state.get("modalities") or []
        self.model.W = W
        self.model.trained = True
        bank_state = state.get("window_models")
        if bank_state:
            try:
                self.window_bank.from_state(bank_state)
            except Exception:
                pass
        self._source = state.get("source") or self._source
        self._source_count = state.get("source_count") or self._source_count
        self._seeded_from_db = state.get("seeded_from_db", False)
        if not self._corpus_meta:
            self._corpus_meta = state.get("corpus_meta") or {}
        return True

    def _retrain_in_place(self) -> bool:
        """用内存中现有单元重训投影矩阵，并重编码全部单元。

        与 `_rebuild()` 的区别：不读语料库、不清空索引，运行时增量得以保留。
        仅在投影矩阵缺失或与特征维度不匹配时触发，属冷路径。
        """
        by_rec: Dict[str, Dict[str, Dict]] = {}
        for _uid, meta in self.units.items():
            rid = meta.get("record_id")
            if not rid:
                continue
            by_rec.setdefault(rid, {})[meta.get("modality") or "text"] = meta
        rec_ids = sorted(by_rec)
        if not rec_ids:
            return False
        sample_ids = (rec_ids if len(rec_ids) <= self._train_cap
                      else random.sample(rec_ids, self._train_cap))

        def _rec_of(rid: str) -> Optional[Dict]:
            views = {m: {"text": v.get("content") or "", "path": v.get("media_path"),
                         "feature": v.get("feature")}
                     for m, v in by_rec[rid].items() if m in TRAIN_MODALITIES}
            if not views:
                return None
            any_meta = next(iter(by_rec[rid].values()))
            return {"record_id": rid, "views": views,
                    "tags": any_meta.get("tags") or []}

        train_records = [r for r in (_rec_of(rid) for rid in sample_ids) if r]
        if not self._train(train_records):
            return False

        # 分窗口训练（与语料播种路径保持一致，升级后窗口模型不会为空）
        per_window: Dict[int, List[str]] = {}
        for rid in rec_ids:
            w = next(iter(by_rec[rid].values())).get("window") or 0
            per_window.setdefault(int(w), []).append(rid)
        cap = int(getattr(settings, "HASHING_WINDOW_TRAIN_MAX", 150))
        for w, ids in sorted(per_window.items()):
            pick = ids if len(ids) <= cap else random.sample(ids, cap)
            recs = [r for r in (_rec_of(rid) for rid in pick) if r]
            if len(recs) >= 8:
                self._train_window(w, recs)

        # 重编码：旧码是上一版 W 的产物，与新 W 混用会让汉明距离失去可比性
        self.index = self._new_index()
        for uid, meta in self.units.items():
            content = meta.get("content") or ""
            window = meta.get("window")
            encoder = self._encoder_for(window)
            mod = meta.get("modality") or "text"
            if meta.get("feature") and mod in ("image", "audio"):
                feat = {mod: meta["feature"]}
            else:
                feat = self._feature_of(mod, content, meta.get("media_path"))
            code = encoder.encode(feat)
            meta["code"] = list(code)
            self.index.insert(uid, code, meta, window=window)
        self._scope_epoch += 1
        self._save_state()
        self._persist_all()
        return True