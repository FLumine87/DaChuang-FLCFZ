"""审核与分池的回归测试。

覆盖四条关键路径：
1. 新数据默认 reviewing，本人可见、他人不可见
2. 审核通过后进入公共池，并写入训练队列
3. 审核拒绝后他人不可见，且不入队
4. 后台重训能消费队列

用独立临时索引库，不触碰线上数据。
"""
import asyncio
import os
import shutil
import sys
import tempfile
import unittest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.engines.hashing.demo_data import build_demo_dataset  # noqa: E402
from app.engines.hashing.engine import DynamicCrossModalHashingEngine  # noqa: E402
from app.engines.hashing.store import HashingStore  # noqa: E402


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
        engines_pkg._HASHING_ENGINE = cls.engine

    @classmethod
    def tearDownClass(cls):
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
        from app.services import review_service
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
