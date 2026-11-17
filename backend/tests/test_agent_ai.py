import json
import os
import sqlite3
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from app.db import database as db
from app.services import agent_ai, agent_model


def group_run():
    return {
        "days": 30, "department": "all",
        "total": 5, "records": 7, "priority_count": 3, "unlinked_count": 1,
        "distribution": {"red": 1, "orange": 1, "yellow": 1, "green": 2},
        "subjects": [
            {"subject": "case:123", "name": "张三", "phone": "13800138000",
             "department": "大院系", "alert_level": "red", "score": 20,
             "max_score": 27, "delta": 4, "media": ["text", "audio"],
             "reasons": ["最近一次已记录为红色预警"], "evidence_ids": [1, 2]},
            {"subject": "case:124", "department": "大院系", "alert_level": "orange",
             "score": 16, "max_score": 27, "delta": 2, "media": ["image"],
             "reasons": ["同量表较上次上升 2 分"], "evidence_ids": [3]},
            {"subject": "case:125", "department": "大院系", "alert_level": "yellow",
             "score": 9, "max_score": 27, "delta": -1, "media": [],
             "reasons": [], "evidence_ids": [4]},
            {"subject": "screening:200", "department": "小院系", "alert_level": "green",
             "score": 2, "max_score": 27, "delta": None, "media": [], "reasons": []},
            {"subject": "screening:201", "department": "小院系", "alert_level": "green",
             "score": 3, "max_score": 27, "delta": 1, "media": [], "reasons": []},
        ],
    }


def individual_case():
    return {
        "subject": "case:123", "name": "张三", "phone": "13800138000",
        "case_id": "C-001", "evidence_ids": [1, 2], "department": "信息学院",
        "alert_level": "orange", "score": 16, "max_score": 27, "delta": 3,
        "history": [
            {"questionnaire": "PHQ-9", "score": 16, "max_score": 27,
             "alert_level": "orange", "date": "2026-10-01", "questionnaire_id": 1},
            {"questionnaire": "PHQ-9", "score": 13, "max_score": 27,
             "alert_level": "yellow", "date": "2026-09-01", "questionnaire_id": 1},
        ],
        "materials": [
            {"kind": "text", "text": "最近睡不好，联系电话 13800138000",
             "analysis": {"level": "yellow", "conclusion": "睡眠困扰",
                          "hits": [{}, {}]}},
            {"kind": "audio", "description": "上周的日记朗读", "url": "/uploads/a.wav"},
            {"kind": "image", "filename": "张三.jpg"},
        ],
        "missing": ["语音和图片未做心理状态自动判定"],
    }


VALID_DRAFT = {
    "summary": "最近一次为橙色预警，同量表较上次上升 3 分。",
    "observations": ["最近一次筛查为橙色", "同量表较上次上升 3 分"],
    "multimodal_notes": ["文本补充提到睡眠困扰", "语音片段为日记朗读"],
    "risk_points": ["需要核对睡眠变化持续时间"],
    "recommendations": ["安排授权人员复核", "核对原始量表"],
    "evidence_refs": ["S1", "M1"],
}

VALID_GROUP = {
    "overview": "本窗口共 5 个对象，3 个进入关注范围，整体以黄色及以上预警为主。",
    "key_findings": ["红色预警 1 个", "橙色预警 1 个"],
    "anomalies": ["大院系橙红预警占比偏高"],
    "department_focus": ["大院系需要重点关注"],
    "suggested_actions": ["优先安排复核", "核对近期筛查变化"],
    "limits": ["样本量较小，不能外推"],
}


class InputTests(unittest.TestCase):
    def test_group_input_deidentifies(self):
        payload = agent_ai.build_group_input(group_run())
        dumped = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn("case:123", dumped)
        self.assertNotIn("screening:200", dumped)
        self.assertNotIn("13800138000", dumped)
        self.assertNotIn("张三", dumped)
        self.assertNotIn("evidence_ids", dumped)
        names = [item["name"] for item in payload["departments"]]
        self.assertIn("大院系", names)
        self.assertIn("其他", names)
        self.assertNotIn("小院系", names)
        self.assertEqual(payload["trend"], {"rising": 3, "flat": 0,
                                            "falling": 1, "no_history": 1})

    def test_individual_input_excludes_identifiers(self):
        payload = agent_ai.build_individual_input(individual_case())
        dumped = json.dumps(payload, ensure_ascii=False)
        self.assertNotIn("case:123", dumped)
        self.assertNotIn("13800138000", dumped)
        self.assertNotIn("张三", dumped)
        for key in ("name", "phone", "case_id", "evidence_ids", "department"):
            self.assertNotIn(key, payload)
        self.assertIn("[电话已隐去]", payload["multimodal"][0]["content"])
        self.assertEqual(payload["coverage"], {"text": 1, "audio": 1, "image": 1})
        self.assertEqual(payload["screenings"][0]["ref"], "S1")


class AnalysisTests(unittest.IsolatedAsyncioTestCase):
    async def test_individual_analysis_uses_multimodal(self):
        chat = AsyncMock(return_value=VALID_DRAFT)
        with patch.object(agent_model, "configured", return_value=True), \
                patch.object(agent_model, "enabled", AsyncMock(return_value=True)), \
                patch.object(agent_model, "chat_json", chat), \
                patch.object(agent_ai, "_audit", AsyncMock()):
            result = await agent_ai.individual_analysis("live", individual_case())
        self.assertEqual(result["status"], "generated")
        self.assertEqual(result["draft"]["evidence_refs"], ["S1", "M1"])
        prompt = chat.await_args.args[0][1]["content"]
        self.assertIn("语音片段", prompt)
        self.assertIn("图片", prompt)
        self.assertIn("文本补充", prompt)
        self.assertNotIn("13800138000", prompt)

    async def test_group_analysis_success(self):
        chat = AsyncMock(return_value=VALID_GROUP)
        with patch.object(agent_model, "configured", return_value=True), \
                patch.object(agent_model, "enabled", AsyncMock(return_value=True)), \
                patch.object(agent_model, "chat_json", chat), \
                patch.object(agent_ai, "_audit", AsyncMock()):
            result = await agent_ai.group_analysis("live", group_run())
        self.assertEqual(result["status"], "generated")
        self.assertEqual(result["summary"]["anomalies"], ["大院系橙红预警占比偏高"])
        prompt = chat.await_args.args[0][1]["content"]
        self.assertNotIn("case:123", prompt)

    async def test_group_analysis_failure_falls_back(self):
        with patch.object(agent_model, "configured", return_value=True), \
                patch.object(agent_model, "enabled", AsyncMock(return_value=True)), \
                patch.object(agent_model, "chat_json", AsyncMock(side_effect=ValueError("bad json"))), \
                patch.object(agent_ai, "_audit", AsyncMock()) as audit:
            result = await agent_ai.group_analysis("live", group_run())
        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result.get("summary"))
        self.assertEqual(audit.await_args.args[3], "unavailable")

    async def test_disabled_model_skips_call(self):
        chat = AsyncMock()
        with patch.object(agent_model, "configured", return_value=True), \
                patch.object(agent_model, "enabled", AsyncMock(return_value=False)), \
                patch.object(agent_model, "chat_json", chat):
            result = await agent_ai.group_analysis("live", group_run())
        self.assertEqual(result["status"], "disabled")
        chat.assert_not_awaited()


class AuditTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.previous = db._local_conn
        self.temp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.temp.name, "test.db")
        db._local_conn = sqlite3.connect(self.path, check_same_thread=False)
        db._local_conn.row_factory = sqlite3.Row
        db.init_db_sync()

    def tearDown(self):
        db._local_conn.close()
        db._local_conn = self.previous
        self.temp.cleanup()

    async def test_model_call_audited(self):
        with patch.object(agent_model, "configured", return_value=True), \
                patch.object(agent_model, "enabled", AsyncMock(return_value=True)), \
                patch.object(agent_model, "chat_json", AsyncMock(return_value=VALID_GROUP)):
            await agent_ai.group_analysis("live", group_run())
        row = await db.query_one_a(
            "SELECT purpose, status, model FROM agent_model_calls")
        self.assertEqual(row["purpose"], "group")
        self.assertEqual(row["status"], "generated")
        self.assertTrue(row["model"])
