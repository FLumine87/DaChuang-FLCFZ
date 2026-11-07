"""标签标注的回归测试。

覆盖：模型输出解析、人工标签收敛、标签写回索引、空文本建议。
不依赖大模型，全部走本地逻辑。
"""
import asyncio
import os
import shutil
import sys
import tempfile
import unittest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from app.services import label_service  # noqa: E402
from tests.test_review_flow import _new_engine  # noqa: E402


class LabelServiceTest(unittest.TestCase):
    def test_parse_filters_unknown(self):
        raw = '好的，结果如下：["焦虑","睡眠障碍","瞎编的标签"]'
        self.assertEqual(label_service._parse(raw), ["焦虑", "睡眠障碍"])

    def test_parse_handles_non_json(self):
        self.assertEqual(label_service._parse("我觉得是焦虑"), [])
        self.assertEqual(label_service._parse(""), [])

    def test_parse_limits_count(self):
        raw = '["焦虑","抑郁","睡眠障碍","人际","学业压力"]'
        self.assertEqual(len(label_service._parse(raw)), label_service.MAX_LABELS)

    def test_normalize_dedup_and_filter(self):
        out = label_service.normalize(["焦虑", "焦虑", "自定义", " 失眠 ", "人际"])
        self.assertEqual(out, ["焦虑", "人际"])

    def test_normalize_empty(self):
        self.assertEqual(label_service.normalize([]), [])
        self.assertEqual(label_service.normalize(None), [])


class TagWriteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workdir = tempfile.mkdtemp(prefix="label_test_")
        cls.engine = _new_engine(cls.workdir)
        import app.engines as engines_pkg
        engines_pkg._HASHING_ENGINE = cls.engine

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.workdir, ignore_errors=True)

    def test_set_tags_updates_index(self):
        from app.services import review_service
        e = self.engine
        e.index_case_sync({
            "id": "TAG-1", "record_id": "TAG-1", "user_id": 9201,
            "summary": "最近总是睡不着", "date": "2026-11-20",
        })
        self.assertEqual(e.units["TAG-1"].get("tags"), [])

        r = asyncio.run(review_service.set_tags("TAG-1", ["睡眠障碍"], 1))
        self.assertTrue(r["ok"])
        self.assertEqual(e.units["TAG-1"]["tags"], ["睡眠障碍"])
        self.assertEqual(e.records["TAG-1"]["tags"], ["睡眠障碍"])

    def test_set_tags_clears(self):
        from app.services import review_service
        e = self.engine
        e.index_case_sync({
            "id": "TAG-2", "record_id": "TAG-2", "user_id": 9202,
            "summary": "和室友相处不太愉快", "date": "2026-11-21",
        })
        asyncio.run(review_service.set_tags("TAG-2", ["人际"], 1))
        self.assertEqual(e.units["TAG-2"]["tags"], ["人际"])
        asyncio.run(review_service.set_tags("TAG-2", [], 1))
        self.assertEqual(e.units["TAG-2"]["tags"], [])

    def test_set_tags_unknown_record(self):
        from app.services import review_service
        r = asyncio.run(review_service.set_tags("NOT-EXIST", ["焦虑"], 1))
        self.assertFalse(r["ok"])

    def test_suggest_empty_text(self):
        r = asyncio.run(label_service.suggest_labels(""))
        self.assertEqual(r["labels"], [])
        self.assertEqual(r["source"], "none")


if __name__ == "__main__":
    unittest.main(verbosity=2)
