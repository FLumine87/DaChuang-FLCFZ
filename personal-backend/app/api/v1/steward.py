import hashlib
import hmac
import os
import json
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ...core.auth import require_user
from ...services import steward as service, steward_store as db

router = APIRouter(prefix='/steward', tags=['personal-steward'])


@router.get('/internal/context')
def internal_context(request: Request, user_id: str):
    secret=os.environ.get('STEWARD_SYNC_SECRET','')
    stamp=request.headers.get('x-steward-time','')
    try:
        fresh=abs(time.time()-int(stamp))<60
    except ValueError:
        fresh=False
    params={'user_id':user_id}
    message=f"{stamp}\nGET\n{request.url.path}\n{json.dumps(params,sort_keys=True,separators=(',',':'))}\n".encode()
    expected=hmac.new(secret.encode(),message,hashlib.sha256).hexdigest()
    if not secret or not fresh or not hmac.compare_digest(expected,request.headers.get('x-steward-signature','')):
        raise HTTPException(403,'内部服务身份校验失败')
    return {'context':service.context(user_id)}


def current(user=Depends(require_user)):
    return db.account(user)


def get_account(c, uid):
    return db.one(c, 'SELECT * FROM steward_accounts WHERE user_id=:u', {'u':uid})


def invalidate(c, uid):
    db.execute(c, "UPDATE steward_accounts SET snapshot='{}',fingerprint='',sync_version=-1 WHERE user_id=:u", {'u':uid})
    db.execute(c, "DELETE FROM steward_suggestions WHERE user_id=:u AND state='suggested'", {'u':uid})
    db.dirty(uid, c)


def expire_prompts(c,uid):
    from sqlalchemy import inspect
    if inspect(c).has_table('daily_checkins'):
        a=get_account(c,uid)
        db.execute(c,"UPDATE daily_checkins SET status='expired' WHERE status='pending' AND user_id IN (:u,:n)",{'u':uid,'n':a['username']})


@router.get('')
def state(a=Depends(current)):
    uid = a['user_id']
    with db.transaction() as c:
        ev = db.rows(c, 'SELECT * FROM steward_evidence WHERE user_id=:u ORDER BY occurred_at DESC', {'u':uid})
        ids = {e['id'] for e in ev}
        memories = db.rows(c, "SELECT * FROM steward_memories WHERE user_id=:u AND status IN ('pending','confirmed') ORDER BY created_at DESC", {'u':uid})
        suggestions = db.rows(c, 'SELECT * FROM steward_suggestions WHERE user_id=:u ORDER BY created_at DESC', {'u':uid})
        for group in (memories, suggestions):
            group[:] = [x for x in group if set(db.load(x['evidence_ids'], [])) <= ids]
            for x in group:
                x['evidence_ids'] = db.load(x['evidence_ids'], [])
        # Same-scale series retain individual dates, rather than averaging unlike instruments.
        series = {}
        multimodal_history=[]
        for e in ev:
            p = db.load(e['payload'])
            if e['source']=='screening' and p.get('kind') in ('text','audio','image'):
                assessment=p.get('assessment') or {}
                multimodal_history.append({'id':e['id'],'at':e['occurred_at'],'kind':p['kind'],'summary':e['body'][:180],'filename':p.get('filename',''),'conclusion':assessment.get('conclusion') or '', 'level':assessment.get('level'),'analysis_mode':assessment.get('analysisMode'),'metadata_only':bool(p.get('metadata_only'))})
            if p.get('scale'):
                series.setdefault(p['scale'], []).append({'at':e['occurred_at'], 'score':p.get('score'), 'max':p.get('max_score'), 'id':e['id'], 'version':db.load(p.get('answers')).get('_meta', {}).get('questionnaireVersion')})
        return {'settings': db.load(a['settings']), 'version':a['version'], 'updated_at':a['updated_at'],
                'indicators':service.profile_indicators(ev) if db.enabled(a) else {'risk':{'level':'unknown'},'mbti':None},
                'snapshot': service.valid_snapshot(a,c), 'status':'paused' if not db.enabled(a) else 'failed' if a['sync_error'] else 'updating' if a['dirty'] or a['lease'] > time.time() else 'ready',
                'error':a['sync_error'], 'evidence_count':len(ev), 'memories':memories if db.enabled(a) else [], 'suggestions':suggestions if db.enabled(a) else [], 'series':series if db.enabled(a) else {},'multimodal_history':multimodal_history if db.enabled(a) else []}


class SettingsInput(BaseModel):
    enabled: bool
    screening: bool = True
    chat: bool = False
    checkin: bool = False
    feedback: bool = False
    history: bool = True


@router.put('/settings')
def settings(body: SettingsInput, a=Depends(current)):
    uid, updated = a['user_id'], body.model_dump()
    with db.transaction() as c:
        old = db.load(get_account(c,uid)['settings'])
        if old['enabled'] and (not updated['enabled'] or any(old[k] and not updated[k] for k in ('screening','chat','checkin','feedback','history'))):
            expire_prompts(c,uid)
        if old['chat'] != updated['chat']:
            db.execute(c,"DELETE FROM steward_imports WHERE user_id=:u AND kind='graph'",{'u':uid})
        db.execute(c, 'UPDATE steward_accounts SET settings=:s,since=CASE WHEN :reset THEN :at ELSE since END WHERE user_id=:u', {'u':uid,'s':db.dump(updated), 'reset':not updated['history'] and (old['history'] or not old['enabled']), 'at':db.now()})
        for source in ('screening','chat','checkin','feedback'):
            if not updated[source]:
                db.execute(c, 'DELETE FROM steward_evidence WHERE user_id=:u AND source=:s', {'u':uid,'s':source})
        live = {r['id'] for r in db.rows(c,'SELECT id FROM steward_evidence WHERE user_id=:u',{'u':uid})}
        for m in db.rows(c,'SELECT * FROM steward_memories WHERE user_id=:u',{'u':uid}):
            if not set(db.load(m['evidence_ids'], [])) <= live:
                db.execute(c,'DELETE FROM steward_memories WHERE id=:id',{'id':m['id']})
        invalidate(c, uid)
    try:
        service.project_graph(uid)
    except Exception:
        pass
    return {'saved':True}


@router.post('/refresh')
def refresh(a=Depends(current)):
    if not db.enabled(a):
        raise HTTPException(409,'请先开启心理管家')
    with db.transaction() as c:
        db.execute(c,"UPDATE steward_accounts SET fingerprint='' WHERE user_id=:u",{'u':a['user_id']})
        db.dirty(a['user_id'],c)
    return {'queued':True}


@router.get('/evidence')
def evidence(offset: int=0, ids: str='', a=Depends(current)):
    with db.transaction() as c:
        if not db.enabled(a):
            return []
        items = db.rows(c,'SELECT * FROM steward_evidence WHERE user_id=:u ORDER BY occurred_at DESC,id LIMIT 50 OFFSET :o',{'u':a['user_id'],'o':max(0,offset)})
        if ids:
            requested=set(ids.split(',')[:30])
            items=[r for r in db.rows(c,'SELECT * FROM steward_evidence WHERE user_id=:u',{'u':a['user_id']}) if r['id'] in requested]
        for item in items:
            item['payload'] = db.load(item['payload'])
        return items


def suppress(c, uid, eid):
    item = db.one(c,'SELECT * FROM steward_evidence WHERE id=:id AND user_id=:u',{'id':eid,'u':uid})
    if not item:
        return
    expire_prompts(c,uid)
    db.execute(c,'INSERT INTO steward_suppressed(user_id,source,source_key) VALUES (:u,:s,:k) ON CONFLICT DO NOTHING',{'u':uid,'s':item['source'],'k':item['source_key']})
    db.execute(c,'DELETE FROM steward_evidence WHERE id=:id AND user_id=:u',{'u':uid,'id':eid})
    for m in db.rows(c,'SELECT * FROM steward_memories WHERE user_id=:u',{'u':uid}):
        if eid in db.load(m['evidence_ids'], []):
            db.execute(c,'DELETE FROM steward_memories WHERE id=:id',{'id':m['id']})
    invalidate(c,uid)


@router.delete('/evidence/{eid}')
def forget_evidence(eid: str, a=Depends(current)):
    with db.transaction() as c:
        suppress(c,a['user_id'],eid)
    try:
        service.project_graph(a['user_id'])
    except Exception:
        pass
    return {'forgotten':True}


class MemoryInput(BaseModel):
    content: str = Field(min_length=1,max_length=1000)


@router.post('/memories')
def remember(body: MemoryInput, a=Depends(current)):
    if not db.enabled(a):
        raise HTTPException(409,'请先开启心理管家')
    mid = uuid.uuid4().hex
    eid = service.evidence_id(a['user_id'],'manual',mid)
    with db.transaction() as c:
        service.put_evidence(c,a['user_id'],'manual',mid,db.now(),body.content,{})
        db.execute(c,"INSERT INTO steward_memories(id,user_id,kind,content,evidence_ids,status,corrected,created_at) VALUES (:id,:u,'self_report',:t,:e,'confirmed',1,:at)",{'id':mid,'u':a['user_id'],'t':body.content,'e':db.dump([eid]),'at':db.now()})
        db.dirty(a['user_id'],c)
    return {'saved':True}


class MemoryChange(BaseModel):
    action: str = Field(pattern='^(confirm|correct|forget)$')
    content: str = Field(default='',max_length=1000)


@router.put('/memories/{mid}')
def change_memory(mid: str, body: MemoryChange, a=Depends(current)):
    uid=a['user_id']
    with db.transaction() as c:
        m=db.one(c,'SELECT * FROM steward_memories WHERE id=:id AND user_id=:u',{'id':mid,'u':uid})
        if not m:
            raise HTTPException(404,'记忆不存在')
        if body.action=='forget':
            for eid in db.load(m['evidence_ids'],[]):
                suppress(c,uid,eid)
        elif body.action=='confirm':
            db.execute(c,"UPDATE steward_memories SET status='confirmed' WHERE id=:id",{'id':mid})
        else:
            if not body.content.strip():
                raise HTTPException(400,'请填写纠正后的内容')
            # Exclude incorrect evidence so a model cannot resurrect the discarded claim.
            for eid in db.load(m['evidence_ids'],[]):
                suppress(c,uid,eid)
            correction_key=uuid.uuid4().hex
            service.put_evidence(c,uid,'manual',correction_key,db.now(),body.content,{})
            db.execute(c,"INSERT INTO steward_memories(id,user_id,kind,content,evidence_ids,status,corrected,created_at) VALUES (:id,:u,'self_report',:t,:e,'confirmed',1,:at)",{'id':mid,'u':uid,'t':body.content,'e':db.dump([service.evidence_id(uid,'manual',correction_key)]),'at':db.now()})
        invalidate(c,uid)
    try:
        service.project_graph(uid)
    except Exception:
        pass
    return {'saved':True}


@router.delete('/memory')
def clear(a=Depends(current)):
    uid=a['user_id']
    with db.transaction() as c:
        for e in db.rows(c,'SELECT id FROM steward_evidence WHERE user_id=:u',{'u':uid}):
            suppress(c,uid,e['id'])
        for table in ('steward_memories','steward_suggestions'):
            db.execute(c,f'DELETE FROM {table} WHERE user_id=:u',{'u':uid})
        s=db.load(a['settings']);s.update(enabled=False,history=False)
        db.execute(c,'UPDATE steward_accounts SET settings=:s,since=:at WHERE user_id=:u',{'u':uid,'s':db.dump(s),'at':db.now()})
        invalidate(c,uid)
    try:
        service.project_graph(uid)
    except Exception:
        pass
    return {'cleared':True}


class SuggestionAction(BaseModel):
    action: str = Field(pattern='^(accept|dismiss)$')
    title: str = Field(default='',max_length=200)


@router.post('/suggestions/{sid}')
def suggestion(sid: str, body: SuggestionAction, a=Depends(current)):
    with db.transaction() as c:
        item=db.one(c,'SELECT * FROM steward_suggestions WHERE id=:id AND user_id=:u',{'id':sid,'u':a['user_id']})
    if not item or not db.enabled(a):
        raise HTTPException(404,'建议不存在')
    if body.action=='accept':
        with db.transaction() as c:
            ids={r['id'] for r in db.rows(c,'SELECT id FROM steward_evidence WHERE user_id=:u',{'u':a['user_id']})}
        if not set(db.load(item['evidence_ids'],[])) <= ids:
            raise HTTPException(409,'建议依据已经变化，请刷新档案')
        try:
            result=service.bridge('plan',uid=a['user_id'],body={'user_id':a['user_id'],'suggestion_id':sid,'title':body.title.strip() or item['title'],'detail':item['detail']})
        except Exception:
            raise HTTPException(503,'行动计划暂未保存，请稍后重试')
        with db.transaction() as c:
            db.execute(c,"UPDATE steward_suggestions SET state='accepted',plan_id=:p WHERE id=:id AND user_id=:u",{'p':result['id'],'id':sid,'u':a['user_id']})
    else:
        with db.transaction() as c:
            db.execute(c,"UPDATE steward_suggestions SET state='dismissed' WHERE id=:id AND user_id=:u",{'id':sid,'u':a['user_id']})
    return {'saved':True}


@router.get('/graph')
def graph(a=Depends(current)):
    result=state(a)
    uid=a['user_id'];nodes=[{'id':uid,'name':'我','label':'User'}];links=[]
    with db.transaction() as c:
        ev=db.rows(c,'SELECT * FROM steward_evidence WHERE user_id=:u',{'u':uid}) if db.enabled(a) else []
        derived=service.derived_graph(a,c,{e['id'] for e in ev})
    for e in ev:
        nodes.append({'id':e['id'],'name':e['body'][:30],'label':'Evidence','category':e['source']})
        links.append({'source':uid,'target':e['id'],'relation':'本人记录','category':e['occurred_at'][:10]})
    for m in result['memories']:
        nodes.append({'id':m['id'],'name':m['content'],'label':'Memory','category':m['status']})
        links.append({'source':uid,'target':m['id'],'relation':'已确认' if m['status']=='confirmed' else '待确认','category':m['status']})
        for eid in m['evidence_ids']:
            links.append({'source':m['id'],'target':eid,'relation':'依据','category':'依据'})
    for item in derived:
        nodes.append({'id':item['id'],'name':item['name'],'label':item['kind'],'category':item['status']})
        links.append({'source':uid,'target':item['id'],'relation':item['status']})
        for eid in item['evidence_ids']:
            links.append({'source':item['id'],'target':eid,'relation':'依据'})
    from ...core.neo4j import neo4j_health
    return {'user_id':uid,'nodes':nodes,'links':links,'neo4j_connected':neo4j_health(),'mock':False,'steward':True}


class ChatInput(BaseModel):
    id: str = Field(pattern='^[a-zA-Z0-9_-]{8,80}$')
    message: str = Field(min_length=1,max_length=4000)
    history: list[dict] = Field(default_factory=list,max_length=12)


class SafetyInput(BaseModel):
    message: str = Field(min_length=1,max_length=4000)


@router.post('/safety')
def safety(body: SafetyInput,a=Depends(current)):
    from ...services.clinical_lexicon import scan_crisis
    return {'crisis_hits':scan_crisis(body.message)}


@router.post('/chat/runs')
def submit_chat(body: ChatInput,a=Depends(current)):
    # IDs are namespaced by stable authenticated user ID, never by a browser-supplied identity.
    rid=hashlib.sha256(f"{a['user_id']}:{body.id}".encode()).hexdigest()
    history=[{'role':x['role'],'content':str(x.get('text') or x.get('content') or '')[:4000]} for x in body.history if x.get('role') in ('user','assistant')]
    with db.transaction() as c:
        db.execute(c,'INSERT INTO steward_chat_runs(id,user_id,message,history,created_at) VALUES (:id,:u,:m,:h,:at) ON CONFLICT(id) DO NOTHING',{'id':rid,'u':a['user_id'],'m':body.message,'h':db.dump(history),'at':db.now()})
        row=db.one(c,'SELECT * FROM steward_chat_runs WHERE id=:id',{'id':rid})
        if row['message'] != body.message:
            raise HTTPException(409,'消息标识已用于其他内容')
        if row['status']=='failed':
            db.execute(c,"UPDATE steward_chat_runs SET status='queued',error='' WHERE id=:id",{'id':rid})
    return {'id':rid}


@router.get('/chat/runs/{rid}')
def chat_run(rid: str,a=Depends(current)):
    with db.transaction() as c:
        row=db.one(c,'SELECT id,message,reply,status,error,created_at FROM steward_chat_runs WHERE id=:id AND user_id=:u',{'id':rid,'u':a['user_id']})
    if not row:
        raise HTTPException(404,'对话不存在')
    return row


@router.post('/chat/runs/{rid}/retry')
def retry_chat(rid: str,a=Depends(current)):
    chat_run(rid,a)
    with db.transaction() as c:
        db.execute(c,"UPDATE steward_chat_runs SET status='queued',error='' WHERE id=:id AND user_id=:u AND status='failed'",{'id':rid,'u':a['user_id']})
    return {'queued':True}


@router.get('/chat/history')
def chat_history(a=Depends(current)):
    with db.transaction() as c:
        return db.rows(c,'SELECT id,message,reply,status,error,created_at FROM steward_chat_runs WHERE user_id=:u ORDER BY created_at DESC LIMIT 200',{'u':a['user_id']})[::-1]


@router.delete('/chat/history')
def clear_chat(a=Depends(current)):
    with db.transaction() as c:
        db.execute(c,'DELETE FROM steward_chat_runs WHERE user_id=:u',{'u':a['user_id']})
    return {'cleared':True}


class HistoryImport(BaseModel):
    messages: list[dict] = Field(max_length=200)


@router.post('/chat/import')
def import_chat(body: HistoryImport,a=Depends(current)):
    if not db.enabled(a,'chat') or not db.load(a['settings'])['history']:
        raise HTTPException(409,'需要先允许聊天记忆和历史导入')
    with db.transaction() as c:
        for m in body.messages:
            if m.get('role')!='user' or not str(m.get('text','')).strip():
                continue
            key=hashlib.sha256(db.dump([m.get('at'),m.get('id'),m.get('text')]).encode()).hexdigest()
            at=str(m.get('at') or '')
            if not at:
                continue
            service.put_evidence(c,a['user_id'],'chat','import:'+key,at,str(m['text'])[:4000],{})
        db.dirty(a['user_id'],c)
    return {'imported':True}
