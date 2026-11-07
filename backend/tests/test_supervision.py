"""无标签数据的处理规则回归测试。

三个约束：
1. 无标签样本不参与"错误哈希样本"判定
2. 训练采样保证有标签样本占七成
3. 无标签窗口的表权重按覆盖率折价
"""
import os
import shutil
import sys
import tempfile
import unittest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

from tests.test_review_flow import _new_engine  # noqa: E402


class SupervisionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workdir = tempfile.mkdtemp(prefix="sup_test_")
        cls.engine = _new_engine(cls.workdir)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.workdir, ignore_errors=True)

    def test_unlabeled_not_error_sample(self):
        recs = [
            {"record_id": "U1", "views": {"text": "随便写点什么"}, "tags": []},
            {"record_id": "U2", "views": {"text": "我好烦啊啊啊啊"}, "tags": []},
            {"record_id": "U3", "views": {"text": "愤怒"}, "tags": []},
        ]
        self.assertEqual(self.engine._error_samples(0, recs), [])

    def _samples(self):
        labeled = [{"record_id": f"L{i}", "views": {"text": f"焦虑 失眠 {i}"},
                    "tags": ["焦虑"]} for i in range(10)]
        unlabeled = [{"record_id": f"U{i}", "views": {"text": f"随便写 {i}"},
                      "tags": []} for i in range(20)]
        return labeled + unlabeled

    def test_balance_off_by_default(self):
        """默认不裁剪：无标签样本全部保留，模型才能见过新数据分布。"""
        self.assertEqual(len(self.engine._balance_supervision(self._samples())), 30)

    def test_balance_when_enabled(self):
        """显式开启 70% 口径时才裁剪，供评测复现项目书实验设置。"""
        from app.config import settings
        old = settings.HASHING_LABELED_RATIO
        settings.HASHING_LABELED_RATIO = 0.7
        try:
            out = self.engine._balance_supervision(self._samples())
        finally:
            settings.HASHING_LABELED_RATIO = old
        self.assertEqual(sum(1 for r in out if r.get("tags")), 10)
        self.assertLessEqual(sum(1 for r in out if not r.get("tags")), 5)

    def test_no_unlabeled_keeps_all(self):
        recs = [{"record_id": f"L{i}", "views": {"text": "焦虑"}, "tags": ["焦虑"]}
                for i in range(5)]
        self.assertEqual(len(self.engine._balance_supervision(recs)), 5)

    def test_label_coverage_unknown_window(self):
        """不存在的窗口不惩罚（返回 1.0）。"""
        self.assertEqual(self.engine._label_coverage(999999), 1.0)

    def test_label_coverage_unlabeled_window(self):
        """全无标签的窗口覆盖率应为 0。"""
        e = self.engine
        e.index_case_sync({
            "id": "U-COV-1", "record_id": "U-COV-1", "user_id": 9101,
            "summary": "嗯嗯啊啊", "date": "2026-11-15",
        })
        window = e.units["U-COV-1"]["window"]
        self.assertEqual(e._label_coverage(window), 0.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
