"""Fetch consent-filtered AI context live; fail closed when unavailable."""
import hashlib
import hmac
import json
import time
import urllib.parse
import urllib.request
import asyncio
from app.core import runtime
from app.handlers.steward_bridge import setting


async def _steward_context(uid):
    base=setting('STEWARD_AGENT_URL').rstrip('/')
    secret=setting('STEWARD_SYNC_SECRET')
    if not base or not secret:
        return ''
    path='/api/v1/steward/internal/context'
    params={'user_id':str(uid)}
    stamp=str(int(time.time()))
    signed=f"{stamp}\nGET\n{path}\n{json.dumps(params,sort_keys=True,separators=(',',':'))}\n".encode()
    req=urllib.request.Request(base+path+'?'+urllib.parse.urlencode(params),headers={'x-steward-time':stamp,'x-steward-signature':hmac.new(secret.encode(),signed,hashlib.sha256).hexdigest()})
    try:
        if runtime.is_worker():
            from js import fetch
            response=await asyncio.wait_for(fetch(req.full_url,{'method':'GET','headers':dict(req.header_items())}),timeout=4)
            if not response.ok:return ''
            data=json.loads(str(await response.text()))
        else:
            def read():
                opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
                with opener.open(req,timeout=4) as response:return json.load(response)
            data=await asyncio.to_thread(read)
        return str(data.get('context') or '')
    except Exception:
        return ''


async def personal_context(uid):
    memory=await _steward_context(uid)
    try:
        from app.services.risk_summary import summary
        risk=await summary(uid)
        canonical={'level':risk['level'],'label':risk['label'],'safety_status':risk['safety']['status'],
                   'rule_version':risk['rule_version'],'data_version':risk['data_version']}
        return '服务端统一近期综合等级（与本次检测结果分别解释，不得改写，不代表诊断或自伤概率）：'+json.dumps(canonical,ensure_ascii=False)+'\n'+memory
    except Exception:
        return '统一近期综合等级暂不可用，不得自行补造等级。\n'+memory
