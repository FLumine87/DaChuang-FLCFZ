import asyncio
import hashlib
import hmac
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch,AsyncMock
from types import SimpleNamespace

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.config import settings
from app.db import database as db
from app.core.auth import RequestContext
from app.core.exceptions import HttpError
from app.handlers import steward_bridge as bridge


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        settings.DATABASE_URL='sqlite:///'+str(Path(self.temp.name)/'test.db')
        db._local_conn=None;db.init_db_sync()
        self.alice=db.execute("INSERT INTO users(username,password_hash,name,role) VALUES ('test_alice','x','Alice','user')")
        self.bob=db.execute("INSERT INTO users(username,password_hash,name,role) VALUES ('test_bob','x','Bob','user')")
        os.environ['STEWARD_SYNC_SECRET']='test-only-secret'

    def tearDown(self):
        db._local_conn.close();db._local_conn=None;self.temp.cleanup()

    def signed(self,path='context',body=None,uid=None):
        raw=json.dumps(body,separators=(',',':')).encode() if body else b''
        ctx=RequestContext('POST' if body else 'GET','/api/internal/steward/'+path,f'user_id={uid or self.alice}' if not body else '',raw)
        stamp=str(int(time.time()))
        message=f"{stamp}\n{ctx.method}\n{ctx.path}\n{json.dumps(ctx.query,sort_keys=True,separators=(',',':'))}\n".encode()+raw
        ctx.headers={'x-steward-time':stamp,'x-steward-signature':hmac.new(b'test-only-secret',message,hashlib.sha256).hexdigest()}
        return ctx

    def test_signature_tampering_and_missing_credential_rejected(self):
        ctx=self.signed();bridge.authorize(ctx)
        ctx.query['user_id']=str(self.bob)
        with self.assertRaises(HttpError):bridge.authorize(ctx)
        with self.assertRaises(HttpError):bridge.authorize(RequestContext('GET','/api/internal/steward/context'))

    def test_outbox_ownership_and_deletions(self):
        db.execute("INSERT INTO screening_supplements(user_id,kind,text) VALUES (NULL,'text','unassigned admin record')")
        aid=db.execute("INSERT INTO screening_supplements(user_id,kind,text) VALUES (?,'text','alice only')",(self.alice,))
        db.execute("INSERT INTO screening_supplements(user_id,kind,text) VALUES (?,'text','bob only')",(self.bob,))
        data=asyncio.run(bridge.context(self.signed()))
        self.assertEqual(len(data['multimodal']),1);self.assertEqual(data['multimodal'][0]['text'],'alice only')
        first=data['version']
        db.execute('DELETE FROM screening_supplements WHERE id=?',(aid,))
        data=asyncio.run(bridge.context(self.signed()))
        self.assertGreater(data['version'],first);self.assertEqual(data['multimodal'],[])

    def test_plan_acceptance_idempotent_feedback_owned(self):
        body={'user_id':self.alice,'suggestion_id':'test-suggestion','title':'a small action','detail':'test'}
        first=asyncio.run(bridge.plan(self.signed('plan',body)))
        second=asyncio.run(bridge.plan(self.signed('plan',body)))
        self.assertEqual(first['id'],second['id'])
        ctx=RequestContext('POST','/api/personal/steward/feedback',body=json.dumps({'plan_id':first['id'],'value':'helpful'}).encode())
        ctx.user={'sub':self.bob}
        with self.assertRaises(HttpError):asyncio.run(bridge.feedback(ctx))
        ctx.user={'sub':self.alice};asyncio.run(bridge.feedback(ctx))
        state=asyncio.run(bridge.context(self.signed()))
        self.assertEqual(state['plans'][0]['feedback'],'helpful')

    def test_media_metadata_is_synced_without_requiring_text(self):
        db.execute("INSERT INTO screening_supplements(user_id,kind,filename) VALUES (?,'image','image.png')",(self.alice,))
        db.execute("INSERT INTO screening_supplements(user_id,kind,filename) VALUES (?,'audio','audio.wav')",(self.alice,))
        db.execute("INSERT INTO screening_supplements(user_id,kind,filename) VALUES (?,'image','other-user.png')",(self.bob,))
        data=asyncio.run(bridge.context(self.signed()))
        self.assertEqual([row['filename'] for row in data['multimodal']],['image.png','audio.wav'])
        self.assertTrue(all(not row['text'] for row in data['multimodal']))

    def test_worker_bindings_and_async_context(self):
        from app.services.steward_context import personal_context
        binding={'STEWARD_SYNC_SECRET':'worker-test-secret','STEWARD_AGENT_URL':'https://agent.example.test'}
        response=SimpleNamespace(ok=True,text=AsyncMock(return_value='{"context":"authorized context"}'))
        fetch=AsyncMock(return_value=response)
        with patch.object(bridge.runtime,'is_worker',return_value=True),patch.object(bridge.runtime,'get_binding',side_effect=binding.get),patch.dict(sys.modules,{'js':SimpleNamespace(fetch=fetch)}):
            self.assertEqual(bridge.setting('STEWARD_SYNC_SECRET'),'worker-test-secret')
            self.assertIn('authorized context',asyncio.run(personal_context(self.alice)))
        self.assertTrue(fetch.call_args.args[0].startswith('https://agent.example.test/'))


if __name__=='__main__':unittest.main()
