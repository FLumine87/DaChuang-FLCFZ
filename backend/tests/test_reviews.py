import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.core.security import create_access_token
from app.db import database as db
from app.router import dispatch
from app.services import agent_workspace, review_requests_service as review_service


class ReviewTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.previous = db._local_conn
        self.tmp = tempfile.TemporaryDirectory()
        db._local_conn = sqlite3.connect(str(Path(self.tmp.name) / "reviews.db"), check_same_thread=False)
        db._local_conn.row_factory = sqlite3.Row
        db.init_db_sync()
        self.staff = db.query_one("SELECT id FROM users WHERE username='adminer'")["id"]
        self.uid = db.execute("INSERT INTO users(username,password_hash,name,role) VALUES('review-user','unused','测试成员','user')")
        self.other = db.execute("INSERT INTO users(username,password_hash,name,role) VALUES('review-other','unused','其他成员','user')")
        self.case = db.execute("INSERT INTO cases(case_id,user_id,name) VALUES('CASE-REVIEW',?,'测试成员')", (self.uid,))
        db.execute("INSERT INTO questionnaires(code,name,max_score) VALUES('PHQ-9','PHQ-9',27)")
        await agent_workspace.ensure_schema()
        await review_service.ensure_schema()
        db.execute("INSERT INTO agent_workspace_tasks(id,scope,subject,kind,title,state,assignee,due_at,events,created_at,updated_at) "
                   "VALUES('task-live','live',?,'review','内部敏感标题','confirmed','咨询师','2026-12-01',?,'2026-11-06','2026-11-06')",
                   (f"case:{self.case}", json.dumps([{"note": "内部敏感备注"}])))
        self.payload = {"task_id": "task-live", "title": "请完成复查", "instructions": "请按实际情况作答。",
                        "questionnaire": "PHQ-9", "due_at": "2026-12-01"}

    def tearDown(self):
        db._local_conn.close()
        db._local_conn = self.previous
        self.tmp.cleanup()

    async def call(self, method, path, payload=None, who="admin", query=""):
        uid = self.staff if who == "admin" else self.other if who == "other" else self.uid
        role = "admin" if who == "admin" else "user"
        token = create_access_token({"sub": str(uid), "username": who, "role": role})
        return await dispatch(method, path, query, json.dumps(payload or {}).encode(),
                              {"Authorization": "Bearer " + token})

    async def send(self):
        status, response = await self.call("POST", "/api/admin/reviews", self.payload)
        self.assertEqual(status, 200, response)
        return response["data"]

    async def test_requires_confirmed_live_task_and_admin(self):
        self.assertEqual((await self.call("POST", "/api/admin/reviews", self.payload, who="user"))[0], 403)
        db.execute("UPDATE agent_workspace_tasks SET state='proposed'")
        self.assertEqual((await self.call("POST", "/api/admin/reviews", self.payload))[0], 409)
        db.execute("UPDATE agent_workspace_tasks SET state='confirmed',scope='demo'")
        self.assertEqual((await self.call("POST", "/api/admin/reviews", self.payload))[0], 400)
        self.assertEqual(db.query_one("SELECT COUNT(*) AS c FROM review_requests")["c"], 0)

    async def test_send_acknowledge_retries_do_not_duplicate_or_complete_staff_task(self):
        item = await self.send()
        self.assertEqual((await self.send())["id"], item["id"])
        path = f"/api/personal/reviews/{item['id']}/acknowledge"
        self.assertEqual((await self.call("POST", path, who="user"))[1]["data"]["status"], "acknowledged")
        self.assertEqual((await self.call("POST", path, who="user"))[1]["data"]["version"], 1)
        self.assertEqual(db.query_one("SELECT COUNT(*) AS c FROM review_notifications")["c"], 1)
        self.assertEqual(db.query_one("SELECT state FROM agent_workspace_tasks")["state"], "confirmed")
        altered = {**self.payload, "instructions": "不能通过重复发送改内容"}
        self.assertEqual((await self.call("POST", "/api/admin/reviews", altered))[0], 409)

    async def test_private_fields_and_other_user_access(self):
        item = await self.send()
        status, personal = await self.call("GET", "/api/personal/reviews", who="user")
        self.assertEqual(status, 200)
        serialized = json.dumps(personal, ensure_ascii=False)
        self.assertNotIn("内部敏感", serialized)
        self.assertNotIn("review_notes", serialized)
        self.assertEqual((await self.call("GET", "/api/personal/reviews", who="other"))[1]["data"], [])
        self.assertEqual((await self.call("POST", f"/api/personal/reviews/{item['id']}/acknowledge", who="other"))[0], 404)
        notice = (await self.call("GET", "/api/notifications", who="user"))[1]["data"]
        self.assertEqual(notice["unread"], 1)
        nid = notice["items"][0]["id"]
        self.assertEqual((await self.call("PUT", f"/api/notifications/{nid}/read", who="other"))[0], 404)
        self.assertEqual((await self.call("POST", f"/api/personal/reviews/{item['id']}/submit",
                                          {"answers": {str(i): 0 for i in range(1, 10)}}, who="other"))[0], 404)

    async def test_submit_scores_on_server_and_is_idempotent(self):
        item = await self.send()
        path = f"/api/personal/reviews/{item['id']}/submit"
        self.assertEqual((await self.call("POST", path, {"answers": {"1": 0}}, who="user"))[0], 400)
        answers = {str(i): 1 for i in range(1, 10)}
        for _ in range(2):
            status, response = await self.call("POST", path, {"answers": answers, "score": 27, "level": "red"}, who="user")
            self.assertEqual(status, 200, response)
            self.assertEqual(response["data"]["status"], "submitted")
        rows = db.query("SELECT * FROM screenings")
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["score"], rows[0]["alert_level"], rows[0]["user_id"], rows[0]["case_id"]),
                         (9, "yellow", self.uid, self.case))
        self.assertEqual(db.query_one("SELECT COUNT(*) AS c FROM review_notifications WHERE recipient_id=?", (self.staff,))["c"], 1)
        self.assertEqual(db.query_one("SELECT state FROM agent_workspace_tasks")["state"], "confirmed")

    async def test_review_notification_and_internal_note_are_private(self):
        item = await self.send()
        path = f"/api/personal/reviews/{item['id']}/submit"
        submitted = (await self.call("POST", path, {"answers": {str(i): 2 for i in range(1, 10)}}, who="user"))[1]["data"]
        admin_path = f"/api/admin/reviews/{item['id']}"
        self.assertEqual((await self.call("PUT", admin_path, {"action": "review", "version": 0, "note": "内部复核"}))[0], 409)
        data = {"action": "review", "version": submitted["version"], "note": "内部复核"}
        for _ in range(2):
            self.assertEqual((await self.call("PUT", admin_path, data))[1]["data"]["status"], "reviewed")
        personal = (await self.call("GET", "/api/personal/reviews", who="user"))[1]["data"]
        self.assertNotIn("内部复核", json.dumps(personal, ensure_ascii=False))
        staff_list = (await self.call("GET", "/api/admin/reviews", query="case=CASE-REVIEW"))[1]["data"]
        self.assertEqual(staff_list[0]["review_notes"], "内部复核")
        self.assertEqual(staff_list[0]["score"], 18)
        self.assertEqual(db.query_one("SELECT COUNT(*) AS c FROM alerts")["c"], 1)
        notices = (await self.call("GET", "/api/notifications", who="user"))[1]["data"]
        self.assertEqual(len(notices["items"]), 2)
        nid = notices["items"][0]["id"]
        await self.call("PUT", f"/api/notifications/{nid}/read", who="user")
        await self.call("PUT", f"/api/notifications/{nid}/read", who="user")
        self.assertEqual((await self.call("GET", "/api/notifications", who="user"))[1]["data"]["unread"], 1)

    async def test_cancel_prevents_late_submission(self):
        item = await self.send()
        status, response = await self.call("PUT", f"/api/admin/reviews/{item['id']}",
                                            {"action": "cancel", "version": item["version"], "note": "调整安排"})
        self.assertEqual(status, 200, response)
        self.assertEqual((await self.call("POST", f"/api/personal/reviews/{item['id']}/submit",
                                          {"answers": {str(i): 0 for i in range(1, 10)}}, who="user"))[0], 409)
        self.assertEqual(db.query_one("SELECT COUNT(*) AS c FROM screenings")["c"], 0)

    async def test_older_unread_notices_remain_accessible_beyond_limit(self):
        item = await self.send()
        db.execute("UPDATE review_notifications SET created_at='2020-01-01'")
        for index in range(100):
            db.execute("INSERT INTO review_notifications(id,recipient_id,request_id,event_key,message,read_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)",
                       (f"read-{index}", self.uid, item["id"], f"read-{index}", "已读通知"))
        notices = (await self.call("GET", "/api/notifications", who="user"))[1]["data"]
        self.assertEqual(notices["unread"], 1)
        self.assertEqual(len(notices["items"]), 100)
        self.assertIsNone(notices["items"][0]["read_at"])

    async def test_atomic_operation_rolls_back_on_failure(self):
        with self.assertRaises(sqlite3.OperationalError):
            await db.batch_a([
                ("INSERT INTO review_notifications VALUES('rollback',?,'request','event','text',NULL,CURRENT_TIMESTAMP)", (self.uid,)),
                ("INSERT INTO missing_table VALUES(1)", ()),
            ])
        self.assertIsNone(db.query_one("SELECT id FROM review_notifications WHERE id='rollback'"))
