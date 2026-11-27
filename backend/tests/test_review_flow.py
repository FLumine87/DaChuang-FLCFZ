"""审核与分池的回归测试。

覆盖四条关键路径：
1. 新数据默认 reviewing，本人可见、他人不可见
2. 审核通过后进入公共池，并写入训练队列
3. 审核拒绝后他人不可见，且不入队
4. 后台重训能消费队列

用独立临时索引库，不触碰线上数据。
"""
import asyncio
import base64
import json
import math
import os
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch
import wave

from PIL import Image

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.engines.hashing.demo_data import build_demo_dataset  # noqa: E402
from app.engines.hashing.engine import DynamicCrossModalHashingEngine  # noqa: E402
from app.engines.hashing.store import HashingStore  # noqa: E402
from app.config import settings  # noqa: E402
from app.handlers import personal, retrieval, upload  # noqa: E402
from app.services import review_service  # noqa: E402


def _new_engine(workdir):
    engine = DynamicCrossModalHashingEngine()
    engine.state_path = os.path.join(workdir, "state.json")
    engine.index_db_path = os.path.join(workdir, "index.db")
    engine._store = HashingStore(engine.index_db_path)
    engine._build_demo_index()
    return engine


def _build_demo_index(self):
    """只装载演示集，避免测试依赖仓库外数据集。"""
    self._store.init_schema()
    self.model = type(self.model)(code_length=self.code_length,
                                  lambda_s=0.6)
    self.index = self._new_index()
    self.records = {}
    self.units = {}
    ds = build_demo_dataset()
    cases = ds["cases"]
    if len(cases) < self.code_length:
        self.code_length = max(8, len(cases))
        self.model = type(self.model)(code_length=self.code_length, lambda_s=0.6)
        self.index = self._new_index()
    self._train([{"record_id": c["id"], "views": {"text": c["summary"]},
                  "tags": c.get("tags") or []} for c in cases])
    for c in cases:
        self._add_unit(c["id"], {
            "record_id": c["id"], "modality": "text",
            "tags": c.get("tags") or [],
            "alert_level": c.get("alert_level", "green"),
            "date": c.get("date", ""), "content": c["summary"],
            "scope": "public", "source": "demo",
        })
    self._source = "demo"
    self._persist_all()
    self._save_state()
    self._initialized = True


DynamicCrossModalHashingEngine._build_demo_index = _build_demo_index


class ReviewFlowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workdir = tempfile.mkdtemp(prefix="review_test_")
        cls.engine = _new_engine(cls.workdir)
        import app.engines as engines_pkg
        cls.previous_engine = engines_pkg._HASHING_ENGINE
        engines_pkg._HASHING_ENGINE = cls.engine

    @classmethod
    def tearDownClass(cls):
        import app.engines as engines_pkg
        engines_pkg._HASHING_ENGINE = cls.previous_engine
        cls.engine._store.close()
        shutil.rmtree(cls.workdir, ignore_errors=True)

    def test_01_new_case_is_reviewing(self):
        e = self.engine
        e.index_case_sync({
            "id": "TEST-NEW-1", "record_id": "TEST-NEW-1", "user_id": 9001,
            "summary": "最近焦虑，晚上睡不着，考试压力大", "date": "2026-10-01",
        })
        meta = e.units["TEST-NEW-1"]
        self.assertEqual(meta["scope"], "reviewing")
        self.assertIsNotNone(meta.get("window"))

    def test_02_visibility(self):
        e = self.engine
        owner = {"user_id": 9001, "role": "user"}
        other = {"user_id": 9002, "role": "user"}

        async def run():
            mine, _ = await e.search_with_info("焦虑 睡不着", top_k=10, viewer=owner)
            theirs, _ = await e.search_with_info("焦虑 睡不着", top_k=10, viewer=other)
            return mine, theirs

        mine, theirs = asyncio.run(run())
        self.assertTrue(any(h["id"] == "TEST-NEW-1" for h in mine))
        self.assertFalse(any(h["id"] == "TEST-NEW-1" for h in theirs))

    def test_03_approve_goes_public_and_enqueues(self):
        with patch.object(review_service, "_consented_user_ids", AsyncMock(return_value=set())):
            denied = asyncio.run(review_service.review(["TEST-NEW-1"], "approve", 1, "ok"))
        self.assertEqual(denied["updated"], 0)
        self.assertEqual(self.engine.units["TEST-NEW-1"]["scope"], "reviewing")
        with patch.object(review_service, "_consented_user_ids", AsyncMock(return_value={9001})):
            result = asyncio.run(review_service.review(["TEST-NEW-1"], "approve", 1, "ok"))
        self.assertEqual(result["updated"], 1)
        self.assertGreaterEqual(result["pending"], 1)
        self.assertEqual(self.engine.units["TEST-NEW-1"]["scope"], "public")

        other = {"user_id": 9002, "role": "user"}
        hits, _ = asyncio.run(self.engine.search_with_info("焦虑 睡不着", top_k=10, viewer=other))
        self.assertTrue(any(h["id"] == "TEST-NEW-1" for h in hits))

    def test_04_reject_not_enqueued(self):
        from app.services import review_service
        e = self.engine
        e.index_case_sync({
            "id": "TEST-REJ-1", "record_id": "TEST-REJ-1", "user_id": 9003,
            "summary": "测试数据 请忽略", "date": "2026-10-02",
        })
        before = e._store.pending_count()
        asyncio.run(review_service.review(["TEST-REJ-1"], "reject", 1, "测试数据"))
        self.assertEqual(e.units["TEST-REJ-1"]["scope"], "rejected")
        self.assertEqual(e._store.pending_count(), before)

        other = {"user_id": 9004, "role": "user"}
        hits, _ = asyncio.run(e.search_with_info("测试数据", top_k=10, viewer=other))
        self.assertFalse(any(h["id"] == "TEST-REJ-1" for h in hits))

    def test_05_retrain_consumes_queue(self):
        e = self.engine
        pending = e._store.pending_count()
        self.assertGreater(pending, 0)
        result = e.retrain_pending()
        self.assertEqual(e._store.pending_count(), 0)
        self.assertTrue(result["version"])

    def test_06_retrain_keeps_units(self):
        before = len(self.engine.units)
        self.engine.retrain()
        self.assertEqual(len(self.engine.units), before)


class ReviewTrainingRegressionTests(unittest.TestCase):
    def setUp(self):
        self.folder = self.enterContext(tempfile.TemporaryDirectory(prefix="review-regression-"))
        self.enterContext(patch.object(settings, "HASHING_DATA_DIR", self.folder))
        self.enterContext(patch.object(settings, "HASHING_CODE_LENGTH", 8))
        self.enterContext(patch.object(settings, "HASHING_AUTO_RETRAIN_MIN", 0))
        self.engine = _new_engine(self.folder)
        self.addCleanup(self.engine._store.close)
        self.enterContext(patch.object(review_service, "get_hashing_engine", return_value=self.engine))
        self.enterContext(patch.object(review_service, "_sync_business_table", new_callable=AsyncMock))
        self.enterContext(patch.object(review_service, "_consented_user_ids", AsyncMock(return_value={9001})))

    def add_text(self, key, text, scope="reviewing"):
        self.assertTrue(self.engine.index_case_sync(
            {"id": key, "user_id": 9001, "summary": text, "date": "2026-10-01", "scope": scope}))

    def approve(self, *ids):
        return asyncio.run(review_service.review(list(ids), "approve", 1))

    def test_review_and_queue_change_are_atomic(self):
        self.add_text("ATOMIC", "晚上睡不着，担心明天的考试")
        conn = self.engine._store._conn
        conn.execute("CREATE TRIGGER prevent_queue BEFORE INSERT ON train_queue "
                     "BEGIN SELECT RAISE(ABORT, 'test failure'); END")
        self.assertEqual(self.approve("ATOMIC")["updated"], 0)
        self.assertEqual(self.engine.units["ATOMIC"]["scope"], "reviewing")
        self.assertEqual(self.engine._store.load_units()["ATOMIC"]["scope"], "reviewing")
        self.assertEqual(self.engine._store.pending_count(), 0)
        conn.execute("DROP TRIGGER prevent_queue")
        self.assertEqual(self.approve("ATOMIC", "ATOMIC")["updated"], 1)
        self.assertEqual(self.engine._store.pending_count(), 1)
        denied = asyncio.run(review_service.set_scope("ATOMIC", "private", user_id=9002))
        self.assertFalse(denied["ok"])
        asyncio.run(review_service.set_scope("ATOMIC", "private", user_id=9001))
        self.assertEqual(self.engine._store.pending_count(), 0)
        self.assertEqual(self.approve("ATOMIC")["updated"], 0)

    def test_retrain_uses_only_public_records_and_keeps_distinct_hashes(self):
        self.add_text("PRIVATE", "雨后公园很安静，喜欢散步", "private")
        self.add_text("REJECTED", "与朋友看了一场球赛", "rejected")
        self.add_text("PENDING", "很久没见朋友，感觉孤单")
        self.engine._store.enqueue("PRIVATE", None)  # A stale entry from the previous implementation.
        approved = ["PUBLIC-A", "PUBLIC-B", "PUBLIC-C"]
        for uid, text in zip(approved, ["反复失眠，考试焦虑", "散步晒太阳，心情放松", "运动后很精神，打算继续跑步"]):
            self.add_text(uid, text)
        for i in range(8):
            self.add_text(f"OLDER-{i}", f"过去的记录 {i}，睡眠与食欲变化", "public")
        self.assertEqual(self.approve(*approved)["updated"], 3)
        with patch.object(self.engine, "_train_window", wraps=self.engine._train_window) as train:
            self.assertTrue(self.engine.retrain_pending()["retrained"])
        picked = {r["record_id"] for call in train.call_args_list for r in call.args[1]}
        self.assertTrue(set(approved) <= picked)
        self.assertTrue(picked.isdisjoint({"PRIVATE", "REJECTED", "PENDING"}))
        self.assertEqual(self.engine._store.pending_count(), 0)
        codes = {uid: self.engine.units[uid]["code"] for uid in approved}
        self.assertGreater(len({tuple(code) for code in codes.values()}), 1)
        self.assertEqual(self.approve("PUBLIC-A")["pending"], 0)

        reopened = self.reopen()
        self.assertEqual({uid: reopened.units[uid]["code"] for uid in approved}, codes)
        self.assertTrue(reopened.window_bank.models)
        hits = asyncio.run(reopened.search("反复失眠，考试焦虑", top_k=30,
                                          viewer={"role": "user", "user_id": 9002}))
        returned = {hit["id"] for hit in hits}
        self.assertIn("PUBLIC-A", returned)
        self.assertTrue(returned.isdisjoint({"PRIVATE", "REJECTED", "PENDING"}))

    def test_queue_only_consumes_records_in_the_training_batch(self):
        ids = [f"BATCH-{i}" for i in range(9)]
        for i, uid in enumerate(ids):
            self.add_text(uid, f"记录 {i}，分享今天的睡眠和运动情况")
        self.assertEqual(self.approve(*ids)["updated"], len(ids))
        with patch.object(settings, "HASHING_WINDOW_TRAIN_MAX", 8):
            self.assertTrue(self.engine.retrain_pending()["retrained"])
            pending = self.engine._store.pending_training()
            self.assertEqual([row["record_id"] for row in pending], ids[-1:])
            self.assertTrue(self.engine.retrain_pending()["retrained"])
            self.assertEqual(self.engine._store.pending_count(), 0)

    def reopen(self):
        self.engine._store.close()
        engine = DynamicCrossModalHashingEngine()
        engine.state_path = self.engine.state_path
        self.addCleanup(engine._store.close)
        asyncio.run(engine.initialize())
        return engine

    def test_real_media_respects_review_and_survives_retraining_and_reload(self):
        image, audio = Path(self.folder) / "test.png", Path(self.folder) / "test.wav"
        Image.effect_noise((96, 96), 50).save(image)
        with wave.open(str(audio), "wb") as wav:
            wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            wav.writeframes(b"".join(struct.pack("<h", int(10000 * math.sin(2 * math.pi * 280 * i / 16000)))
                                    for i in range(16000)))
        paths = {f"/uploads/{path.name}": path for path in (image, audio)}

        def owned_upload(sql, params):
            return {"id": 1} if params[0] in paths and params[1] == 9001 else None

        with patch.object(upload, "UPLOAD_ROOT", self.folder), \
                patch.object(upload.db, "query_one", side_effect=owned_upload), \
                patch("app.engines.get_hashing_engine", return_value=self.engine):
            self.assertIsNone(upload.resolve_index_media("/uploads/test.png", 9002, "image"))
            for number, modality, path in [(1, "image", image), (2, "audio", audio)]:
                asyncio.run(personal._index_supplement(number, modality,
                            {"url": f"/uploads/{path.name}", "filename": path.name}, 9001))
                self.assertTrue(self.engine._store.load_units()[f"sup-{number}"]["feature"])

        def search(engine, kind, path, user):
            with patch.object(retrieval, "get_hashing_engine", return_value=engine), \
                    patch("app.engines.get_image_index", return_value=None):
                hits, _, _, _ = asyncio.run(retrieval.perform_search({
                    "modality": kind, "modality_filter": kind, "media_name": path.name,
                    "media_base64": base64.b64encode(path.read_bytes()).decode(),
                }, viewer={"role": "user", "user_id": user}))
            return {hit["id"] for hit in hits}

        self.assertIn("sup-1", search(self.engine, "image", image, 9001))
        self.assertNotIn("sup-1", search(self.engine, "image", image, 9002))
        self.assertIn("sup-2", search(self.engine, "audio", audio, 9001))
        self.assertNotIn("sup-2", search(self.engine, "audio", audio, 9002))
        self.assertEqual(self.approve("sup-1", "sup-2")["updated"], 2)
        self.assertIn("sup-1", search(self.engine, "image", image, 9002))
        self.assertIn("sup-2", search(self.engine, "audio", audio, 9002))
        self.assertTrue(self.engine.retrain_pending()["retrained"])
        reopened = self.reopen()
        for uid, modality, path in [("sup-1", "image", image), ("sup-2", "audio", audio)]:
            unit = reopened.units[uid]
            self.assertTrue(unit["feature"])
            self.assertEqual(len(unit["code"]), reopened.code_length)
            self.assertIn(uid, search(reopened, modality, path, 9002))

        # Simulate a v6 persisted entry whose file was saved but never passed into the index.
        reopened._store.upsert_unit("sup-1", {**reopened.units["sup-1"], "media_path": None, "feature": None})
        reopened._store.close()
        state_path = Path(self.engine.state_path)
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state["version"] = 6
        state_path.write_text(json.dumps(state), encoding="utf-8")

        def legacy_lookup(sql, params):
            if "screening_supplements" in sql and params == (1, 9001, "image"):
                return {"url": "/uploads/test.png"}
            return owned_upload(sql, params)

        with patch.object(upload, "UPLOAD_ROOT", self.folder), \
                patch.object(upload.db, "query_one", side_effect=legacy_lookup):
            migrated = self.reopen()
        self.assertEqual(migrated.units["sup-1"]["media_path"], str(image))
        self.assertTrue(migrated.units["sup-1"]["feature"])
        self.assertIn("sup-1", search(migrated, "image", image, 9002))


if __name__ == "__main__":
    unittest.main(verbosity=2)
