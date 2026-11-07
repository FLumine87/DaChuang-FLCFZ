import json
import sqlite3
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from app.core.auth import RequestContext
from app.core.exceptions import HttpError
from app.core.security import decode_access_token
from app.db import database as db
from app.handlers import personal
from app.services import retrieval_screening as rs
from app.services import screening_assessment as sa


def hit(unit, emotion, similarity=.85, record=None, modality='text'):
    return {'id': unit, 'recordId': record or unit, 'record_id': record or unit, 'modality': modality,
            'emotionLabel': emotion, 'emotion_label': emotion, 'similarity': similarity, 'summary': '', 'tags': []}


class RetrievalEvidenceTests(unittest.TestCase):
    def test_report_has_conclusion_brief_reference_and_model_advice_with_fixed_risk(self):
        assessment = rs.build_retrieval_screening('开心', [hit('a', 'happy')])
        report = sa.lock_report({'summary':'结合本人自述与检索结果，情绪目前呈积极倾向。', 'risk_level':'high',
            'sections':[{'title':'参考依据','content':'据' * 300}, {'title':'冗长旧格式','content':'不要展示'}],
            'recommendations':['记录情绪变化。', '安排适当休息。']}, assessment)
        self.assertEqual(report['summary'], '结合本人自述与检索结果，情绪目前呈积极倾向。')
        self.assertEqual(report['risk_level'], 'low')
        self.assertEqual([s['title'] for s in report['sections']], ['参考依据'])
        self.assertLessEqual(len(report['sections'][0]['content']), 180)
        self.assertEqual(report['recommendations'], ['记录情绪变化。', '安排适当休息。'])
        self.assertEqual(report['assessment']['conclusion'], assessment['conclusion'])

    def test_prompt_original_input_switch_excludes_even_encoded_snapshot(self):
        assessment = rs.build_retrieval_screening('PRIVATE-RAW-TEXT', [hit('a', 'sad')])
        token = rs.seal_snapshot(1, rs.snapshot('PRIVATE-RAW-TEXT', [hit('a', 'sad')], 'text'))
        assessment['retrievalToken'] = token
        for enabled in (False, True):
            prompt = sa.assessment_prompt(assessment, '参考知识', {'enabled':enabled,'text':'PRIVATE-RAW-TEXT'})
            self.assertEqual('PRIVATE-RAW-TEXT' in prompt, enabled)
            self.assertNotIn(token, prompt)
            self.assertIn('参考依据', prompt)
            self.assertIn('心理建议', prompt)

    def test_fallback_and_malformed_report_use_same_brief_three_part_format(self):
        assessment = rs.build_retrieval_screening('', [hit('a', 'sad')])
        report = sa.assessment_report(assessment)
        self.assertEqual(report['summary'], assessment['conclusion'])
        self.assertEqual([s['title'] for s in report['sections']], ['参考依据'])
        self.assertEqual(report['recommendations'], [])
        self.assertIn('未生成', report['generationMessage'])
        with self.assertRaises(ValueError):
            sa.lock_report({'summary':[], 'sections':{}, 'recommendations':'invalid'}, assessment)

    def test_safety_risk_stays_fixed_without_replacing_model_advice_with_navigation(self):
        assessment = rs.build_retrieval_screening('我现在想伤害自己', [hit('a', 'happy')])
        report = sa.lock_report({'summary':'需及时核实安全线索', 'recommendations':['联系身边可信任的人陪伴，并及时寻求专业支持。', '查看专业复核建议']}, assessment)
        self.assertEqual(report['risk_level'], 'high')
        self.assertEqual(report['recommendations'], ['联系身边可信任的人陪伴，并及时寻求专业支持。'])
        self.assertNotIn(assessment['nextAction']['label'], report['recommendations'])

    def test_navigation_only_response_is_not_claimed_to_be_a_valid_model_report(self):
        assessment = rs.build_retrieval_screening('', [hit('a', 'sad')])
        with self.assertRaises(ValueError):
            sa.lock_report({'summary':'综合结论', 'recommendations':['查看专业复核建议', assessment['nextAction']['label']]}, assessment)

    def test_identical_input_different_hits_changes_conclusion(self):
        positive = rs.build_retrieval_screening('同一输入', [hit('a', 'happy')])
        negative = rs.build_retrieval_screening('同一输入', [hit('b', 'sad')])
        self.assertEqual(positive['level'], 'green')
        self.assertEqual(negative['level'], 'yellow')
        self.assertNotEqual(positive['conclusion'], negative['conclusion'])
        self.assertEqual(positive['references'][0]['usage'], 'screening')

    def test_hits_not_query_wording_supply_emotional_conclusion(self):
        hits = [hit('a', 'happy')]
        self.assertEqual(rs.build_retrieval_screening('任意文字', hits)['conclusion'],
                         rs.build_retrieval_screening('', hits, modality='image')['conclusion'])

    def test_repeated_modalities_do_not_become_multiple_people(self):
        single = [hit('a', 'happy', record='one'), hit('b', 'sad', record='two')]
        triple = [single[0], hit('a2', 'happy', record='one', modality='audio'), hit('a3', 'happy', record='one', modality='image'), single[1]]
        self.assertEqual(rs.build_retrieval_screening('', single)['levelLabel'], rs.build_retrieval_screening('', triple)['levelLabel'])
        self.assertIn('2条来源记录', rs.build_retrieval_screening('', triple)['retrievalContribution'])

    def test_low_relevance_or_only_risk_colours_abstains(self):
        for hits in ([hit('a', 'sad', .2)], [{'id': 'a', 'similarity': .99, 'alertLevel': 'red', 'tags': ['SDS-抑郁']}], []):
            result = rs.build_retrieval_screening('开心', hits)
            self.assertIsNone(result['level'])
            self.assertEqual(result['questions'], [])
            self.assertEqual(result['recommendedScales'], [])

    def test_explicit_safety_signal_cannot_be_hidden_by_positive_matches(self):
        self.assertEqual(rs.build_retrieval_screening('我现在想伤害自己', [hit('a', 'happy')])['level'], 'red')

    def test_snapshot_is_owner_bound_tamper_protected_and_not_login_token(self):
        token = rs.seal_snapshot(1, rs.snapshot('', [hit('a', 'sad')], 'audio'))
        self.assertEqual(rs.open_snapshot(token, 1)['modality'], 'audio')
        self.assertIsNone(decode_access_token(token))
        for invalid, owner in ((token, 2), (token + 'a', 1)):
            with self.assertRaises(HttpError):
                rs.open_snapshot(invalid, owner)


class RetrievalEndpointTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.previous = db._local_conn
        db._local_conn = sqlite3.connect(':memory:', check_same_thread=False)
        db._local_conn.row_factory = sqlite3.Row
        db.init_db_sync()

    def tearDown(self):
        db._local_conn.close()
        db._local_conn = self.previous

    def ctx(self, body):
        ctx = RequestContext('POST', '/', body=json.dumps(body).encode())
        ctx.user = {'sub': '1', 'role': 'user'}
        return ctx

    async def test_rag_original_input_uses_owned_snapshot_and_can_be_disabled(self):
        token = rs.seal_snapshot(1, rs.snapshot('真正的本人自述', [hit('a', 'happy')], 'text'))
        for enabled in (True, False):
            engine = AsyncMock()
            engine.generate_report.return_value = {'summary':'综合结论','sections':[], 'recommendations':[], 'mock':False}
            with patch.object(personal, 'get_rag_engine', return_value=engine):
                data = (await personal.personal_rag_report(self.ctx({'analysisMode':'retrieval','retrievalToken':token,
                    'includeOriginalInput':enabled,'query':'不能替换快照的伪造输入'})))['data']
            context = engine.generate_report.call_args.args[0]['original_input']
            self.assertEqual(context['text'], '真正的本人自述' if enabled else '')
            self.assertEqual(data['report']['originalInput']['used'], enabled)
            self.assertEqual(data['report']['originalInput']['enabled'], enabled)

    async def test_rag_media_does_not_claim_to_have_read_original_and_rejects_invalid_switch(self):
        token = rs.seal_snapshot(1, rs.snapshot('', [hit('a', 'happy')], 'image'))
        engine = AsyncMock()
        engine.generate_report.return_value = {'summary':'综合结论','mock':False}
        with patch.object(personal, 'get_rag_engine', return_value=engine):
            data = (await personal.personal_rag_report(self.ctx({'analysisMode':'retrieval','retrievalToken':token})))['data']
            self.assertFalse(data['report']['originalInput']['used'])
            self.assertIn('不直接解读', data['report']['originalInput']['notice'])
            with self.assertRaises(HttpError):
                await personal.personal_rag_report(self.ctx({'analysisMode':'retrieval','retrievalToken':token,'includeOriginalInput':'false'}))

    async def test_both_model_providers_receive_opted_in_text_and_preserve_generated_narrative(self):
        from app.config import settings
        from app.engines.rag.deepseek_rag_engine import DeepSeekRAGEngine
        from app.engines.rag import zhipu_rag_engine as zhipu
        assessment = rs.build_retrieval_screening('MODEL-PRIVATE-TEXT', [hit('a', 'happy')])
        generated = {'summary':'综合本人文字后的分析结论','risk_level':'high',
                     'sections':[{'title':'参考依据','content':'本次自述与已采用参考。'}], 'recommendations':['留意近期情绪变化。']}
        for provider in ('deepseek', 'zhipu'):
            for enabled in (True, False):
                with self.subTest(provider=provider, enabled=enabled):
                    data = {'screening_assessment':assessment,'original_input':{'enabled':enabled,'text':'MODEL-PRIVATE-TEXT'}}
                    if provider == 'deepseek':
                        engine = DeepSeekRAGEngine()
                        engine.retrieve = AsyncMock(return_value=[])
                        with patch.object(settings, 'DEEPSEEK_API_KEY', 'fake-test-key'), \
                             patch.object(engine, '_call_deepseek', return_value=json.dumps(generated)) as call:
                            report = await engine.generate_report(data)
                            prompt = call.call_args.args[0]
                    else:
                        engine = zhipu.ZhipuRAGEngine()
                        engine._client = Mock()
                        engine._client.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(generated)))])
                        with patch.object(zhipu, 'ZHIPU_AVAILABLE', True):
                            report = await engine.generate_report(data)
                        prompt = engine._client.chat.completions.create.call_args.kwargs['messages'][0]['content']
                    self.assertEqual('MODEL-PRIVATE-TEXT' in prompt, enabled)
                    self.assertFalse(report['mock'])
                    self.assertEqual(report['summary'], generated['summary'])
                    self.assertEqual(report['recommendations'], generated['recommendations'])
                    self.assertEqual(report['risk_level'], 'low')

    async def test_image_search_uses_exact_returned_hits_without_reading_scale(self):
        rows = [hit('img-a', 'happy', modality='image'), hit('aud-a', 'happy', modality='audio')]
        with patch.object(personal, 'perform_search', AsyncMock(return_value=(rows, {}, 'image', None))), \
             patch.object(personal.assessment_service, 'owned_context', side_effect=AssertionError('must not read questionnaires')):
            result = (await personal.personal_search(self.ctx({'modality': 'image', 'screeningId': 'any'})))['data']
            self.assertEqual(result['assessment']['level'], 'green')
            token = result['assessment']['retrievalToken']
            with patch.object(personal, 'perform_search', side_effect=AssertionError('must not rerun as text')):
                restored = (await personal.personal_retrieval_screening(self.ctx({'retrievalToken': token})))['data']['assessment']
            self.assertEqual(restored['queryModality'], 'image')
            self.assertEqual(restored['conclusion'], result['assessment']['conclusion'])

    async def test_save_and_restore_exact_snapshot_without_questionnaire_binding(self):
        sup = db.execute("INSERT INTO screening_supplements (user_id,kind,text) VALUES (1,'text','开心')")
        token = rs.seal_snapshot(1, rs.snapshot('开心', [hit('a', 'happy')], 'text'))
        saved = (await personal.personal_retrieval_screening(self.ctx({'supplementId': sup, 'retrievalToken': token, 'screeningId': 'ignored'})))['data']['assessment']
        restored = (await personal.personal_retrieval_screening(self.ctx({'supplementId': sup})))['data']['assessment']
        self.assertEqual(saved['conclusion'], restored['conclusion'])
        self.assertIsNone(db.query_one('SELECT screening_id FROM screening_supplements WHERE id=?', (sup,))['screening_id'])
        self.assertIsNone(restored['scaleResult'])

    async def test_saving_retrieval_does_not_rerun_old_input_based_assessment(self):
        query = '我连续三周每天睡不好'
        token = rs.seal_snapshot(1, rs.snapshot(query, [hit('a', 'happy')], 'text'))
        with patch.object(personal, '_analyze_collection', side_effect=AssertionError('old path must not run')), \
             patch.object(personal, '_index_supplement', AsyncMock()):
            saved = (await personal.save_personal_supplement(self.ctx({'kind':'text','text':query,'retrievalToken':token})))['data']
        self.assertEqual(saved['report']['assessment']['level'], 'green')
        self.assertEqual(saved['report']['assessment']['analysisMode'], 'retrieval')
