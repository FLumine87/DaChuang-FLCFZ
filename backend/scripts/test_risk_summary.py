"""Unified-risk regression suite: temporary databases, synthetic input, no model/network."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from datetime import datetime,timedelta,timezone
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.config import settings
from app.core.exceptions import HttpError
from app.db import database as db
from app.services import risk_summary as risk, screening_assessment as rules


class RiskTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.previous=settings.DATABASE_URL
        settings.DATABASE_URL='sqlite:///'+str(Path(self.tmp.name)/'risk.db')
        db._local_conn=None;db.init_db_sync()
        self.uid=db.execute("INSERT INTO users(username,password_hash,name,role) VALUES ('risk_alice','x','合成用户','user')")
        self.other=db.execute("INSERT INTO users(username,password_hash,name,role) VALUES ('risk_bob','x','另一合成用户','user')")
        self.case='CASE-RISK-TEST'
        db.execute("INSERT INTO cases(case_id,user_id,name) VALUES (?,?,'合成档案')",(self.case,self.uid))
        self.now=datetime.now(risk.CHINA).replace(hour=10,minute=0,second=0,microsecond=0)
        self.number=0

    async def asyncTearDown(self):
        db._local_conn.close();db._local_conn=None;settings.DATABASE_URL=self.previous;self.tmp.cleanup()

    def scale(self,code='PHQ-9',score=0,days=0,item9=None,version=None):
        count,maximum=rules.SPECS[code];values={str(i):0 for i in range(1,count+1)}
        left=score
        for i in range(1,count+1):values[str(i)]=min(maximum,left);left-=values[str(i)]
        if item9 is not None:values['9']=item9
        meta={'questionnaireVersion':version or rules.QUESTIONNAIRE_VERSION,'answerEncoding':'option-index'}
        q=db.query_one('SELECT id FROM questionnaires WHERE code=?',(code,))
        qid=q['id'] if q else db.execute('INSERT INTO questionnaires(code,name,max_score) VALUES (?,?,?)',(code,code,count*maximum))
        self.number+=1
        at=(self.now-timedelta(days=days)).isoformat()
        sid=db.execute("INSERT INTO screenings(screening_id,user_id,name,questionnaire_id,score,max_score,answers,status,alert_level,screening_date,created_at) VALUES (?,?,'合成筛查',?,?,?,?, 'completed','red',?,?)",
                       (f'SCR-TEST-{self.number}',self.uid,qid,score,count*maximum,json.dumps({'values':values,'_meta':meta}),at,at))
        return f'scale:{sid}',sid

    def media(self,text='',days=0,kind='text',assessment=None,uid=None):
        at=(self.now-timedelta(days=days)).astimezone(timezone.utc).isoformat()
        sid=db.execute('INSERT INTO screening_supplements(user_id,kind,text,analysis,created_at) VALUES (?,?,?,?,?)',
                       (uid or self.uid,kind,text,json.dumps({'assessment':assessment or {}}),at))
        return f'multimodal:{sid}',sid

    async def state(self):return await risk.summary(self.uid,now=self.now)

    async def grant(self,enabled=True,sequence=1,version='test-model-v1',history=True):
        return await risk.set_consent(self.uid,{'enabled':enabled,'history':history,'since_at':self.now.isoformat(),
             'revision':str(sequence),'sequence':sequence,'extractor_version':version})

    async def complete(self,unit,findings=None,version='test-model-v1',revision='1',status='done'):
        return await risk.save_extraction(self.uid,{**unit,'extractor_version':version,'revision':revision,
                                                   'findings':findings or [],'status':status})

    async def test_empty_and_media_metadata_are_unknown(self):
        self.assertEqual((await self.state())['level'],'unknown')
        self.media(kind='image');s=await self.state()
        self.assertEqual(s['level'],'unknown');self.assertEqual(s['coverage']['multimodal'],1)

    async def test_latest_per_scale_and_independent_dimensions(self):
        self.scale(score=22,days=10);self.scale(score=0,days=1);self.scale('GAD-7',score=7,days=2)
        s=await self.state();self.assertEqual(s['level'],'yellow')
        phq=s['dimensions'][0];self.assertEqual(phq['score'],0);self.assertEqual(phq['trend']['delta'],-22)
        self.assertNotIn('red',[d['level'] for d in s['dimensions']])

    async def test_pss_does_not_create_a_yellow_overall_grade(self):
        self.scale('PSS-10',score=40)
        s=await self.state();self.assertEqual(s['level'],'unknown')
        self.assertIsNotNone(s['dimensions'][3]['score'])
        self.assertEqual(s['dimensions'][3]['level'],'unknown')

    async def test_incompatible_scale_is_not_guessed(self):
        _,sid=self.scale('PSS-10');db.execute('UPDATE screenings SET answers=? WHERE id=?',('{}',sid))
        s=await self.state();self.assertEqual(s['level'],'unknown');self.assertEqual(s['coverage']['incompatible'],1)

    async def test_retained_old_alert_colours_do_not_determine_current_grade(self):
        self.scale(score=0)  # The stored historical colour is deliberately red.
        self.assertEqual((await self.state())['level'],'green')

    async def test_retrieval_similarity_cannot_prove_low_or_high_risk(self):
        self.media(kind='image',assessment={'analysisMode':'retrieval','level':'green','conclusion':'参考积极'})
        self.assertEqual((await self.state())['level'],'unknown')
        self.media(kind='audio',assessment={'analysisMode':'retrieval','level':'red'})
        self.assertEqual((await self.state())['level'],'unknown')
        self.media(kind='text',assessment={'analysisMode':'retrieval','level':'yellow'})
        self.assertEqual((await self.state())['level'],'yellow')

    async def test_retrieval_safety_is_not_lost(self):
        self.media(kind='audio',assessment={'analysisMode':'retrieval','level':'red','safetyStatus':'needs_review'})
        s=await self.state();self.assertEqual(s['level'],'orange');self.assertEqual(s['safety']['status'],'needs_review')

    async def test_safety_not_overridden_by_low_new_score_or_ordinary_alert_resolution(self):
        self.scale(score=0,item9=1,days=4);self.scale(score=0,days=0)
        db.execute("INSERT INTO alerts(alert_id,user_id,name,level,status) VALUES ('ALT-TEST',?,'测试','orange','resolved')",(self.uid,))
        s=await self.state();self.assertEqual(s['level'],'orange');self.assertEqual(len(s['safety']['flags']),1)
        flag=s['safety']['flags'][0]
        await risk.review(self.uid,{'item_id':flag['id'],'source_hash':flag['source_hash'],'action':'resolve_safety','note':'合成复核：确认需解除该条历史提示'},999)
        self.assertEqual((await self.state())['level'],'green')

    async def test_direct_current_safety_is_distinct_from_old_unresolved_prompt(self):
        self.media('我现在想伤害自己',days=1)
        self.assertEqual((await self.state())['level'],'red')
        s=await risk.summary(self.uid,now=self.now+timedelta(days=31))
        self.assertEqual(s['level'],'unknown');self.assertEqual(s['safety']['status'],'needs_review')
        self.assertFalse(s['safety']['flags'][0]['recent'])

    async def test_negation_quotation_and_other_people_do_not_trigger_personal_safety(self):
        for text in ('我没有想死','朋友说想死','电影里想死','“想死”只是引用的例子'):
            self.media(text)
        self.assertEqual((await self.state())['safety']['status'],'not_identified')

    async def test_distinct_negative_dates_and_positive_records_cannot_cancel_them(self):
        for _ in range(5):self.media('我有些难过',days=0)
        self.assertEqual((await self.state())['level'],'yellow')
        self.media('我很难过',days=1);self.media('我很难过',days=2);self.media('我很开心',days=0)
        self.assertEqual((await self.state())['level'],'orange')

    async def test_all_modalities_own_text_and_functional_impact(self):
        self.media('严重影响工作，我很焦虑',kind='audio')
        s=await self.state();self.assertEqual(s['level'],'orange')
        self.assertTrue(any('生活影响' in x['text'] for x in s['reasons']))

    async def test_owner_isolation_and_cross_user_review_rejection(self):
        self.media('我现在想伤害自己',uid=self.other)
        self.assertEqual((await self.state())['level'],'unknown')
        other=await risk.summary(self.other,now=self.now);flag=other['safety']['flags'][0]
        with self.assertRaises(HttpError):await risk.review(self.uid,{'item_id':flag['id'],'source_hash':flag['source_hash'],'action':'resolve_safety','note':'不能跨账号复核'},999)

    async def test_personal_and_admin_endpoints_share_identical_data_version(self):
        from app.router import dispatch
        self.scale(score=7)
        with patch('app.core.auth.decode_access_token',return_value={'sub':str(self.uid),'role':'user'}):
            status,personal=await dispatch('GET','/api/personal/risk-summary',headers={'Authorization':'Bearer test'})
            self.assertEqual(status,200)
            denied,_=await dispatch('POST',f'/api/admin/cases/{self.case}/risk-reviews',body=b'{}',headers={'Authorization':'Bearer test'})
            self.assertEqual(denied,403)
        with patch('app.core.auth.decode_access_token',return_value={'sub':'999','role':'admin'}):
            status,admin=await dispatch('GET',f'/api/admin/cases/{self.case}/risk-summary',headers={'Authorization':'Bearer test'})
            self.assertEqual(status,200)
        self.assertEqual(personal['data']['level'],admin['data']['level'])
        self.assertEqual(personal['data']['data_version'],admin['data']['data_version'])

    async def test_ambiguous_case_cannot_merge_an_account(self):
        db.execute("INSERT INTO cases(case_id,user_id,name) VALUES ('CASE-DUP',?,'重复档案')",(self.uid,))
        with self.assertRaises(HttpError):await risk.case_user(self.case)

    async def test_ai_permission_required_and_late_output_rejected(self):
        self.media('这是一条合成原文')
        self.assertEqual((await risk.extraction_context(self.uid,'test-model-v1'))['units'],[])
        await self.grant();unit=(await risk.extraction_context(self.uid,'test-model-v1'))['units'][0]
        await self.grant(False,sequence=2)
        with self.assertRaises(HttpError):await self.complete(unit)
        # A stale grant cannot resurrect a more recent withdrawal.
        await self.grant(True,sequence=1)
        self.assertEqual((await risk.extraction_context(self.uid,'test-model-v1'))['units'],[])

    async def test_ai_quotes_are_grounded_and_never_set_a_grade(self):
        text='课程安排改变后，我难以适应。';self.media(text);await self.grant()
        unit=(await risk.extraction_context(self.uid,'test-model-v1'))['units'][0]
        await self.complete(unit,[{'feature':'functional_impact','quote':text,'certainty':'uncertain','subject':'self','level':'red'},
                                  {'feature':'safety','quote':'不存在的句子','certainty':'explicit','subject':'self'}])
        s=await self.state();self.assertEqual(s['level'],'unknown');self.assertEqual(len(s['ai']['findings']),1)
        self.assertNotIn('level',s['ai']['findings'][0])
        item=s['ai']['findings'][0]
        await risk.review(self.uid,{'item_id':item['id'],'source_hash':item['source_hash'],'action':'confirm_finding','note':'合成人工确认生活影响线索'},999)
        self.assertEqual((await self.state())['level'],'orange')

    async def test_source_edit_delete_and_prompt_version_invalidate_ai(self):
        _,sid=self.media('最初的合成原文');await self.grant()
        unit=(await risk.extraction_context(self.uid,'test-model-v1'))['units'][0]
        db.execute('UPDATE screening_supplements SET text=? WHERE id=?',('更正后的原文',sid))
        with self.assertRaises(HttpError):await self.complete(unit)
        fresh=(await risk.extraction_context(self.uid,'test-model-v1'))['units'][0];await self.complete(fresh)
        self.assertEqual((await self.state())['ai']['status'],'ready')
        await self.grant(sequence=2,version='new-model')
        self.assertEqual((await self.state())['ai']['status'],'pending')
        db.execute('DELETE FROM screening_supplements WHERE id=?',(sid,))
        self.assertEqual((await self.state())['coverage']['records'],0)

    async def test_history_permission_and_retry_preserve_rule_results(self):
        self.media('我很焦虑',days=1);await self.grant(history=False)
        self.assertEqual((await risk.extraction_context(self.uid,'test-model-v1'))['units'],[])
        self.media('我有点难过');ctx=await risk.extraction_context(self.uid,'test-model-v1')
        await self.complete(ctx['units'][0],status='failed')
        s=await self.state();self.assertEqual(s['ai']['status'],'failed');self.assertEqual(s['level'],'yellow')
        self.assertEqual((await risk.extraction_context(self.uid,'test-model-v1'))['units'],[])

    async def test_full_ledger_and_long_original_are_not_silently_truncated(self):
        for i in range(70):self.media(f'合成日常记录 {i}')
        self.media('长原文。'*1800)
        await self.grant()
        completed=0
        while True:
            ctx=await risk.extraction_context(self.uid,'test-model-v1')
            if not ctx['units']:break
            for unit in ctx['units']:await self.complete(unit);completed+=1
        s=await self.state()
        self.assertEqual(s['coverage']['records'],71);self.assertEqual(s['ai']['completed'],completed)
        self.assertGreater(completed,71);self.assertEqual(s['ai']['status'],'ready')

    async def test_population_counts_people_not_events(self):
        self.media('我有些难过');self.media('我有些难过')
        self.media(kind='image',uid=self.other)
        s=await risk.population();self.assertEqual(s['people'],2)
        self.assertEqual(s['distribution']['yellow'],1);self.assertEqual(s['distribution']['unknown'],1)

    async def test_stale_consent_and_shanghai_window_expiration(self):
        self.scale(score=7,days=29);self.media('合成原文');await self.grant()
        db.execute('UPDATE risk_ai_consent SET updated_at=0 WHERE user_id=?',(self.uid,))
        self.assertEqual((await risk.extraction_context(self.uid,'test-model-v1'))['units'],[])
        s=await self.state();self.assertEqual(s['ai']['status'],'paused')
        tomorrow=await risk.summary(self.uid,now=self.now+timedelta(days=1))
        self.assertEqual(tomorrow['level'],'unknown')

    async def test_workbench_and_case_list_use_current_grade_instead_of_latest_record_colour(self):
        from app.services import agent_workspace,case_service
        from app.handlers.admin import _admin_case_dict
        _,sid=self.scale(score=0)
        case=db.query_one('SELECT * FROM cases WHERE case_id=?',(self.case,))
        personal=await self.state()
        item=await _admin_case_dict(case,[])
        self.assertEqual(item['alertLevel'],personal['level'])
        subjects=await agent_workspace.current_subjects([{'user_id':self.uid,'subject':f'case:{case["id"]}','linked':True,'alert_level':'red'}],'live')
        self.assertEqual(subjects[0]['alert_level'],'green')
        filtered=await case_service.get_cases(alert_level='green')
        self.assertEqual(filtered['total'],1)

    async def test_unsigned_risk_context_and_extraction_rejected(self):
        from app.router import dispatch
        for method,path in [('GET','risk-context'),('GET','risk-summary'),('POST','risk-consent'),('POST','risk-extraction')]:
            status,_=await dispatch(method,'/api/internal/steward/'+path,query_string=f'user_id={self.uid}',body=b'{}')
            self.assertEqual(status,403)

    async def test_linked_safety_is_not_counted_twice_and_filename_edits_do_not_reopen_it(self):
        _,sid=self.scale(item9=1)
        code=db.query_one('SELECT screening_id FROM screenings WHERE id=?',(sid,))['screening_id']
        _,media=self.media(kind='audio',assessment={'safetyStatus':'needs_review','screeningId':code})
        current=await self.state();self.assertEqual(len(current['safety']['flags']),1)
        flag=current['safety']['flags'][0]
        await risk.review(self.uid,{'item_id':flag['id'],'source_hash':flag['source_hash'],'action':'resolve_safety','note':'合成：已核实关联量表提示'},999)
        db.execute('UPDATE screening_supplements SET filename=? WHERE id=?',('new-name.wav',media))
        self.assertEqual((await self.state())['safety']['status'],'not_identified')

    async def test_safety_after_six_thousand_characters_is_not_skipped(self):
        self.media('普通的合成文字。'*1000+'我现在想伤害自己')
        self.assertEqual((await self.state())['level'],'red')


if __name__=='__main__':unittest.main()
