"""Isolated regression tests: never use the checkout's health records or model key."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from app.core.auth import require_user
from app.services import steward as service, steward_store as store
from app.api.v1.steward import router, clear


class StewardTests(unittest.TestCase):
    def test_risk_uses_latest_per_scale_and_never_mbti(self):
        self.enable()
        with store.transaction() as c:
            service.put_evidence(c,'1','screening','older','2026-11-16T00:00:00+00:00','原始量表',{'scale':'PHQ-9','alert_level':'orange'})
            service.put_evidence(c,'1','screening','newer',store.now(),'原始量表',{'scale':'PHQ-9','alert_level':'green'})
            service.put_evidence(c,'1','manual','type',store.now(),'我的 MBTI 是 INFP',{})
        data=self.client.get('/steward').json()
        self.assertEqual(data['indicators']['risk']['level'],'green')
        self.assertEqual(data['indicators']['mbti']['type'],'INFP')
        self.assertEqual(data['indicators']['mbti']['status'],'self_report')

    def test_no_screening_does_not_imply_low_risk_and_references_are_not_risk(self):
        self.enable()
        with store.transaction() as c:
            service.put_evidence(c,'1','screening','retrieval',store.now(),'参考结果',{'assessment':{'analysisMode':'retrieval','level':'red'}})
        self.assertEqual(self.client.get('/steward').json()['indicators']['risk']['level'],'unknown')

    def test_readable_portrait_is_available_without_memory_confirmation(self):
        self.enable();eid=self.seed()
        raw={'observations':[{'text':'近期有睡眠困扰','evidence_ids':[eid]}], 'portrait':[{'text':'你愿意表达自己的感受，也在寻找适合自己的调整方式。','evidence_ids':[eid]}], 'mbti':{'type':'INFP','reason':'推测','evidence_ids':[eid]}}
        with patch.object(service.llm_client,'chat',return_value=json.dumps(raw,ensure_ascii=False)):service.refresh('1')
        data=self.client.get('/steward').json()
        self.assertTrue(data['snapshot']['portrait'])
        self.assertNotIn('mbti',data['snapshot'],'one observation cannot assign a type')

    def test_missing_portrait_triggers_focused_generation(self):
        self.enable();eid=self.seed()
        observation={'observations':[{'text':'近期表达了睡眠困扰','evidence_ids':[eid]}]}
        portrait={'portrait':[{'text':'你愿意表达感受，也在主动寻找照顾自己的方法。','evidence_ids':[eid]}]}
        with patch.object(service.llm_client,'chat',side_effect=[json.dumps(observation),json.dumps(portrait)]):service.refresh('1')
        self.assertTrue(self.client.get('/steward').json()['snapshot']['portrait'])
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.engine = create_engine('sqlite:///' + str(Path(self.tmp.name)/'test.db'), connect_args={'check_same_thread':False})
        self.engine_patch = patch.object(store, 'engine', self.engine); self.engine_patch.start()
        store.init()
        self.graph = patch.object(service,'project_graph',return_value=True);self.graph.start()
        self.user = {'sub':'1','username':'alice','role':'user'}
        app=FastAPI();app.include_router(router)
        app.dependency_overrides[require_user]=lambda:self.user
        self.client=TestClient(app)
        self.client.get('/steward')

    def tearDown(self):
        self.client.close();self.graph.stop();self.engine_patch.stop();self.engine.dispose();self.tmp.cleanup()

    def enable(self,**extra):
        self.assertEqual(self.client.put('/steward/settings',json={**store.DEFAULTS,'enabled':True,**extra}).status_code,200)

    def seed(self,source='screening',key='a',body='最近准备考试，晚上入睡比较困难。',at=None):
        with store.transaction() as c:
            service.put_evidence(c,'1',source,key,at or store.now(),body,{})
        return service.evidence_id('1',source,key)

    def analyze(self,eid,callback=None):
        with store.transaction() as c:
            ids=[e['id'] for e in store.rows(c,'SELECT id FROM steward_evidence WHERE user_id=\'1\'')]
        value={'observations':[{'text':'最近提到入睡困扰','evidence_ids':[eid]}], 'traits':[{'text':'可能倾向自己处理压力','evidence_ids':ids}], 'suggestions':[{'title':'安排短暂放松','detail':'选择自己愿意尝试的小事','reason':'最近提到睡眠困扰','evidence_ids':[eid]}]}
        def call(*args,**kwargs):
            if callback:callback()
            return json.dumps(value,ensure_ascii=False)
        with patch.object(service.llm_client,'chat',side_effect=call):service.refresh('1')
        return self.client.get('/steward').json()

    def test_no_consent_no_context_and_account_isolation(self):
        self.seed();self.assertEqual(service.context('1'),'')
        self.enable();eid=self.seed();self.analyze(eid)
        self.user={'sub':'2','username':'bob','role':'user'}
        self.assertEqual(self.client.get('/steward').json()['evidence_count'],0)
        self.assertEqual(self.client.get('/steward/evidence').json(),[])
        self.assertEqual(service.context('2'),'')
        self.user={'sub':'1','username':'alice','role':'admin'}
        self.assertEqual(self.client.get('/steward').status_code,403)

    def test_grounding_confirmation_and_forgiving_source(self):
        self.enable();eid=self.seed();self.seed(key='b',at='2026-01-01T00:00:00+00:00');state=self.analyze(eid)
        self.assertEqual(state['snapshot']['source'],'ai')
        self.assertEqual(state['memories'][0]['status'],'pending')
        self.assertNotIn('可能倾向',service.context('1'))
        mid=state['memories'][0]['id']
        self.client.put('/steward/memories/'+mid,json={'action':'confirm'})
        self.assertIn('可能倾向',service.context('1'))
        self.client.put('/steward/memories/'+mid,json={'action':'correct','content':'我更喜欢和朋友讨论压力'})
        self.assertNotIn('入睡比较困难',service.context('1'))
        self.assertIn('我更喜欢和朋友讨论压力',service.context('1'))
        with store.transaction() as c:
            service.put_evidence(c,'1','screening','a',store.now(),'旧错误重新导入',{})
            self.assertIsNone(store.one(c,'SELECT id FROM steward_evidence WHERE id=:id',{'id':eid}))

    def test_withdrawal_immediately_invalidates_old_derived_state(self):
        self.enable(chat=True);eid=self.seed('chat');self.analyze(eid)
        self.client.put('/steward/settings',json={**store.DEFAULTS,'enabled':True,'chat':False})
        state=self.client.get('/steward').json()
        self.assertEqual(state['snapshot'],{})
        self.assertEqual(state['evidence_count'],0)
        self.assertEqual(state['memories'],[])
        self.assertNotIn('入睡',service.context('1'))

    def test_clear_during_model_request_cannot_resurrect(self):
        self.enable();eid=self.seed()
        state=self.analyze(eid,lambda:clear(store.account(self.user)))
        self.assertFalse(state['settings']['enabled'])
        self.assertEqual(state['memories'],[])
        self.assertEqual(state['snapshot'],{})
        self.assertEqual(state['evidence_count'],0)

    def test_invalid_model_citations_filtered_and_old_state_not_current(self):
        out=service.parse_output(json.dumps({'summary':'编造','observations':[{'text':'编造','evidence_ids':['foreign']}]}),{'own'})
        self.assertEqual(out['observations'],[])
        self.assertNotEqual(out['summary'],'编造')
        self.enable();eid=self.seed(at='2020-01-01');state=self.analyze(eid)
        self.assertEqual(state['snapshot']['observations'],[])
        self.assertIn('不足',state['snapshot']['summary'])

    def test_model_outage_preserves_previous_snapshot(self):
        self.enable();eid=self.seed();self.analyze(eid);self.seed(key='b',body='新增记录')
        with patch.object(service.llm_client,'chat',return_value=''):
            with self.assertRaises(RuntimeError):service.refresh('1')
        self.assertEqual(self.client.get('/steward').json()['version'],1)

    def test_durable_chat_idempotency_and_reconnect(self):
        self.enable(chat=True)
        body={'id':'message_12345','message':'我喜欢散步','history':[]}
        rid=self.client.post('/steward/chat/runs',json=body).json()['id']
        self.assertEqual(self.client.post('/steward/chat/runs',json=body).json()['id'],rid)
        with patch.object(service.llm_client,'stream_chat_messages',return_value=iter(['我在','听。'])):service.process_chat(rid)
        rows=self.client.get('/steward/chat/history').json()
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['reply'],'我在听。');self.assertEqual(rows[0]['status'],'done')
        self.user={'sub':'2','username':'bob','role':'user'}
        self.assertEqual(self.client.get('/steward/chat/runs/'+rid).status_code,404)

    def test_partial_chat_failure_is_explicit_and_retry_uses_same_job(self):
        rid=self.client.post('/steward/chat/runs',json={'id':'message_12345','message':'你好'}).json()['id']
        def broken(*args,**kwargs):
            yield '半句话'
            raise RuntimeError('broken')
        with patch.object(service.llm_client,'stream_chat_messages',side_effect=broken):service.process_chat(rid)
        row=self.client.get('/steward/chat/runs/'+rid).json()
        self.assertEqual(row['status'],'failed');self.assertEqual(row['reply'],'半句话')
        self.client.post('/steward/chat/runs',json={'id':'message_12345','message':'你好'})
        with patch.object(service.llm_client,'stream_chat_messages',return_value=iter(['完整回复'])):service.process_chat(rid)
        self.assertEqual(self.client.get('/steward/chat/runs/'+rid).json()['reply'],'完整回复')

    def test_sync_deduplicates_and_source_deletion_invalidates(self):
        self.enable()
        fixture={'user_id':'1','username':'alice','version':1,'scales':[],'plans':[],'multimodal':[{'id':1,'kind':'text','text':'自己的原文','created_at':store.now(),'analysis':json.dumps({'hits':[{'text':'别人的案例'}]})}]}
        with patch.object(service,'bridge',return_value=fixture):service.reconcile('1');service.reconcile('1')
        rows=self.client.get('/steward/evidence').json()
        self.assertEqual(len(rows),1);self.assertNotIn('别人的案例',json.dumps(rows,ensure_ascii=False))
        fixture['version']=2;fixture['multimodal']=[]
        with patch.object(service,'bridge',return_value=fixture):service.reconcile('1')
        self.assertEqual(self.client.get('/steward/evidence').json(),[])

    def test_multimodal_history_includes_all_types_without_mixing_chat_or_scales(self):
        self.enable()
        with store.transaction() as c:
            for i,kind in enumerate(('text','audio','image')):
                service.put_evidence(c,'1','screening',kind,f'2026-11-{10+i}T08:00:00+00:00','本人筛查内容',{'kind':kind,'filename':kind+'.test','assessment':{'conclusion':'当次参考','analysisMode':'retrieval'}})
            service.put_evidence(c,'1','chat','chat',store.now(),'聊天不是筛查',{'kind':'text'})
            service.put_evidence(c,'1','screening','scale',store.now(),'量表记录',{'scale':'PHQ-9','score':7,'max_score':27})
        state=self.client.get('/steward').json()
        self.assertEqual([e['kind'] for e in state['multimodal_history']],['image','audio','text'])
        self.assertEqual(state['multimodal_history'][0]['filename'],'image.test')
        self.assertEqual(state['multimodal_history'][0]['conclusion'],'当次参考')
        self.assertEqual(state['multimodal_history'][0]['analysis_mode'],'retrieval')
        self.assertEqual(len(state['series']['PHQ-9']),1)
        eid=state['multimodal_history'][0]['id']
        self.assertEqual(self.client.get('/steward/evidence',params={'ids':eid}).json()[0]['body'],'本人筛查内容')
        self.user={'sub':'2','username':'bob','role':'user'}
        self.assertEqual(self.client.get('/steward').json()['multimodal_history'],[])
        self.assertEqual(self.client.get('/steward/evidence',params={'ids':eid}).json(),[])
        self.user={'sub':'1','username':'alice','role':'user'}
        self.client.put('/steward/settings',json={**store.DEFAULTS,'enabled':False})
        self.assertEqual(self.client.get('/steward').json()['multimodal_history'],[])

    def test_media_without_transcript_migrates_once_and_is_not_model_evidence(self):
        self.enable()
        fixture={'user_id':'1','username':'alice','version':5,'scales':[],'plans':[],
                 'multimodal':[{'id':1,'kind':'audio','text':None,'description':None,'filename':'test.wav','created_at':store.now(),'analysis':None},
                               {'id':2,'kind':'image','filename':'test.png','created_at':store.now(),'analysis':None}]}
        # Simulate an existing, fully synced account from before this migration.
        with store.transaction() as c:store.execute(c,"UPDATE steward_accounts SET sync_version=5 WHERE user_id='1'")
        with patch.object(service,'bridge',side_effect=[fixture,{'user_id':'1','username':'alice','version':5}]) as bridge:
            service.reconcile('1');service.reconcile('1')
            self.assertIsNone(bridge.call_args_list[0].kwargs['after'])
            self.assertEqual(bridge.call_args_list[1].kwargs['after'],5)
        data=self.client.get('/steward').json()
        self.assertEqual(len(data['multimodal_history']),2)
        self.assertTrue(all(x['metadata_only'] for x in data['multimodal_history']))
        with store.transaction() as c:ev=store.rows(c,"SELECT * FROM steward_evidence WHERE user_id='1'")
        self.assertEqual(service.select_evidence(ev,ev),[])
        self.assertNotIn('筛查记录（未附带文字）',service.context('1'))
        self.assertNotIn('test.wav',service.context('1'))
        with patch.object(service.llm_client,'chat') as model:
            service.refresh('1');model.assert_not_called()
        self.assertEqual(self.client.get('/steward').json()['snapshot']['source'],'insufficient')
        # Removing a raw media record removes its history entry on the next sync.
        fixture['version']=6;fixture['multimodal']=fixture['multimodal'][:1]
        with patch.object(service,'bridge',return_value=fixture):service.reconcile('1')
        self.assertEqual([x['kind'] for x in self.client.get('/steward').json()['multimodal_history']],['audio'])

    def test_media_filename_backfill_preserves_existing_analysis(self):
        self.enable()
        payload={'kind':'audio','assessment':{'conclusion':None,'level':None,'safetyStatus':None,'analysisMode':None}}
        with store.transaction() as c:
            eid=service.put_evidence(c,'1','screening','multimodal:1',store.now(),'本人的语音转写',payload)
        self.analyze(eid)
        with store.transaction() as c:
            service.put_evidence(c,'1','screening','multimodal:1',store.now(),'本人的语音转写',{**payload,'filename':'test.wav'})
        self.assertTrue(self.client.get('/steward').json()['snapshot'])
        with patch.object(service.llm_client,'chat') as model:
            service.refresh('1');model.assert_not_called()

    def test_legacy_graph_requires_confirmation_and_does_not_become_recent_state(self):
        self.enable(chat=True)
        from app.services import kg_service
        graph={'neo4j_connected':True,'links':[{'relation':'LIKES','target':'Interest:散步'},{'relation':'SHOWS_SYMPTOM','target':'Symptom:失眠'}]}
        with patch.object(kg_service,'get_subgraph',return_value=graph):service.import_legacy_graph('1','alice')
        result=self.client.get('/steward').json()
        self.assertEqual(len(result['memories']),1)
        self.assertEqual(result['memories'][0]['status'],'pending')
        self.assertNotIn('散步',service.context('1'))
        self.client.put('/steward/memories/'+result['memories'][0]['id'],json={'action':'confirm'})
        self.assertIn('喜欢散步',service.context('1'))
        with patch.object(service.llm_client,'chat') as model:service.refresh('1');model.assert_not_called()
        self.assertEqual(self.client.get('/steward').json()['snapshot']['source'],'insufficient')

    def test_stream_rejects_truncation_and_silent_eof(self):
        from unittest.mock import MagicMock
        for lines in (["data: {\"choices\":[{\"delta\":{\"content\":\"半句\"}}]}"],
                      ["data: {\"choices\":[{\"delta\":{\"content\":\"半句\"},\"finish_reason\":\"length\"}]}","data: [DONE]"]):
            client=MagicMock();response=MagicMock()
            client.__enter__.return_value.stream.return_value.__enter__.return_value=response
            response.iter_lines.return_value=iter(lines)
            with patch.object(service.llm_client,'mock_mode',return_value=False),patch.object(service.llm_client.httpx,'Client',return_value=client):
                with self.assertRaises(RuntimeError):list(service.llm_client.stream_chat_messages([]))

    def test_chat_volume_cannot_displace_screening_evidence(self):
        chats=[{'id':str(i),'source':'chat','body':'日常聊天','payload':'{}'} for i in range(100)]
        scales=[{'id':'scale','source':'screening','body':'量表结果','payload':'{"scale":"PHQ-9"}'}, {'id':'media','source':'screening','body':'多模态近况','payload':'{}'}]
        chosen=service.select_evidence(chats+scales,chats+scales)
        self.assertIn('scale',[e['id'] for e in chosen]);self.assertIn('media',[e['id'] for e in chosen])
        self.assertLessEqual(len(chosen),65)

    def test_graph_distinguishes_evidence_memory_observation_and_suggestion(self):
        self.enable();eid=self.seed();self.seed(key='b',at='2026-01-01T00:00:00+00:00');self.analyze(eid)
        with patch('app.core.neo4j.neo4j_health',return_value=False):
            graph=self.client.get('/steward/graph').json()
        self.assertTrue({'Evidence','Memory','Observation','Suggestion'} <= {n['label'] for n in graph['nodes']})
        ids={n['id'] for n in graph['nodes']}
        self.assertTrue(all(e['source'] in ids and e['target'] in ids for e in graph['links']))

    def test_disabled_account_retries_graph_cleanup_when_graph_was_offline(self):
        with patch.object(service,'project_graph',return_value=False):service.cleanup_user('1')
        with store.transaction() as c:
            a=store.one(c,'SELECT * FROM steward_accounts WHERE user_id=\'1\'')
        self.assertEqual(a['dirty'],1)
        with patch.object(service,'project_graph',return_value=True):service.cleanup_user('1')
        with store.transaction() as c:
            a=store.one(c,'SELECT * FROM steward_accounts WHERE user_id=\'1\'')
        self.assertEqual(a['dirty'],0)


if __name__=='__main__':unittest.main()
