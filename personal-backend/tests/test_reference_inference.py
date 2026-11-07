"""Graph matching must not compete with the business backend's screening rules.

Run independently from backend/tests because both services use package name app.
All graph, model, and local-alert dependencies are isolated; no user DB is read.
"""
import os
import sys
import types
import unittest
from unittest.mock import patch

PERSONAL_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PERSONAL_BACKEND)

graph = types.ModuleType("app.core.neo4j")
graph.get_driver = lambda: None
graph.neo4j_health = lambda: False
model = types.ModuleType("app.services.llm_client")
model.chat = lambda *args, **kwargs: ""
model.mock_mode = lambda: True
recommendations = types.ModuleType("app.services.recommendation_agent")
recommendations.mock_fallback_feed = lambda: []
with patch.dict(sys.modules, {
    "app.core.neo4j": graph,
    "app.services.llm_client": model,
    "app.services.recommendation_agent": recommendations,
}):
    from app.services import inference_agent


class DummyDriver:
    def session(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class ReferenceInferenceTest(unittest.TestCase):
    def test_no_graph_or_personal_data_does_not_mean_healthy(self):
        with patch.object(inference_agent, "_local_alert_records", return_value=[]):
            report = inference_agent.run_inference("isolated-user")
        self.assertEqual(report.risk_level, "unknown")
        self.assertTrue(report.reference_only)
        self.assertEqual(report.source, "knowledge_graph")
        self.assertFalse(report.alert_created)
        self.assertNotIn("绿（正常）", report.summary)

    def test_historical_alert_is_not_a_new_screening_result(self):
        alerts = [{"level": "red", "created_at": "2020-01-01", "title": "historical"}]
        with patch.object(inference_agent, "_local_alert_records", return_value=alerts):
            report = inference_agent._run_mock("isolated-user")
        self.assertEqual(report.risk_level, "unknown")
        self.assertFalse(report.alert_created)
        self.assertTrue(any("historical" in factor for factor in report.factors))

    def test_old_weighted_score_is_only_matching_support(self):
        data = {
            "scale_scores": [{"name": "PHQ-9", "score": 27}],
            "symptoms": [{"name": "失眠"}],
            "emotions": [{"name": "悲伤", "avg_value": 1, "cnt": 5}],
            "disorder_symptom_totals": [{"disorder": "抑郁相关参考", "total": 3}],
            "disorder_matched": [{"disorder": "抑郁相关参考", "matched": ["失眠", "兴趣下降", "精力下降"]}],
        }
        with patch.object(inference_agent, "neo4j_health", return_value=True), \
             patch.object(inference_agent, "get_driver", return_value=DummyDriver()), \
             patch.object(inference_agent, "_run", side_effect=lambda session, key, uid: data.get(key, [])):
            report = inference_agent.run_inference("isolated-user")
        self.assertGreater(report.overall_score, 5)
        self.assertEqual(report.risk_level, "unknown")
        self.assertTrue(report.reference_only)
        self.assertEqual(len(report.matched_disorders), 1)
        self.assertFalse(report.alert_created)
        self.assertIn("不生成心理风险等级", report.summary)


if __name__ == "__main__":
    unittest.main(verbosity=2)
