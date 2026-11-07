"""Contract tests for screening evidence and the persisted retrieval follow-up flow."""
import json
import sqlite3
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from app.core.auth import RequestContext
from app.core.exceptions import HttpError
from app.db import database as db
from app.handlers import personal, retrieval
from app.services import screening_assessment as service
from app.services import screening_service


HIT = {"id": "text-sleep", "record_id": "sleep-case", "modality": "text",
       "summary": "参考记录包含睡眠困难和兴趣下降", "similarity": .84, "alert_level": "red",
       "tags": ["睡眠困难", "兴趣下降"]}


class PolicyTests(unittest.TestCase):
    def test_saved_reference_labels_survive_refresh(self):
        hit = personal._report_hit({"id": "reference-1", "similarity": 0.8,
            "alertLevel": "orange", "screeningLabel": "positive", "labelSource": "EATD-Corpus/SDS"})
        self.assertEqual(hit["alertLevel"], "orange")
        self.assertEqual(hit["screeningLabel"], "positive")
        self.assertEqual(hit["labelSource"], "EATD-Corpus/SDS")

    def test_reference_risk_is_never_a_user_risk(self):
        result = service.build_assessment("开心", hits=[HIT] * 10)
        self.assertIsNone(result["level"])
        self.assertIn("不能据此判断整体心理健康", result["conclusion"])
        self.assertEqual(result["references"][0]["usage"], "candidate")

    def test_retrieval_actually_selects_specific_questions(self):
        plain = service.build_assessment("我最近睡不好，也提不起兴趣", hits=[])
        retrieved = service.build_assessment("我最近睡不好，也提不起兴趣", hits=[HIT])
        self.assertNotIn("sleepPattern", plain["missingFields"])
        self.assertNotIn("interestChange", plain["missingFields"])
        self.assertIn("sleepPattern", retrieved["missingFields"])
        self.assertIn("interestChange", retrieved["missingFields"])
        self.assertEqual(next(q for q in retrieved["questions"] if q["field"] == "sleepPattern")["referenceIds"], [HIT["id"]])
        self.assertEqual(next(q for q in retrieved["questions"] if q["field"] == "duration")["referenceIds"], [])

    def test_answered_reference_trace_is_preserved(self):
        initial = service.build_assessment("我最近睡不好", hits=[HIT])
        answered = service.build_assessment("我最近睡不好", hits=[HIT], previous=initial,
            followup_answers={"duration": "two_weeks_or_more", "frequency": "most_days",
                              "functionalImpact": "significant", "sleepPattern": "夜间醒来"})
        self.assertEqual(answered["missingFields"], [])
        self.assertEqual(answered["references"][0]["usage"], "followup")
        self.assertIn("Q-SLEEP-PATTERN", answered["references"][0]["questionIds"])
        self.assertEqual(answered["followupAnswers"]["duration"], "two_weeks_or_more")
        self.assertIn("两周及以上", str(answered["evidence"]))

    def test_repeated_negative_requires_distinct_recent_days(self):
        now = datetime.now(timezone.utc)
        rows = [{"kind": "text", "text": "我今天很难过", "created_at": (now - timedelta(days=i)).isoformat()} for i in range(3)]
        rows += [rows[0]] * 12
        rows += [{"kind": "text", "text": "我很难过", "created_at": (now - timedelta(days=30)).isoformat()}]
        self.assertEqual(service.repeated_negative(rows)["count"], 3)
        self.assertEqual(service.build_assessment("开心", observations=rows)["level"], "orange")
        self.assertFalse(service.repeated_negative([rows[0]] * 12)["triggered"])

    def test_negation_other_people_and_search_are_not_personal_observations(self):
        for query in ("我没有难过", "我不再悲伤", "朋友说很难过", "他很生气", "搜索悲伤", "我没有想死"):
            signal = service.extract_signals(query)
            self.assertFalse(signal["negative"], query)
            self.assertFalse(signal["safetySignal"], query)
        self.assertTrue(service.extract_signals("我很难过")["negative"])
        self.assertTrue(service.extract_signals("我不开心")["negative"])

    def test_historical_safety_is_not_current_red(self):
        result = service.build_assessment("去年想死，现在没有这种想法")
        self.assertEqual(result["level"], "orange")
        self.assertEqual(result["safetyStatus"], "needs_review")
        self.assertEqual(service.build_assessment("我现在想死")["level"], "red")

    def test_phq_safety_item_is_independent_of_total(self):
        answers = {str(i): 0 for i in range(1, 10)}
        answers["9"] = 1
        result = service.score_questionnaire("PHQ-9", answers)
        self.assertEqual(result["score"], 1)
        self.assertEqual(result["safetyStatus"], "needs_review")
        self.assertEqual(result["level"], "orange")
        answers = {str(i): 3 for i in range(1, 10)}
        self.assertEqual(service.score_questionnaire("PHQ-9", answers)["level"], "orange")

    def test_pss_raw_options_reverse_exactly_once_and_no_clinical_cutoff(self):
        answers = {str(i): 0 for i in range(1, 11)}
        result = service.score_questionnaire("PSS-10", answers, version=service.QUESTIONNAIRE_VERSION, encoding="option-index")
        self.assertEqual(result["score"], 16)
        self.assertEqual({int(key) for key, score in result["itemScores"].items() if score == 4}, {4, 5, 7, 8})
        self.assertEqual(result["level"], "yellow")
        self.assertFalse(result["requiresHumanReview"])
        with self.assertRaises(HttpError):
            service.score_questionnaire("PSS-10", answers)

    def test_query_uses_symptoms_not_name_or_risk_label(self):
        query = service.build_symptom_query({"name": "PRIVATE-NAME", "questionnaire_name": "PHQ-9", "score": 22,
            "alert_level": "red", "notes": "我已经三周睡不好，影响学习"})
        self.assertIn("睡眠困难", query)
        self.assertIn("三周", query)
        self.assertNotIn("PRIVATE-NAME", query)
        self.assertNotIn("red", query)

    def test_rag_conclusion_locked_to_backend(self):
        assessment = service.build_assessment("开心")
        report = service.lock_report({"summary": "错误高危", "risk_level": "high", "sections": []}, assessment)
        self.assertEqual(report["risk_level"], "unknown")
        self.assertEqual(report["summary"], assessment["conclusion"])

    def test_significant_impact_and_scale_contradiction_require_review(self):
        scale = {"status": "completed", "questionnaire_code": "PHQ-9", "answers": {str(i): 0 for i in range(1, 10)}}
        result = service.build_assessment("我连续三周每天失眠，无法工作", screening=scale)
        self.assertEqual(result["scaleResult"]["score"], 0)
        self.assertEqual(result["status"], "needs_human_review")
        self.assertEqual(result["level"], "orange")
        self.assertTrue(result["evidenceConflicts"])

    def test_unrelated_scale_does_not_gate_input_analysis(self):
        scale = {"status": "completed", "questionnaire_code": "GAD-7", "answers": {str(i): 0 for i in range(1, 8)}}
        result = service.build_assessment("我睡不好，提不起兴趣", screening=scale)
        self.assertEqual(result["status"], "needs_followup")
        self.assertEqual(result["level"], "yellow")
        self.assertIn("PHQ-9", [item["code"] for item in result["recommendedScales"]])
        self.assertNotEqual(result["nextAction"]["type"], "scale")

    def test_complete_personal_evidence_needs_no_questionnaire(self):
        result = service.build_assessment("我最近睡不好", hits=[HIT], followup_answers={
            "duration": "less_than_week", "frequency": "occasionally", "functionalImpact": "none", "sleepPattern": "入睡困难"})
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["level"], "yellow")
        self.assertIsNone(result["scaleResult"])
        self.assertEqual(result["nextAction"]["type"], "finish")

    def test_persistent_personal_distress_can_trigger_review_without_scale(self):
        result = service.build_assessment("我连续三周每天失眠")
        self.assertEqual(result["status"], "needs_human_review")
        self.assertEqual(result["level"], "orange")
        self.assertIsNone(result["scaleResult"])

    def test_positive_and_media_only_finish_without_forced_scale(self):
        for query in ("开心", ""):
            result = service.build_assessment(query, hits=[HIT])
            self.assertEqual(result["status"], "ready")
            self.assertIsNone(result["level"])
            self.assertEqual(result["nextAction"]["type"], "finish")

    def test_free_text_followup_safety_and_unknown_are_not_ignored(self):
        safety = service.build_assessment("我最近睡不好", hits=[HIT], followup_answers={"sleepPattern": "我现在想死"})
        self.assertEqual(safety["level"], "red")
        unknown = service.build_assessment("我最近睡不好", hits=[HIT], followup_answers={"duration": "unknown", "sleepPattern": "不知道"})
        self.assertIn("duration", unknown["missingFields"])
        self.assertIn("sleepPattern", unknown["missingFields"])


class PersistedFlowTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.previous = db._local_conn
        db._local_conn = sqlite3.connect(":memory:", check_same_thread=False)
        db._local_conn.row_factory = sqlite3.Row
        db.init_db_sync()
        db._local_conn.executescript("DELETE FROM screening_supplements; DELETE FROM screenings; DELETE FROM alerts; DELETE FROM questionnaires; DELETE FROM users; DELETE FROM cases;")
        db.execute("INSERT INTO users (id, username, password_hash, name, role) VALUES (1,'one','x','One','user')")
        db.execute("INSERT INTO users (id, username, password_hash, name, role) VALUES (2,'two','x','Two','user')")
        db.execute("INSERT INTO questionnaires (id, code, name, max_score) VALUES (1,'PHQ-9','PHQ-9 抑郁症状筛查',27)")
        db.execute("INSERT INTO questionnaires (id, code, name, max_score) VALUES (2,'PSS-10','PSS-10 压力自评',40)")

    def tearDown(self):
        db._local_conn.close()
        db._local_conn = self.previous

    def ctx(self, body, uid=1):
        ctx = RequestContext("POST", "/", body=json.dumps(body).encode())
        ctx.user = {"sub": str(uid), "role": "user"}
        return ctx

    async def test_persist_followup_then_link_new_scale(self):
        sup = db.execute("INSERT INTO screening_supplements (user_id,kind,text) VALUES (1,'text','我最近睡不好，也提不起兴趣')")
        search = AsyncMock(return_value=([HIT], {}, "text", None))
        with patch.object(personal, "perform_search", search):
            first = (await personal.personal_retrieval_assessment(self.ctx({"supplementId": sup})))["data"]["assessment"]
            self.assertEqual(first["questions"][-1]["triggerRule"], "retrieved-shared-dimension")
            answered = (await personal.personal_retrieval_assessment(self.ctx({"supplementId": sup, "followupAnswers": {
                "duration": "two_weeks_or_more", "frequency": "most_days", "functionalImpact": "significant", "sleepPattern": "早醒", "interestChange": "不想打球"}})))["data"]["assessment"]
            self.assertEqual(answered["missingFields"], [])
            raw = {str(i): value for i, value in enumerate([2,2,2,1,1,1,1,2,0], 1)}
            with patch.object(screening_service, "_index_into_hashing", AsyncMock()):
                submitted = (await personal.submit_personal_screening(self.ctx({"questionnaire": "PHQ-9", "answers": raw,
                    "questionnaireVersion": service.QUESTIONNAIRE_VERSION, "answerEncoding": "option-index"})))["data"]
            self.assertEqual(submitted["score"], 12)
            linked = (await personal.personal_retrieval_assessment(self.ctx({"supplementId": sup, "screeningId": submitted["id"]})))["data"]["assessment"]
            self.assertEqual(linked["scaleResult"]["score"], 12)
            self.assertEqual(linked["status"], "needs_human_review")
            self.assertEqual(linked["followupAnswers"], answered["followupAnswers"])
            self.assertIn("Q-SLEEP-PATTERN", linked["references"][0]["questionIds"])
            stored = db.query_one("SELECT screening_id,analysis FROM screening_supplements WHERE id=?", (sup,))
            self.assertEqual(stored["screening_id"], submitted["id"])
            self.assertEqual(json.loads(stored["analysis"])["assessment"]["scaleResult"]["score"], 12)
            await personal.personal_retrieval_assessment(self.ctx({"supplementId": sup}))
            self.assertEqual(db.query_one("SELECT COUNT(*) AS n FROM alerts WHERE trigger=?", (f"筛查证据复核 · 补充#{sup}",))["n"], 1)
            listing = (await personal.get_personal_screenings(self.ctx({})))["data"]
            self.assertEqual(listing[0]["answers"], raw)
            self.assertEqual(listing[0]["questionnaireVersion"], service.QUESTIONNAIRE_VERSION)

    async def test_cannot_attach_other_users_material(self):
        sup = db.execute("INSERT INTO screening_supplements (user_id,kind,text) VALUES (2,'text','开心')")
        with self.assertRaises(HttpError) as caught:
            await personal.personal_retrieval_assessment(self.ctx({"supplementId": sup}))
        self.assertEqual(caught.exception.status_code, 404)
        self.assertIsNone(db.query_one("SELECT analysis FROM screening_supplements WHERE id=?", (sup,))["analysis"])

    async def test_preview_is_not_saved_or_counted(self):
        with patch.object(personal, "perform_search", AsyncMock(return_value=([HIT], {}, "text", None))):
            for _ in range(4):
                result = (await personal.personal_retrieval_assessment(self.ctx({"query": "我很难过"})))["data"]["assessment"]
                self.assertEqual(result["repeatedNegative"]["count"], 0)
                self.assertFalse(result["persisted"])
            self.assertEqual(db.query_one("SELECT COUNT(*) AS n FROM screening_supplements")["n"], 0)

    async def test_admin_and_personal_scale_rules_agree(self):
        self.assertEqual(await screening_service._calculate_alert_level(1, 22), "orange")
        self.assertEqual(await screening_service._calculate_alert_level(2, 40), "yellow")

    async def test_explicit_empty_screening_unlinks_owned_supplement(self):
        db.execute("INSERT INTO screenings (id,screening_id,user_id,name,questionnaire_id,status,answers) VALUES (1,'SCR-ONE',1,'One',1,'completed',?)", (json.dumps({str(i): 0 for i in range(1,10)}),))
        sup = db.execute("INSERT INTO screening_supplements (user_id,screening_id,kind,text) VALUES (1,'SCR-ONE','text','开心')")
        with patch.object(personal, "perform_search", AsyncMock(return_value=([HIT], {}, "text", None))):
            linked = (await personal.personal_retrieval_assessment(self.ctx({"supplementId": sup})))["data"]["assessment"]
            self.assertEqual(linked["screeningId"], "SCR-ONE")
            unlinked = (await personal.personal_retrieval_assessment(self.ctx({"supplementId": sup, "screeningId": ""})))["data"]["assessment"]
            self.assertIsNone(unlinked["screeningId"])
            self.assertIsNone(unlinked["level"])
            self.assertIsNone(db.query_one("SELECT screening_id FROM screening_supplements WHERE id=?", (sup,))["screening_id"])

    async def test_invalid_followup_option_rejected(self):
        sup = db.execute("INSERT INTO screening_supplements (user_id,kind,text) VALUES (1,'text','我睡不好')")
        with self.assertRaises(HttpError) as caught:
            await personal.personal_retrieval_assessment(self.ctx({"supplementId": sup, "followupAnswers": {"duration": "invented-option"}}))
        self.assertEqual(caught.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
