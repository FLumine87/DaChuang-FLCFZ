"""
动态跨模态哈希检索引擎（真实实现）。

对接 HashingEngineInterface，整合：
  * features  : 多模态特征提取（可插拔）
  * cmfh      : 在线监督集体矩阵分解跨模态哈希（创新点②）
  * multi_table_index : 多哈希表增量索引（创新点①：动态 / 增量 / 多探测）

对外暴露接口：
  - encode(data, modality) -> List[int]       文本/图像/语音 -> K 位二值码
  - search(query, modality, top_k) -> List[Dict]   跨模态相似案例检索
  - index_case(case_data) -> bool             增量写入新案例（动态）

状态（模型 + 索引）持久化到本地 JSON，重启后可复用，符合「数据动态变化」
场景：日常新案例走 index_case 增量插入；积累足够标注后调用 retrain() 再训练。
"""
import asyncio
import datetime
import json
import os
from typing import Any, Dict, List

from app.engines.hashing.cmfh import OnlineSupervisedCMFH
from app.engines.hashing.demo_data import build_demo_dataset
from app.engines.hashing.interface import HashingEngineInterface
from app.engines.hashing.multi_table_index import MultiTableHashIndex
from app.engines.hashing import features as F

try:
    from app.config import settings
except Exception:  # 依赖未安装时（如独立验证算法）使用兜底默认
    class _DefaultSettings:
        HASHING_CODE_LENGTH = 32
        HASHING_LAMBDA_S = 0.6
        HASHING_NUM_TABLES = 4
        HASHING_PROBE_RADIUS = 2
        HASHING_DATA_DIR = "./data/hashing"
    settings = _DefaultSettings()


def _date_iso(v) -> str:
    """日期兼容：sqlite3 返回 'YYYY-MM-DD HH:MM:SS' 字符串，D1/ORM 可能返回 datetime。"""
    if not v:
        return ""
    if hasattr(v, "isoformat"):
        return v.isoformat()[:10]
    return str(v)[:10]


class DynamicCrossModalHashingEngine(HashingEngineInterface):
    def __init__(self):
        self._initialized = False
        self.code_length = settings.HASHING_CODE_LENGTH
        self.model = OnlineSupervisedCMFH(
            code_length=self.code_length, lambda_s=settings.HASHING_LAMBDA_S
        )
        self.index = MultiTableHashIndex(
            code_length=self.code_length,
            num_tables=settings.HASHING_NUM_TABLES,
            probe_radius=settings.HASHING_PROBE_RADIUS,
        )
        self.cases_meta = {}  # case_id -> {summary, tags, alert_level, date, modality, code, features}
        self.state_path = os.path.join(settings.HASHING_DATA_DIR, "hashing_state.json")
        self._init_lock = asyncio.Lock()
        # 训练小样本上限（纯 Python 特征值分解为 O(n^2)，训练只在样本上做）
        self._train_cap = getattr(settings, "HASHING_TRAIN_MAX", 150)
        # 状态标记：是否从数据库播种、以及当时索引的数据库行数（用于「重启后自动补齐新增记录」）
        self._seeded_from_db = False
        self._db_row_count = 0

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
        """同步核心初始化（供异步 initialize 与同步写路径复用）。

        策略（方案 2 + 方案 1）：
          * 状态文件存在 -> 直接加载（极快，日常启动走这里）；
            但若数据库行数多于已索引数，说明停机期间有新数据，自动重新从库播种。
          * 状态文件不存在 -> 尝试从数据库播种（真实语料）；
            数据库为空时回退到 demo_data（兜底，保证开箱即用）。
        """
        try:
            if os.path.exists(self.state_path):
                self._load_state()
                cur = self._count_db_rows()
                if cur > self._db_row_count:
                    # 停机期间数据有增长：清空后用最新数据库重新播种
                    self.cases_meta = {}
                    self.index = MultiTableHashIndex(
                        code_length=self.code_length,
                        num_tables=settings.HASHING_NUM_TABLES,
                        probe_radius=settings.HASHING_PROBE_RADIUS,
                    )
                    self._seed_from_db()  # 训练 + 索引全部 + 保存
            else:
                self._seed_from_db()  # 含 demo 兜底 + 保存
        except Exception:
            # 任何异常都退回演示集重建，保证引擎可用
            self.cases_meta = {}
            self._build_demo()
            self._seeded_from_db = False
            self._db_row_count = 0
            self._save_state()
        self._initialized = True

    async def health_check(self) -> bool:
        return self._initialized

    # ------------------------- 特征提取 -------------------------

    def _extract_features(self, data: Any, modality: str) -> Dict[str, List[float]]:
        """把任意输入转成 {modality: vector}。文本总会派生出三模态特征，
        从而保证任意文本都能跨模态检索。"""
        feats: Dict[str, List[float]] = {}
        if modality == "text" or isinstance(data, str):
            text = data if isinstance(data, str) else str(data)
            feats["text"] = F.text_feature(text)
            feats["image"] = F.media_feature_from_text(text, "image")
            feats["audio"] = F.media_feature_from_text(text, "audio")
        else:
            if isinstance(data, (bytes, bytearray)):
                text = str(len(data))
                feats["text"] = F.text_feature(text)
                feats[modality] = F.media_feature_from_text(text, modality)
            else:
                path = str(data)
                f = (F.image_feature_from_file(path) if modality == "image"
                     else F.audio_feature_from_file(path))
                if f is None:
                    feats["text"] = F.text_feature(path)
                    feats[modality] = F.media_feature_from_text(path, modality)
                else:
                    feats[modality] = f
                    feats["text"] = F.text_feature(path)
        return feats

    # ------------------------- 接口实现 -------------------------

    async def encode(self, data: Any, modality: str) -> List[int]:
        await self._ensure_initialized()
        feats = self._extract_features(data, modality)
        return self.model.encode(feats)

    async def search(self, query: str, modality: str = "text", top_k: int = 5) -> List[Dict]:
        await self._ensure_initialized()
        feats = self._extract_features(query, modality)
        code = self.model.encode(feats)
        ids, sims = self.index.search(code, top_k)
        results = []
        for cid, sim in zip(ids, sims):
            meta = self.cases_meta.get(cid)
            if not meta:
                continue
            results.append({
                "id": cid,
                "similarity": round(sim, 2),
                "modality": meta.get("modality", "text"),
                "summary": meta.get("summary", ""),
                "tags": meta.get("tags", []),
                "alert_level": meta.get("alert_level", "green"),
                "date": meta.get("date", ""),
            })
        return results

    async def index_case(self, case_data: Dict) -> bool:
        """增量写入一个案例（动态，异步入口）。"""
        await self._ensure_initialized()
        return self._index_case_impl(case_data)

    def index_case_sync(self, case_data: Dict) -> bool:
        """增量写入（同步入口），供同步的业务 Service / 脚本使用，
        避免与正在运行的事件循环冲突。"""
        try:
            if not self._initialized:
                self._do_initialize()
            return self._index_case_impl(case_data)
        except Exception:
            return False

    def _index_case_impl(self, case_data: Dict) -> bool:
        """索引写入的核心实现（同步）。case_data 至少包含 id/summary，可选
        tags/alert_level/date/modality；未给 tags 时自动从 summary 抽取主题。"""
        cid = str(case_data.get("id") or case_data.get("case_id")
                  or f"CASE-{len(self.cases_meta) + 1}")
        summary = case_data.get("summary") or case_data.get("name") or ""
        tags = case_data.get("tags")
        if not tags:
            tags = F.extract_themes(summary)
        alert_level = case_data.get("alert_level") or "green"
        date = case_data.get("date") or datetime.date.today().isoformat()
        modality = case_data.get("modality") or "text"

        feats = self._extract_features(summary if summary else cid, "text")
        if case_data.get("image_feature"):
            feats["image"] = case_data["image_feature"]
        if case_data.get("audio_feature"):
            feats["audio"] = case_data["audio_feature"]

        code = self.model.encode(feats)
        meta = {
            "id": cid, "summary": summary, "tags": tags,
            "alert_level": alert_level, "date": date, "modality": modality,
            "code": list(code), "features": feats,
        }
        self.cases_meta[cid] = meta
        self.index.insert(cid, code, meta)
        self._seeded_from_db = True
        self._db_row_count = self._db_row_count + 1
        self._save_state()
        return True

    # ------------------------- 数据库播种（方案 2）-------------------------

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

    def _collect_db_rows(self) -> List[Dict]:
        """读取四张业务表，构造可被索引的行（含预计算特征与主题标签）。

        数据源为轻量数据层（本地 sqlite3 / Worker D1），不再依赖 SQLAlchemy。
        """
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
                # 前端 modalityIcons 只支持 text/audio/image/multimodal；
                # document 本质文本资料，映射为 text 避免渲染崩溃。
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

    def _make_row(self, cid, summary, tags, alert_level, modality, date) -> Dict:
        feats = self._extract_features(summary, "text")
        return {
            "id": cid, "summary": summary, "tags": tags or [],
            "alert_level": alert_level, "modality": modality, "date": date,
            "features": feats,
        }

    def _tag_jaccard_matrix(self, rows):
        n = len(rows)
        sim = [[0.0] * n for _ in range(n)]
        for i in range(n):
            ti = set(rows[i].get("tags", []))
            for j in range(n):
                tj = set(rows[j].get("tags", []))
                union = ti | tj
                sim[i][j] = (len(ti & tj) / len(union)) if union else 0.0
                if i == j:
                    sim[i][j] = 1.0
        return sim

    def _seed_from_db(self):
        """从数据库播种：在小样本上训练 CMFH（学投影矩阵 W），再把全部记录
        按样本外方式编码入索引。

        优先级：主库检索表 -> 随项目发布的检索种子库(retrieval_seed.db) -> demo_data 兜底。
        这样 clone 后即使未运行数据脚本，也能直接检索到约 500 条语料。
        """
        rows = self._collect_db_rows()
        if not rows and os.path.exists(settings.RETRIEVAL_SEED_DB):
            rows = self._collect_rows_from_file(settings.RETRIEVAL_SEED_DB)
        if not rows:
            self._build_demo()
            self._seeded_from_db = False
            self._db_row_count = 0
            self._save_state()
            return
        # 训练：在代表性小样本上拟合，避免对全部 N 做慢速特征值分解
        if len(rows) > self._train_cap:
            import random as _rnd
            sample = _rnd.sample(rows, self._train_cap)
        else:
            sample = rows
        feats = {m: [r["features"][m] for r in sample] for m in ("text", "image", "audio")}
        sim = self._tag_jaccard_matrix(sample)
        self.model.fit(feats, sim)
        # 索引全部行（样本外编码）
        for r in rows:
            self._insert_row(r)
        self._seeded_from_db = True
        self._db_row_count = len(rows)
        self._save_state()

    def _insert_row(self, row: Dict):
        feats = row.get("features") or self._extract_features(row.get("summary", ""), "text")
        code = self.model.encode(feats)
        meta = dict(row, code=list(code), features=feats)
        self.cases_meta[meta["id"]] = meta
        self.index.insert(meta["id"], code, meta)

    # ------------------------- 演示集 / 持久化 -------------------------

    def _build_demo(self):
        ds = build_demo_dataset()
        cases, feats, sim = ds["cases"], ds["features"], ds["similarity"]
        self.model.fit(feats, sim)
        for i, c in enumerate(cases):
            cf = {m: feats[m][i] for m in feats}
            code = self.model.encode(cf)
            meta = dict(c, code=list(code), features=cf)
            self.cases_meta[c["id"]] = meta
            self.index.insert(c["id"], code, meta)

    def _save_state(self):
        os.makedirs(settings.HASHING_DATA_DIR, exist_ok=True)
        state = {
            "code_length": self.code_length,
            "lambda_s": self.model.lambda_s,
            "modalities": self.model.modalities,
            "W": self.model.W,
            "cases_meta": self.cases_meta,
            "seeded_from_db": self._seeded_from_db,
            "db_row_count": self._db_row_count,
        }
        with open(self.state_path, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)

    def _load_state(self):
        with open(self.state_path, "r", encoding="utf-8") as f:
            state = json.load(f)
        self.code_length = state["code_length"]
        self.model = OnlineSupervisedCMFH(
            code_length=self.code_length, lambda_s=state.get("lambda_s", 0.6)
        )
        self.model.modalities = state["modalities"]
        self.model.W = state["W"]
        self.model.trained = True
        self.cases_meta = state["cases_meta"]
        self._seeded_from_db = state.get("seeded_from_db", False)
        self._db_row_count = state.get("db_row_count", 0)
        self.index = MultiTableHashIndex(
            code_length=self.code_length,
            num_tables=settings.HASHING_NUM_TABLES,
            probe_radius=settings.HASHING_PROBE_RADIUS,
        )
        for cid, meta in self.cases_meta.items():
            self.index.insert(cid, meta["code"], meta)

    def reset(self):
        """清空状态并重建演示集（开发调试用）。"""
        if os.path.exists(self.state_path):
            os.remove(self.state_path)
        self.cases_meta = {}
        self._seeded_from_db = False
        self._db_row_count = 0
        self._build_demo()
        self._save_state()
