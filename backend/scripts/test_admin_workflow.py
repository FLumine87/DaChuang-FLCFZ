"""Run with `python scripts/test_admin_workflow.py` from backend/.

Uses an isolated temporary SQLite database; never touches the team's data.
"""
import asyncio
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.db import database as db  # noqa: E402
from app.router import dispatch  # noqa: E402
from app.handlers import personal  # noqa: E402


class AdminWorkflowTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.original_url = settings.DATABASE_URL
        settings.DATABASE_URL = "sqlite:///" + os.path.join(self.tmp.name, "test.db")
        db._local_conn = None
        db.init_db_sync()
        self.admin_id = db.execute(
            "INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)",
            ("admin_test", "unused", "管理员", "admin"))
        self.user_id = db.execute(
            "INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)",
            ("user_test", "unused", "甲", "user"))
        self.other_id = db.execute(
            "INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)",
            ("other_test", "unused", "乙", "user"))
        questionnaire_id = db.execute(
            "INSERT INTO questionnaires (code, name, max_score) VALUES (?, ?, ?)",
            ("PHQ-9", "PHQ-9", 27))
        self.screening_id = db.execute(
            "INSERT INTO screenings (screening_id, user_id, name, questionnaire_id, score, "
            "max_score, status, alert_level, screening_date) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
            ("SCR-TEST-A", self.user_id, "甲", questionnaire_id, 18, 27, "completed", "red"))
        db.execute(
            "INSERT INTO screenings (screening_id, user_id, name, questionnaire_id, score, "
            "status, screening_date) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)",
            ("SCR-TEST-B", self.other_id, "乙", questionnaire_id, 3, "completed"))
        db.execute(
            "INSERT INTO screenings (screening_id, name, questionnaire_id, score, status) "
            "VALUES (?, ?, ?, ?, ?)", ("SEED-LEGACY", "旧样本", questionnaire_id, 5, "completed"))
        db.execute(
            "INSERT INTO alerts (alert_id, screening_id, name, level, status, trigger) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("ALT-TEST", self.screening_id, "甲", "red", "pending", "量表得分"))
        db.execute(
            "INSERT INTO cases (case_id, user_id, name, screening_count, alert_level) "
            "VALUES (?, ?, ?, ?, ?)", ("CASE-TEST", self.user_id, "甲", 1, "red"))

    def tearDown(self):
        if db._local_conn:
            db._local_conn.close()
        db._local_conn = None
        settings.DATABASE_URL = self.original_url
        self.tmp.cleanup()

    async def call(self, method, path, role="admin", payload=None, query=""):
        subject = self.admin_id if role == "admin" else self.user_id
        token = create_access_token({"sub": str(subject), "username": role, "role": role})
        return await dispatch(method, path, query, json.dumps(payload or {}).encode(),
                              {"authorization": f"Bearer {token}"})

    async def test_dashboard_uses_database_counts(self):
        status, response = await self.call("GET", "/api/admin/dashboard")
        self.assertEqual(status, 200)
        stats = response["data"]["stats"]
        self.assertEqual(stats["totalScreenings"], 3)
        self.assertEqual(stats["openAlerts"], 1)
        self.assertEqual(stats["seedRecords"], 1)

    async def test_personal_data_is_owned_and_generic_routes_are_admin_only(self):
        status, response = await self.call("GET", "/api/personal/screenings", role="user")
        self.assertEqual(status, 200)
        self.assertEqual([r["id"] for r in response["data"]], ["SCR-TEST-A"])
        status, response = await self.call("GET", "/api/personal/warnings", role="user")
        self.assertEqual(status, 200)
        self.assertEqual([r["id"] for r in response["data"]], ["ALT-TEST"])
        for path in ("/api/admin/alerts", "/api/alerts", "/api/cases", "/api/screening"):
            status, _ = await self.call("GET", path, role="user")
            self.assertEqual(status, 403, path)
        status, _ = await self.call("POST", "/api/retrieval/search", role="user")
        self.assertEqual(status, 403)

    async def test_registration_cannot_grant_admin_role(self):
        status, response = await self.call("POST", "/api/auth/register", payload={
            "username": "rogue", "password": "safe-test-password", "name": "注册者", "role": "admin"})
        self.assertEqual(status, 200, response)
        self.assertEqual(response["data"]["role"], "user")
        self.assertEqual(db.query_one("SELECT role FROM users WHERE username = 'rogue'")["role"], "user")

    async def test_personal_search_does_not_return_indexed_private_records(self):
        async def fake_search(_data):
            return ([
                {"id": "scr-7", "record_id": "scr-7", "summary": "私有作答"},
                {"id": "corpus-1", "record_id": "corpus-1", "summary": "公开语料"},
            ], {}, "text", None)

        class FakeRag:
            async def generate_report(self, _input):
                return {"risk_level": "green"}

        original_search, original_rag = personal.perform_search, personal.get_rag_engine
        personal.perform_search = fake_search
        personal.get_rag_engine = lambda: FakeRag()
        try:
            status, response = await self.call("POST", "/api/personal/search", role="user",
                                               payload={"query": "测试"})
            self.assertEqual(status, 200, response)
            self.assertEqual([hit["id"] for hit in response["data"]["results"]], ["corpus-1"])
        finally:
            personal.perform_search, personal.get_rag_engine = original_search, original_rag

    async def test_alert_transition_audit_and_repeat_request(self):
        status, response = await self.call("PUT", "/api/admin/alerts/ALT-TEST", payload={
            "status": "processing", "assignee_id": self.admin_id, "follow_up_notes": "已接手"})
        self.assertEqual(status, 200, response)
        self.assertEqual(response["data"]["assignee"], "管理员")
        status, response = await self.call("PUT", "/api/admin/alerts/ALT-TEST", payload={
            "status": "processing", "assignee_id": self.admin_id})
        self.assertEqual(status, 200, response)
        self.assertEqual(len(response["data"]["history"]), 1)
        status, _ = await self.call("PUT", "/api/admin/alerts/ALT-TEST", payload={
            "status": "resolved"})
        self.assertEqual(status, 400)
        status, response = await self.call("PUT", "/api/admin/alerts/ALT-TEST", payload={
            "status": "resolved", "follow_up_notes": "已完成复核"})
        self.assertEqual(status, 200, response)
        self.assertEqual(len(response["data"]["history"]), 2)
        status, response = await self.call("PUT", "/api/admin/alerts/ALT-TEST", payload={
            "status": "closed"})
        self.assertEqual(status, 200, response)
        self.assertEqual(response["data"]["status"], "closed")
        status, _ = await self.call("PUT", "/api/admin/alerts/ALT-TEST", payload={
            "status": "processing"})
        self.assertEqual(status, 409)

    async def test_case_detail_and_follow_up(self):
        status, listing = await self.call("GET", "/api/admin/cases", query="keyword=CASE-TEST")
        self.assertEqual(status, 200, listing)
        self.assertEqual([case["id"] for case in listing["data"]["items"]], ["CASE-TEST"])
        status, response = await self.call("GET", "/api/admin/cases/CASE-TEST")
        self.assertEqual(status, 200, response)
        self.assertEqual([s["id"] for s in response["data"]["screenings"]], ["SCR-TEST-A"])
        self.assertEqual({event["type"] for event in response["data"]["timeline"]},
                         {"screening", "alert"})
        status, response = await self.call("POST", "/api/admin/cases/CASE-TEST/timeline",
                                           payload={"title": "回访", "description": "已联系"})
        self.assertEqual(status, 200, response)
        self.assertIn("回访", [event["title"] for event in response["data"]["timeline"]])
        status, response = await self.call("PUT", "/api/admin/cases/CASE-TEST",
                                           payload={"status": "monitoring", "notes": "每周联系"})
        self.assertEqual(status, 200, response)
        self.assertIn("案例状态更新", [event["title"] for event in response["data"]["timeline"]])
        status, _ = await self.call("POST", "/api/admin/cases/CASE-TEST/timeline",
                                    payload={"title": "", "description": ""})
        self.assertEqual(status, 400)

    async def test_personal_submission_uses_answers_and_account_owner(self):
        # Browser-supplied score/level and name cannot forge the result or ownership.
        safe_answers = {str(index): 0 for index in range(1, 10)}
        status, response = await self.call("POST", "/api/personal/screenings", role="user",
                                           payload={"questionnaire": "PHQ-9", "answers": safe_answers,
                                                    "score": 27, "level": "red", "name": "乙"})
        self.assertEqual(status, 200, response)
        screening = db.query_one("SELECT * FROM screenings WHERE screening_id = ?",
                                 (response["data"]["id"],))
        self.assertEqual(screening["user_id"], self.user_id)
        self.assertEqual(screening["name"], "甲")
        self.assertEqual(screening["score"], 0)
        self.assertEqual(screening["alert_level"], "green")
        self.assertEqual(db.query_one("SELECT COUNT(*) AS c FROM alerts WHERE screening_id = ?",
                                      (screening["id"],))["c"], 0)
        case = db.query_one("SELECT * FROM cases WHERE user_id = ?", (self.user_id,))
        self.assertEqual(case["screening_count"], 2)

        risky_answers = {str(index): 2 for index in range(1, 10)}
        status, response = await self.call("POST", "/api/personal/screenings", role="user",
                                           payload={"questionnaire": "PHQ-9", "answers": risky_answers,
                                                    "score": 0, "level": "green"})
        self.assertEqual(status, 200, response)
        self.assertEqual(response["data"]["riskLevel"], "red")
        status, response = await self.call("GET", "/api/personal/warnings", role="user")
        self.assertEqual(status, 200)
        self.assertEqual(len(response["data"]), 2)

        status, _ = await self.call("POST", "/api/personal/screenings", role="user",
                                    payload={"questionnaire": "PHQ-9", "answers": {"1": 3}})
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()
