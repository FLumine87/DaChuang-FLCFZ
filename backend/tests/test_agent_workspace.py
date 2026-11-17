import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from urllib.parse import quote
from unittest.mock import AsyncMock, patch

from app.core.exceptions import HttpError
from app.core.security import create_access_token
from app.db import database as db
from app.services import agent_workspace as service
from app.services import agent_individual, agent_model
from app.router import dispatch


class WorkspaceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.previous = db._local_conn
        self.temp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.temp.name, "test.db")
        db._local_conn = sqlite3.connect(self.path, check_same_thread=False)
        db._local_conn.row_factory = sqlite3.Row
        db.init_db_sync()
        # 测试默认不触碰真实模型：需要模型结果的用例在自己的 with 块里覆盖。
        self._configured = patch.object(agent_model, "configured", return_value=False)
        self._configured.start()
        self.addCleanup(self._configured.stop)

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
            ("GET", "/api/agent-workspace/model"), ("PUT", "/api/agent-workspace/model"),
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
        propose = next(step for step in second["latest_run"]["trace"]
                       if step["tool"] == "propose_tasks")
        self.assertEqual(propose["count"], 0)
        self.assertEqual((await service.overview("live"))["tasks"], [])

    async def test_group_run_attaches_ai_summary(self):
        generated = {
            "status": "generated", "model": "deepseek-flash", "latency_ms": 12,
            "generated_at": "2026-10-01T00:00:00+00:00",
            "summary": {"overview": "总体平稳", "key_findings": ["红色预警 1 个"],
                        "anomalies": [], "department_focus": [],
                        "suggested_actions": ["安排复核"], "limits": ["样本量较小"]},
        }
        with patch("app.services.agent_ai.group_analysis",
                   AsyncMock(return_value=generated)):
            result = await service.run("demo", 30, "all", "tester")
        latest = result["latest_run"]
        self.assertEqual(latest["ai_summary"]["status"], "generated")
        self.assertEqual(latest["ai_summary"]["summary"]["overview"], "总体平稳")
        self.assertEqual(latest["trace"][-1]["tool"], "llm_group_summary")
        self.assertEqual(latest["trace"][-1]["summary"], "AI 已生成群体总结")

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
        with patch.object(agent_model, "configured", return_value=False):
            individual = await agent_individual.run("demo", "demo:001", "tester")
        self.assertIsNotNone(individual["assessment"])
        self.assertEqual(len(individual["assessment"]["trace"]), 5)
        refreshed = await agent_individual.detail("demo", "demo:001")
        self.assertEqual(individual["assessment"]["id"], refreshed["assessment"]["id"])
        self.assertEqual((await service.overview("demo"))["latest_run"]["id"], group["latest_run"]["id"])
        self.assertEqual(len((await service.overview("demo"))["tasks"]), 12)

    async def test_ai_draft_is_validated_and_persisted_separately(self):
        draft = {
            "summary": "同量表分数有变化",
            "observations": ["最近一次为红色预警", "同量表较上次上升"],
            "multimodal_notes": ["文本补充记录了学习压力"],
            "risk_points": ["请核对原始作答"],
            "recommendations": ["安排授权人员复核"],
            "evidence_refs": ["S1", "M1"],
        }
        response = {"model": "test-model", "choices": [{"finish_reason": "stop", "message": {
            "content": json.dumps(draft, ensure_ascii=False)
        }}]}
        with patch.multiple(agent_model.settings, AGENT_DEMO_DEEPSEEK_ENABLED=True,
                            ENABLE_MOCK_ENGINES=False, DEEPSEEK_API_KEY="test-key",
                            DEEPSEEK_BASE_URL="https://zhenze-huhehaote.cmecloud.cn/v1"), \
                patch.object(agent_model, "configured", return_value=True), \
                patch.object(agent_model, "_complete", AsyncMock(return_value=response)) as complete:
            case = await agent_individual.run("demo", "demo:001", "tester")
            assessment = case["assessment"]
            self.assertEqual(assessment["model_status"], "generated")
            self.assertEqual(assessment["model_draft"]["evidence_refs"], ["S1", "M1"])
            self.assertEqual(case["alert_level"], "red")
            self.assertEqual(case["tasks"][0]["state"], "proposed")
            self.assertNotIn("请核对原始作答", case["tasks"][0]["title"])
            self.assertEqual((await agent_individual.detail("demo", "demo:001"))["assessment"], assessment)
            request = complete.call_args.args[0]
            self.assertEqual(request["thinking"], {"type": "disabled"})
            self.assertEqual(request["max_tokens"], 2048)
            prompt = json.loads(request["messages"][1]["content"])
            self.assertIn("multimodal", prompt)
            self.assertIn("screenings", prompt)
            self.assertNotIn("演示案例 001", json.dumps(prompt, ensure_ascii=False))

    async def test_invalid_deepseek_citation_falls_back_to_rules(self):
        response = {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps({
            "summary": "摘要", "review_points": ["待核实"], "evidence_refs": ["invented"]
        })}}]}
        with patch.object(agent_model, "configured", return_value=True), \
                patch.object(agent_model, "_complete", AsyncMock(return_value=response)):
            case = await agent_individual.run("demo", "demo:001", "tester")
        self.assertEqual(case["assessment"]["model_status"], "unavailable")
        self.assertNotIn("model_draft", case["assessment"])
        self.assertEqual(case["tasks"][0]["state"], "proposed")

    async def test_business_case_opens_and_calls_model_without_identifiers(self):
        db.execute("INSERT INTO questionnaires (id,code,name,max_score) VALUES(1,'test','test',27)")
        db.execute("INSERT INTO cases(id,case_id,name) VALUES(1,'CASE-TEST','test-person')")
        db.execute(
            "INSERT INTO screenings(screening_id,name,case_id,questionnaire_id,score,max_score,status,screening_date) "
            "VALUES('SCR-TEST','test-person',1,1,10,27,'completed','2026-10-01')")
        response = {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps({
            "summary": "最近一次筛查为黄色预警，需安排复核。",
            "observations": ["得分 10/27"],
            "multimodal_notes": [],
            "risk_points": ["核对原始量表"],
            "recommendations": ["安排复核"],
            "evidence_refs": ["S1"],
        }, ensure_ascii=False)}}]}
        with patch.object(agent_model, "configured", return_value=True), \
                patch.object(agent_model, "_complete", AsyncMock(return_value=response)) as complete:
            case = await agent_individual.run("live", "screening-code:SCR-TEST", "tester")
        complete.assert_awaited_once()
        self.assertEqual(case["subject"], "case:1")
        self.assertEqual(case["assessment"]["model_status"], "generated")
        self.assertEqual(case["assessmentState"]["status"], "current")
        prompt = json.dumps(complete.call_args.args[0]["messages"], ensure_ascii=False)
        self.assertNotIn("test-person", prompt)
        self.assertNotIn("SCR-TEST", prompt)

    async def test_model_switch_defaults_on_and_persists(self):
        self.assertTrue((await agent_model.availability())["enabled"])
        await agent_model.set_enabled(False, "tester")
        self.assertFalse((await agent_model.availability())["enabled"])
        with patch.object(agent_model, "configured", return_value=True), \
                patch.object(agent_model, "_complete", AsyncMock()) as complete:
            case = await agent_individual.run("demo", "demo:001", "tester")
        complete.assert_not_awaited()
        self.assertEqual(case["assessment"]["model_status"], "disabled")
        await agent_model.set_enabled(True, "tester")
        self.assertTrue((await agent_model.availability())["enabled"])

    async def test_model_switch_endpoint(self):
        status, payload = await dispatch(
            "GET", "/api/agent-workspace/model", headers=self.headers())
        self.assertEqual(status, 200)
        self.assertTrue(payload["data"]["enabled"])
        status, payload = await dispatch(
            "PUT", "/api/agent-workspace/model", body=json.dumps({"enabled": False}).encode(),
            headers=self.headers())
        self.assertEqual(status, 200)
        self.assertFalse(payload["data"]["enabled"])
        status, _ = await dispatch(
            "PUT", "/api/agent-workspace/model", body=json.dumps({"enabled": "false"}).encode(),
            headers=self.headers())
        self.assertEqual(status, 400)

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
