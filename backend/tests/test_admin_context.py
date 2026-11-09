import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.core.auth import RequestContext
from app.core.security import create_access_token
from app.db import database as db
from app.handlers import admin
from app.router import dispatch
from app.services import agent_individual, agent_workspace, case_context, case_service


class AdminContextTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.previous = db._local_conn
        self.tmp = tempfile.TemporaryDirectory()
        db._local_conn = sqlite3.connect(str(Path(self.tmp.name) / "test.db"), check_same_thread=False)
        db._local_conn.row_factory = sqlite3.Row
        db.init_db_sync()
        self.uid = db.execute("INSERT INTO users(username,password_hash,name,role) VALUES('context-user','unused','同名','user')")
        self.other = db.execute("INSERT INTO users(username,password_hash,name,role) VALUES('context-other','unused','同名','user')")
        self.case = db.execute("INSERT INTO cases(case_id,user_id,name) VALUES('CASE-CONTEXT',?,'同名')", (self.uid,))
        self.q = db.execute("INSERT INTO questionnaires(code,name,max_score) VALUES('context-scale','量表',27)")
        self.sid = db.execute(
            "INSERT INTO screenings(screening_id,user_id,name,questionnaire_id,score,max_score,status,alert_level,screening_date) "
            "VALUES('SCR-CONTEXT',?,'同名',?,18,27,'completed','red',CURRENT_TIMESTAMP)", (self.uid, self.q))

    def tearDown(self):
        db._local_conn.close()
        db._local_conn = self.previous
        self.tmp.cleanup()

    async def test_account_fallback_unifies_admin_agent_and_independent_evidence(self):
        db.execute("INSERT INTO alerts(alert_id,user_id,name,level) VALUES('ALT-INDEPENDENT',?,'同名','orange')", (self.uid,))
        db.execute("INSERT INTO screening_supplements(user_id,kind,text) VALUES(?,'text','独立采集')", (self.uid,))
        db.execute("INSERT INTO screening_supplements(user_id,kind,text) VALUES(?,'text','其他人材料')", (self.other,))
        detail = (await admin.get_admin_case_detail(RequestContext("GET", "/"), "CASE-CONTEXT"))["data"]
        self.assertEqual([a["id"] for a in detail["alerts"]], ["ALT-INDEPENDENT"])
        self.assertEqual(len(detail["supplements"]), 1)
        self.assertEqual(detail["screeningCount"], 1)
        listing = (await admin.get_admin_cases(RequestContext("GET", "/")))["data"]["items"]
        self.assertEqual(listing[0]["screeningCount"], 1)
        self.assertIn("supplement", {e["type"] for e in detail["timeline"]})
        agent = await agent_workspace.case_detail("live", "CASE-CONTEXT")
        self.assertEqual(agent["subject"], detail["agentSubject"])
        self.assertEqual([s["id"] for s in agent["history"]], [self.sid])
        self.assertEqual(agent["materials"][0]["text"], "独立采集")
        self.assertIn("text", agent["media"])

    async def test_ambiguous_or_conflicting_links_are_not_merged(self):
        db.execute("INSERT INTO cases(case_id,user_id,name) VALUES('CASE-AMBIGUOUS',?,'同名')", (self.uid,))
        detail = await case_context.load(db.query_one("SELECT * FROM cases WHERE id=?", (self.case,)))
        self.assertTrue(detail["ambiguous"])
        self.assertEqual(detail["screenings"], [])
        await case_service.sync_personal_case(self.uid, db.query_one("SELECT * FROM screenings WHERE id=?", (self.sid,)))
        self.assertIsNone(db.query_one("SELECT case_id FROM screenings WHERE id=?", (self.sid,))["case_id"])
        self.assertFalse((await agent_workspace.records_for("live"))[0]["linked"])
        db.execute("UPDATE screenings SET case_id=?,user_id=? WHERE id=?", (self.case, self.other, self.sid))
        self.assertEqual((await case_context.load(db.query_one("SELECT * FROM cases WHERE id=?", (self.case,))))["screenings"], [])
        self.assertFalse((await agent_workspace.records_for("live"))[0]["linked"])

    async def test_new_screening_writes_case_link(self):
        await case_service.sync_personal_case(self.uid, db.query_one("SELECT * FROM screenings WHERE id=?", (self.sid,)))
        self.assertEqual(db.query_one("SELECT case_id FROM screenings WHERE id=?", (self.sid,))["case_id"], self.case)

    async def test_snapshot_detects_added_edited_removed_evidence_and_preserves_reports(self):
        first = await agent_individual.run("live", "CASE-CONTEXT", "tester")
        self.assertEqual(first["assessmentState"]["status"], "current")
        sup = db.execute("INSERT INTO screening_supplements(user_id,kind,text) VALUES(?,'text','新材料')", (self.uid,))
        refreshed = await agent_individual.detail("live", f"case:{self.case}")
        self.assertEqual(refreshed["assessmentState"]["newRecords"], 1)
        self.assertEqual(refreshed["assessment"]["id"], first["assessment"]["id"])
        second = await agent_individual.run("live", "CASE-CONTEXT", "tester")
        self.assertEqual(second["assessmentState"]["status"], "current")
        db.execute("UPDATE screening_supplements SET text='修改内容' WHERE id=?", (sup,))
        self.assertEqual((await case_context.assessment_state(f"case:{self.case}"))["changedRecords"], 1)
        db.execute("DELETE FROM screening_supplements WHERE id=?", (sup,))
        self.assertEqual((await case_context.assessment_state(f"case:{self.case}"))["removedRecords"], 1)
        self.assertEqual(db.query_one("SELECT COUNT(*) AS c FROM agent_workspace_case_runs")["c"], 2)
        admin_detail = (await admin.get_admin_case_detail(RequestContext("GET", "/"), "CASE-CONTEXT"))["data"]
        self.assertTrue(all("T" not in e["date"] for e in admin_detail["timeline"]))

    async def test_legacy_report_is_unknown(self):
        await agent_individual.ensure_schema()
        db.execute("INSERT INTO agent_workspace_case_runs VALUES('legacy','live',?,'tester','2026-01-01',?)",
                   (f"case:{self.case}", json.dumps({"summary": "旧报告"})))
        self.assertEqual((await case_context.assessment_state(f"case:{self.case}"))["status"], "unknown")

    async def test_mock_collection_is_saved_without_business_risk_alerts(self):
        from app import engines
        from app.engines.hashing.mock_engine import MockHashingEngine
        from app.handlers import personal
        original = engines._HASHING_ENGINE
        engines._HASHING_ENGINE = MockHashingEngine()
        try:
            sup = db.execute("INSERT INTO screening_supplements(user_id,kind,text) VALUES(?,'text','验收')", (self.uid,))
            ctx = RequestContext("POST", "/")
            ctx.user = {"sub": str(self.uid), "role": "user"}
            report = await personal._analyze_collection(ctx, sup, "text",
                                                         {"text": "验收"}, self.uid, None)
            self.assertEqual(report["levelLabel"], "未评估")
            self.assertFalse(report["isAlert"])
            self.assertEqual(db.query_one("SELECT COUNT(*) AS c FROM alerts")["c"], 0)
            self.assertIsNotNone(db.query_one("SELECT analysis FROM screening_supplements WHERE id=?", (sup,))["analysis"])
        finally:
            engines._HASHING_ENGINE = original

    async def test_work_queue_full_counts_scope_and_permissions(self):
        await agent_workspace.ensure_schema()
        today = datetime.now(timezone(timedelta(hours=8))).date()
        for i, (scope, state, due) in enumerate([
            ("live", "proposed", today), ("live", "confirmed", today - timedelta(days=1)),
            ("live", "completed", today - timedelta(days=1)), ("demo", "proposed", today),
        ]):
            db.execute("INSERT INTO agent_workspace_tasks(id,scope,subject,kind,title,state,due_at,events,created_at,updated_at) "
                       "VALUES(?,?,?,?,?,?,?,?,?,?)", (f"t{i}", scope, f"case:{self.case}", str(i), "跟进", state,
                                                     due.isoformat(), "[]", "2026-01-01", "2026-01-01"))
        for i in range(55):
            db.execute("INSERT INTO alerts(alert_id,name,level,status) VALUES(?,'同名','orange','pending')", (f"ALT-{i}",))
        headers = {"Authorization": "Bearer " + create_access_token({"username": "tester", "role": "admin"})}
        status, response = await dispatch("GET", "/api/admin/work-queue", headers=headers)
        self.assertEqual(status, 200, response)
        data = response["data"]
        self.assertEqual((data["dueToday"], data["overdue"], data["pendingReview"]), (1, 1, 1))
        self.assertEqual(data["unassignedAlerts"], 55)
        self.assertEqual(len(data["tasks"]), 2)
        self.assertTrue(all(t["caseId"] == "CASE-CONTEXT" for t in data["tasks"]))
        self.assertEqual((await dispatch("GET", "/api/admin/work-queue"))[0], 401)
        headers["Authorization"] = "Bearer " + create_access_token({"username": "tester", "role": "user"})
        self.assertEqual((await dispatch("GET", "/api/admin/work-queue", headers=headers))[0], 403)
