"""Verify request failures without using any model credentials or network."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import httpx

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.services import llm_client as llm


class ModelFailureTests(unittest.TestCase):
    def call(self,handler,strict=True):
        client=httpx.Client
        with patch.object(llm,'mock_mode',return_value=False),patch.object(llm.httpx,'Client',side_effect=lambda **kw:client(transport=httpx.MockTransport(handler),trust_env=False,**kw)):
            return llm.chat('test system','private synthetic input',strict=strict)

    def test_http_errors_are_distinguished_and_safe(self):
        for status in (400,401,402,403,404,429,500,502,503):
            with self.subTest(status=status),self.assertRaises(llm.LLMRequestError) as caught:
                self.call(lambda req:httpx.Response(status,json={'error':'private synthetic input SECRET'}))
            self.assertEqual(caught.exception.status,status)
            self.assertNotIn('SECRET',str(caught.exception))

    def test_timeout_has_specific_reason_and_legacy_still_falls_back(self):
        def timeout(request):raise httpx.ReadTimeout('SECRET',request=request)
        with self.assertRaises(llm.LLMRequestError) as caught:self.call(timeout)
        self.assertEqual(caught.exception.code,'timeout')
        self.assertNotIn('SECRET',str(caught.exception))
        self.assertEqual(self.call(timeout,strict=False),'')

    def test_malformed_empty_and_truncated_responses(self):
        for data,code in (({},'response_format'),({'choices':[{'message':{'content':None}}]},'empty_response'),({'choices':[{'finish_reason':'length','message':{'content':'partial'}}]},'incomplete')):
            with self.subTest(code=code),self.assertRaises(llm.LLMRequestError) as caught:self.call(lambda req:httpx.Response(200,json=data))
            self.assertEqual(caught.exception.code,code)

    def test_profile_timeout_and_output_budget_do_not_change_global_configuration(self):
        import json
        original_timeout=llm.settings.llm_timeout
        client=httpx.Client
        seen={}
        def handler(request):
            seen.update(json.loads(request.content))
            return httpx.Response(200,json={'choices':[{'message':{'content':'OK'},'finish_reason':'stop'}]})
        def factory(**kw):
            self.assertEqual(kw['timeout'],180)
            return client(transport=httpx.MockTransport(handler),trust_env=False,**kw)
        with patch.object(llm,'mock_mode',return_value=False),patch.object(llm.httpx,'Client',side_effect=factory):
            self.assertEqual(llm.chat('system','synthetic',strict=True,request_timeout=180,max_tokens=8192),'OK')
        self.assertEqual(seen['max_tokens'],8192)
        self.assertEqual(llm.settings.llm_timeout,original_timeout)

    def test_content_parts_are_supported(self):
        self.assertEqual(self.call(lambda req:httpx.Response(200,json={'choices':[{'message':{'content':[{'type':'text','text':'OK'}]},'finish_reason':'stop'}]})),'OK')


if __name__=='__main__':unittest.main()
