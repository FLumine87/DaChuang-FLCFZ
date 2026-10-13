import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from urllib.parse import quote

from app.core.exceptions import HttpError
from app.core.security import create_access_token
from app.db import database as db
from app.services import agent_workspace as service
from app.services import agent_individual
from app.router import dispatch


class WorkspaceTests(unittest.IsolatedAsyncioTestCase):
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

    def headers(self, role="admin"):
        return {"Authorization": "Bearer " + create_access_token(
            {"username": "test-admin", "role": role})}

    async def test_authentication_and_role(self):
        for method, path in [
            ("GET", "/api/agent-workspace"), ("POST", "/api/agent-workspace/runs"),
            ("GET", "/api/agent-workspace/cases/demo%3A001"),
            ("PUT", "/api/agent-workspace/tasks/test"),
        ]:
            self.assertEqual((await dispatch(method, path))[0], 401)
            self.assertEqual((await dispatch(method, path, headers=self.headers("user")))[0], 403)

    async def test_demo_counts_dedup_and_namespace(self):
        first = await service.run("demo", 30, "all", "tester")
        self.assertEqual(first["latest_run"]["total"], 24)
        self.assertEqual(first["latest_run"]["records"], 72)
        self.assertEqual(first["latest_run"]["distribution"],
                         {"red": 2, "orange": 4, "yellow": 6, "green": 12})
        self.assertEqual(len(first["tasks"]), 12)
        second = await service.run("demo", 30, "all", "tester")
        self.assertEqual(len(second["tasks"]), 12)
        self.assertEqual(second["latest_run"]["trace"][-1]["count"], 0)
        self.assertEqual((await service.overview("live"))["tasks"], [])

    async def test_filters_and_latest_run(self):
        await service.run("demo", 30, "all", "tester")
        narrowed = await service.run("demo", 7, "信息学院", "tester")
        self.assertEqual(narrowed["latest_run"]["total"], 8)
        self.assertEqual(narrowed["latest_run"]["records"], 16)
        empty = await service.run("demo", 7, "不存在", "tester")
        self.assertEqual(empty["latest_run"]["total"], 0)
        self.assertEqual(empty["latest_run"]["distribution"], {})

    async def test_task_lifecycle_persisted_to_disk(self):
        task = (await service.run("demo", 30, "all", "tester"))["tasks"][0]
        changed = await service.update_task(task["id"], {
            "action": "modify", "version": 0, "title": "安排复核（测试）",
            "assignee": "测试老师", "due_at": "2026-10-20", "note": "调整期限",
        }, "tester")
        self.assertEqual(changed["version"], 1)
        # A distinct database connection must see the change immediately.
        with closing(sqlite3.connect(self.path)) as independent:
            self.assertEqual(independent.execute(
                "SELECT title FROM agent_workspace_tasks WHERE id=?", (task["id"],)
            ).fetchone()[0], "安排复核（测试）")
        recorded = await service.update_task(task["id"], {
            "action": "followup", "version": 1, "note": "完成首次联系",
        }, "tester")
        self.assertEqual(recorded["state"], "modified")
        completed = await service.update_task(task["id"], {
            "action": "complete", "version": 2, "note": "已复核并登记",
        }, "tester")
        self.assertEqual(completed["state"], "completed")
        self.assertEqual(len(completed["events"]), 4)
        await service.run("demo", 30, "all", "tester")
        self.assertEqual(next(t for t in (await service.overview("demo"))["tasks"]
                              if t["id"] == task["id"])["state"], "completed")

    async def test_conflicts_and_required_fields(self):
        task = (await service.run("demo", 30, "all", "tester"))["tasks"][0]
        for data, status in [
            ({"action": "confirm", "version": 0}, 400),
            ({"action": "reject", "version": 0}, 400),
            ({"action": "complete", "version": 0, "note": "x"}, 409),
            ({"action": "confirm", "version": 8, "assignee": "test"}, 409),
        ]:
            with self.assertRaises(HttpError) as caught:
                await service.update_task(task["id"], data, "tester")
            self.assertEqual(caught.exception.status_code, status)
        await service.update_task(task["id"], {
            "action": "reject", "version": 0, "note": "不适用",
        }, "tester")
        with self.assertRaises(HttpError):
            await service.update_task(task["id"], {
                "action": "confirm", "version": 1, "assignee": "test",
            }, "tester")

    async def test_encoded_routes_and_materials(self):
        result = await service.run("demo", 30, "all", "tester")
        status, payload = await dispatch(
            "GET", "/api/agent-workspace/cases/demo%3A001", "scope=demo",
            headers=self.headers())
        self.assertEqual(status, 200)
        self.assertEqual(len(payload["data"]["materials"]), 3)
        task = result["tasks"][0]
        status, _ = await dispatch(
            "PUT", "/api/agent-workspace/tasks/" + quote(task["id"], safe=""),
            body=json.dumps({"action": "confirm", "version": 0, "assignee": "tester"}).encode(),
            headers=self.headers())
        self.assertEqual(status, 200)

    async def test_live_records_do_not_merge_by_name(self):
        db.execute("INSERT INTO questionnaires (id,code,name,max_score) VALUES(1,'test','test',27)")
        for i in range(2):
            db.execute(
                "INSERT INTO screenings(screening_id,name,questionnaire_id,score,max_score,status,screening_date) "
                "VALUES(?, 'same-name',1,10,27,'completed',?)",
                (f"test-{i}", f"2026-10-0{i+1}"))
        subjects = service.compile_subjects(await service.records_for("live"))
        self.assertEqual(len(subjects), 2)
        self.assertTrue(all(s["delta"] is None for s in subjects))
        self.assertTrue(all(not s["linked"] for s in subjects))

    async def test_different_scales_are_not_compared(self):
        records = service.demo_records()[:3]
        records[2]["questionnaire_id"] = "different-scale"
        self.assertIsNone(service.compile_subjects(records)[0]["delta"])

    async def test_individual_assessment_preserves_group_run(self):
        group = await service.run("demo", 30, "all", "tester")
        individual = await agent_individual.run("demo", "demo:001", "tester")
        self.assertIsNotNone(individual["assessment"])
        self.assertEqual(len(individual["assessment"]["trace"]), 4)
        refreshed = await agent_individual.detail("demo", "demo:001")
        self.assertEqual(individual["assessment"]["id"], refreshed["assessment"]["id"])
        self.assertEqual((await service.overview("demo"))["latest_run"]["id"], group["latest_run"]["id"])
        self.assertEqual(len((await service.overview("demo"))["tasks"]), 12)

    async def test_followup_changes_next_date_and_preserves_audit(self):
        task = (await service.run("demo", 30, "all", "tester"))["tasks"][0]
        await service.update_task(task["id"], {"action": "confirm", "version": 0, "assignee": "tester"}, "tester")
        modified = await service.update_task(task["id"], {
            "action": "modify", "version": 1, "assignee": "tester2", "due_at": "2026-10-21",
        }, "tester")
        self.assertEqual(modified["assignee"], "tester2")
        followed = await service.update_task(task["id"], {
            "action": "followup", "version": 2, "due_at": "2026-10-25", "note": "test followup",
        }, "tester")
        self.assertEqual(followed["due_at"], "2026-10-25")
        self.assertEqual(len(followed["events"]), 4)


if __name__ == "__main__":
    unittest.main()
