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
        # 查询键与 inference_agent._QUERIES 保持一致。匹配改为"领域索引 + Python 侧
        # 词典归一"后，不再用 disorder_matched 的 Cypher 等值连接结果。
        data = {
            "scale_scores": [{"name": "PHQ-9", "score": 27}],
            "symptoms": [{"name": "失眠", "cnt": 1, "last_seen": None}],
            "emotions": [{"name": "悲伤", "avg_value": 1, "cnt": 5, "last_seen": None}],
            "disorder_symptom_totals": [{"disorder": "抑郁相关参考", "total": 3}],
            "symptom_doc_freq": [{"symptom": "失眠", "doc_freq": 1}],
            "disorder_total_count": [{"total": 1}],
            "domain_symptom_index": [{"disorder": "抑郁相关参考", "symptom": "失眠"}],
            "domain_trigger_index": [],
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

    def test_recent_graph_keyword_is_not_verified_current_crisis(self):
        from datetime import datetime
        data = {'symptoms':[{'name':'自杀意念','last_seen':datetime.now().isoformat(),'cnt':1}], 'disorder_total_count':[{'total':1}]}
        with patch.object(inference_agent, 'neo4j_health', return_value=True), patch.object(inference_agent, 'get_driver', return_value=DummyDriver()), patch.object(inference_agent, '_run', side_effect=lambda session,key,uid:data.get(key, [])):
            report = inference_agent.run_inference('isolated-user')
        self.assertTrue(report.crisis)
        self.assertTrue(report.crisis_recent_reference)
        self.assertFalse(report.crisis_verified)
        self.assertEqual(report.crisis_sources, ['graph'])

    def test_only_trigger_still_matches_a_disorder(self):
        """只有诱因、没有任何症状时也应给出候选（改造前恒为空）。"""
        data = {
            "disorder_symptom_totals": [{"disorder": "学业压力反应", "total": 5}],
            "symptom_doc_freq": [{"symptom": "失眠", "doc_freq": 5}],
            "disorder_total_count": [{"total": 1}],
            "domain_symptom_index": [{"disorder": "学业压力反应", "symptom": "失眠"}],
            "domain_trigger_index": [{"disorder": "学业压力反应", "name": "考试"}],
            "events": [{"name": "考试", "cnt": 1, "last_seen": None}],
        }
        with patch.object(inference_agent, "neo4j_health", return_value=True), \
             patch.object(inference_agent, "get_driver", return_value=DummyDriver()), \
             patch.object(inference_agent, "_run", side_effect=lambda session, key, uid: data.get(key, [])):
            report = inference_agent.run_inference("isolated-user")
        self.assertEqual(len(report.matched_disorders), 1)
        matched = report.matched_disorders[0]
        self.assertEqual(matched.matched_symptoms, [])
        self.assertEqual(matched.matched_triggers, ["考试"])
        # 只有诱因时必须如实措辞为"情境线索"，不能写成"症状匹配"
        self.assertTrue(any("情境线索" in f for f in report.factors))

    def test_colloquial_symptom_is_normalized_before_matching(self):
        """口语症状名（疲乏/入睡困难）应归一成规范名后才参与匹配。"""
        data = {
            "symptoms": [{"name": "疲乏", "cnt": 1, "last_seen": None}],
            "disorder_symptom_totals": [{"disorder": "抑郁相关参考", "total": 3}],
            "symptom_doc_freq": [{"symptom": "疲惫", "doc_freq": 2}],
            "disorder_total_count": [{"total": 5}],
            "domain_symptom_index": [{"disorder": "抑郁相关参考", "symptom": "疲惫"}],
            "domain_trigger_index": [],
        }
        with patch.object(inference_agent, "neo4j_health", return_value=True), \
             patch.object(inference_agent, "get_driver", return_value=DummyDriver()), \
             patch.object(inference_agent, "_run", side_effect=lambda session, key, uid: data.get(key, [])):
            report = inference_agent.run_inference("isolated-user")
        self.assertEqual(len(report.matched_disorders), 1)
        # 归一后匹配的是规范名，不是用户写的口语名
        self.assertEqual(report.matched_disorders[0].matched_symptoms, ["疲惫"])
        self.assertEqual(report.unmapped_terms, [])

    def test_unmapped_term_is_reported_not_dropped(self):
        """无法归一的个人记录必须如实列出，而不是静默丢弃。"""
        data = {
            "symptoms": [{"name": "说不清的古怪感受", "cnt": 1, "last_seen": None}],
            "disorder_symptom_totals": [{"disorder": "抑郁相关参考", "total": 3}],
            "symptom_doc_freq": [],
            "disorder_total_count": [{"total": 5}],
            "domain_symptom_index": [],
            "domain_trigger_index": [],
        }
        with patch.object(inference_agent, "neo4j_health", return_value=True), \
             patch.object(inference_agent, "get_driver", return_value=DummyDriver()), \
             patch.object(inference_agent, "_run", side_effect=lambda session, key, uid: data.get(key, [])):
            report = inference_agent.run_inference("isolated-user")
        self.assertIn("说不清的古怪感受", report.unmapped_terms)
        self.assertTrue(any("暂未纳入推断" in f for f in report.factors))


if __name__ == "__main__":
    unittest.main(verbosity=2)
