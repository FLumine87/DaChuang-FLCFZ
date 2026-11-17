"""One user-level screening summary. Never average unlike scales or predict suicide.

Source records remain immutable. Reads recompute from the complete ledger so that
deletions, edits and Shanghai day boundaries cannot leave stale current levels.
"""
import hashlib
import json
import re
import time
from datetime import datetime, timedelta, timezone

from app.core.exceptions import HttpError
from app.db import database as db
from app.services import screening_assessment as rules

VERSION = 'recent-screening-v1'
CHINA = timezone(timedelta(hours=8))
LABELS = {'unknown':'待评估', 'green':'现有记录未提示明显关注信号', 'yellow':'需要关注',
          'orange':'建议人工复核', 'red':'需及时安全复核'}
ORDER = {'unknown':-1,'green':0,'yellow':1,'orange':2,'red':3}
DOMAINS = {'PHQ-9':'抑郁相关症状','GAD-7':'焦虑相关症状','ISI':'睡眠','PSS-10':'压力'}
FEATURES = {'symptom','duration','frequency','functional_impact','safety'}
CONSENT_TTL = 300  # A stopped/offline personal service cannot leave AI consent live forever.
SCHEMA = [
    """CREATE TABLE IF NOT EXISTS risk_ai_consent (
      user_id INTEGER PRIMARY KEY,enabled INTEGER NOT NULL,history INTEGER NOT NULL,
      since_at TEXT NOT NULL,revision TEXT NOT NULL,sequence INTEGER NOT NULL,
      extractor_version TEXT NOT NULL,updated_at REAL NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS risk_extractions (
      user_id INTEGER NOT NULL,source_id TEXT NOT NULL,source_hash TEXT NOT NULL,
      extractor_version TEXT NOT NULL,status TEXT NOT NULL,findings TEXT NOT NULL DEFAULT '[]',
      error TEXT NOT NULL DEFAULT '',retry_at REAL NOT NULL DEFAULT 0,updated_at REAL NOT NULL,
      PRIMARY KEY(user_id,source_id,source_hash,extractor_version))""",
    """CREATE TABLE IF NOT EXISTS risk_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,item_id TEXT NOT NULL,
      source_hash TEXT NOT NULL,action TEXT NOT NULL,note TEXT NOT NULL,
      actor_id INTEGER NOT NULL,created_at TEXT NOT NULL)""",
    'CREATE INDEX IF NOT EXISTS ix_risk_reviews_user ON risk_reviews(user_id,id)',
]


def dump(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))


def digest(value):
    return hashlib.sha256(dump(value).encode()).hexdigest()


def stamp(value, *, utc=False):
    try:
        parsed=datetime.fromisoformat(str(value).replace('Z','+00:00'))
        return (parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc if utc else CHINA)).astimezone(CHINA)
    except (ValueError,TypeError):
        return None


async def ensure_schema():
    for sql in SCHEMA:
        await db.execute_a(sql)


async def sources(uid):
    scales=await db.query_a("SELECT s.*,q.code AS questionnaire_code,q.name AS questionnaire_name FROM screenings s LEFT JOIN questionnaires q ON s.questionnaire_id=q.id WHERE s.user_id=? AND s.status='completed'",(uid,))
    media=await db.query_a('SELECT * FROM screening_supplements WHERE user_id=?',(uid,))
    result=[]
    for kind,rows in (('scale',scales),('multimodal',media)):
        for row in rows:
            # Business screening dates are local; supplements use SQLite UTC timestamps.
            at=stamp(row.get('screening_date') or row.get('created_at'),utc=kind=='multimodal')
            analysis=rules._json(row.get('analysis')) if kind=='multimodal' else {}
            assessment=analysis.get('assessment') or {}
            text=str(row.get('text') or '') if kind=='multimodal' else ''
            # Description/RAG/reference features are not a transcript of the user.
            if not text and row.get('kind')=='audio' and isinstance(analysis.get('transcript'),str):
                text=analysis['transcript']
            source={'id':f'{kind}:{row["id"]}','kind':row.get('kind') or 'scale',
                    'at':at.isoformat() if at else '', 'text':text,
                    'scale':rules._scale_result(row) if kind=='scale' else None,
                    'code':row.get('questionnaire_code'), 'assessment':assessment,
                    'reference':row.get('screening_id') or f'采集 #{row["id"]}',
                    'scale_version':rules._json(rules._json(row.get('answers')).get('_meta')).get('questionnaireVersion'),
                    'filename':str(row.get('filename') or '')}
            source['hash']=digest({**{k:v for k,v in source.items() if k!='filename'},'raw_answers':row.get('answers'),'raw_score':row.get('score')})
            result.append(source)
    return sorted(result,key=lambda s:(s['at'],s['id']),reverse=True)


def chunks(source):
    text=source['text']
    return [{'id':source['id']+f':part:{i}','source_id':source['id'],'source_hash':source['hash'],
             'at':source['at'],'text':text[start:start+4000]}
            for i,start in enumerate(range(0,len(text),3800))]


def in_window(source,today,days=30):
    date=stamp(source['at'])
    return bool(date and today-timedelta(days=days-1)<=date.date()<=today)


def active_consent(value):
    value=dict(value or {})
    if value.get('updated_at',0)<time.time()-CONSENT_TTL:value['enabled']=0
    return value


def source_signals(text):
    parts=[rules.extract_signals(text[start:start+4000]) for start in range(0,len(text),3800)] or [rules.extract_signals('')]
    result={**parts[0],'dimensions':list(dict.fromkeys(d for p in parts for d in p['dimensions']))}
    for key in ('negative','safetySignal','historicalSafety','positive'):result[key]=any(p[key] for p in parts)
    return result


def allowed(source,consent):
    at=stamp(source['at']);since=stamp(consent.get('since_at'))
    return bool(consent.get('enabled') and (consent.get('history') or (at and since and at>=since)))


def validate_findings(raw,unit):
    if not isinstance(raw,list):raise HttpError(400,'线索格式无效')
    cleaned=[]
    for item in raw:
        if not isinstance(item,dict):continue
        quote=item.get('quote');feature=item.get('feature');certainty=item.get('certainty')
        if (feature not in FEATURES or certainty not in ('explicit','uncertain') or
            item.get('subject')!='self' or not isinstance(quote,str) or not quote.strip() or
            len(quote)>800 or quote not in unit['text']):continue
        # The model may suggest a feature, never a grade or a probability.
        value={'feature':feature,'quote':quote,'certainty':certainty,'subject':'self'}
        value['id']='ai:'+digest([unit['id'],unit['source_hash'],value])[:24]
        cleaned.append(value)
    return cleaned


async def extraction_context(uid,extractor_version):
    await ensure_schema()
    consent=active_consent(await db.query_one_a('SELECT * FROM risk_ai_consent WHERE user_id=?',(uid,)))
    if not consent or not consent['enabled'] or consent['extractor_version']!=extractor_version:
        return {'revision':'','units':[],'pending':0}
    today=datetime.now(CHINA).date()
    saved=await db.query_a('SELECT * FROM risk_extractions WHERE user_id=? AND extractor_version=?',(uid,extractor_version))
    cache={(r['source_id'],r['source_hash']):r for r in saved}
    pending=[]
    for source in await sources(uid):
        if not in_window(source,today) or not allowed(source,consent):continue
        for unit in chunks(source):
            old=cache.get((unit['id'],unit['source_hash']))
            if not old or (old['status']!='done' and old['retry_at']<=time.time()):pending.append(unit)
    return {'revision':consent['revision'],'units':pending[:4],'pending':len(pending)}


async def save_extraction(uid,data):
    await ensure_schema()
    consent=active_consent(await db.query_one_a('SELECT * FROM risk_ai_consent WHERE user_id=?',(uid,)))
    if not consent or not consent['enabled'] or consent['revision']!=data.get('revision') or consent['extractor_version']!=data.get('extractor_version'):
        raise HttpError(409,'授权或提取版本已变化，未采用旧任务')
    today=datetime.now(CHINA).date()
    source=next((s for s in await sources(uid) if s['id']==data.get('source_id')),None)
    if not source or not allowed(source,consent) or not in_window(source,today) or source['hash']!=data.get('source_hash'):
        raise HttpError(409,'来源已变更或失效，未采用旧任务')
    unit=next((u for u in chunks(source) if u['id']==data.get('id')),None)
    if not unit:raise HttpError(400,'来源分段不存在')
    failed=data.get('status')=='failed'
    findings=[] if failed else validate_findings(data.get('findings'),unit)
    await db.execute_a("INSERT INTO risk_extractions(user_id,source_id,source_hash,extractor_version,status,findings,error,retry_at,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM risk_ai_consent WHERE user_id=? AND enabled=1 AND revision=?) ON CONFLICT(user_id,source_id,source_hash,extractor_version) DO UPDATE SET status=excluded.status,findings=excluded.findings,error=excluded.error,retry_at=excluded.retry_at,updated_at=excluded.updated_at",
                       (uid,unit['id'],source['hash'],consent['extractor_version'],'failed' if failed else 'done',dump(findings),'AI线索提取暂未完成，稍后自动重试' if failed else '',time.time()+300 if failed else 0,time.time(),uid,consent['revision']))
    return {'saved':True}


async def set_consent(uid,data):
    await ensure_schema()
    if not await db.query_one_a("SELECT 1 FROM users WHERE id=? AND role='user'",(uid,)):
        raise HttpError(404,'个人账号不存在')
    sequence=int(data.get('sequence',-1))
    await db.execute_a('INSERT INTO risk_ai_consent VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,history=excluded.history,since_at=excluded.since_at,revision=excluded.revision,sequence=excluded.sequence,extractor_version=excluded.extractor_version,updated_at=excluded.updated_at WHERE excluded.sequence>=risk_ai_consent.sequence',
                       (uid,int(bool(data.get('enabled'))),int(bool(data.get('history'))),str(data.get('since_at') or ''),str(data.get('revision') or ''),sequence,str(data.get('extractor_version') or ''),time.time()))
    current=await db.query_one_a('SELECT * FROM risk_ai_consent WHERE user_id=?',(uid,))
    if current and not current['enabled']:
        await db.execute_a('DELETE FROM risk_extractions WHERE user_id=?',(uid,))
    return {'saved':True}


async def summary(uid, *, now=None):
    await ensure_schema()
    now=(now or datetime.now(CHINA)).astimezone(CHINA);today=now.date()
    ledger=await sources(uid)
    recent=[s for s in ledger if in_window(s,today)]
    reviews=await db.query_a('SELECT * FROM risk_reviews WHERE user_id=? ORDER BY id',(uid,))
    review_map={r['item_id']:r for r in reviews}
    consent=active_consent(await db.query_one_a('SELECT * FROM risk_ai_consent WHERE user_id=?',(uid,)))
    cache=await db.query_a('SELECT * FROM risk_extractions WHERE user_id=? AND extractor_version=?',(uid,consent.get('extractor_version',''))) if consent.get('enabled') else []
    cache={(r['source_id'],r['source_hash']):r for r in cache}
    levels=[];reasons=[];flags=[];findings=[];dimensions=[];used=set();negative_days=set()
    incomplete=0;eligible=0;done=0;failed=0

    def raise_level(level,reason,source_id):
        if level in ORDER and level!='unknown':levels.append(level)
        reasons.append({'text':reason,'source_ids':[source_id],'level':level})
        used.add(source_id)

    def add_flag(source,kind,urgent=False):
        item_id='safety:'+digest([source['id'],source['hash'],kind])[:24]
        review=review_map.get(item_id)
        resolved=bool(review and review['source_hash']==source['hash'] and review['action']=='resolve_safety')
        flags.append({'id':item_id,'source_id':source['id'],'source_hash':source['hash'],'at':source['at'],
                      'kind':kind,'recent':in_window(source,today),'urgent':urgent and in_window(source,today),
                      'status':'resolved' if resolved else 'needs_review',
                      'label':{'current':'本人安全相关表达','historical':'既往安全相关线索','scale':'量表安全相关条目','saved':'已保存的安全复核提示'}[kind]})
        if not resolved and in_window(source,today):
            raise_level('red' if urgent else 'orange','安全线索需要独立人工复核，不能被低总分覆盖。',source['id'])

    # Safety is separate from the 30-day symptom window. Unresolved older flags
    # remain visible as historical prompts, without making the current grade red forever.
    for source in ledger:
        signal=source_signals(source['text'])
        scale=source['scale']
        if scale and scale['safetyStatus']=='needs_review':add_flag(source,'scale')
        if signal['safetySignal']:add_flag(source,'current',True)
        elif signal['historicalSafety']:add_flag(source,'historical')
        elif source['assessment'].get('safetyStatus')=='needs_review':
            linked=source['assessment'].get('screeningId')
            # A supplement inheriting the same PHQ safety item is not a second event.
            inherited=linked is not None and any(s['kind']=='scale' and str(s['reference'])==str(linked) and s['scale'] and s['scale']['safetyStatus']=='needs_review' for s in ledger)
            if not inherited:add_flag(source,'saved')

    for code,title in DOMAINS.items():
        comparable=[s for s in recent if s['code']==code and s['scale']]
        if not comparable:
            dimensions.append({'code':code,'label':title,'level':'unknown','severity':'资料不足','count':0,'trend':None})
            continue
        latest=comparable[0];value=latest['scale'];symptom_level=rules.classify_scale_score(code,value['score'])[0]
        old=next((s for s in comparable[1:] if s['scale']['version']==value['version'] and stamp(s['at']).date()!=stamp(latest['at']).date()),None)
        delta=value['score']-old['scale']['score'] if old else None
        dimensions.append({'code':code,'label':title,'level':symptom_level if code!='PSS-10' else 'unknown',
                           'severity':value['symptomSeverity'],'score':value['score'],'max_score':value['maxScore'],
                           'at':latest['at'],'source_id':latest['id'],'version':value['version'],'count':len(comparable),
                           'trend':{'delta':delta,'label':'分数上升' if delta>0 else '分数下降' if delta<0 else '分数持平','previous_at':old['at']} if old else None})
        used.add(latest['id'])
        if code!='PSS-10':raise_level(symptom_level,f'{title}：{value["symptomSeverity"]}，{value["score"]}/{value["maxScore"]}。',latest['id'])

    for source in recent:
        if source['kind']=='scale' and not source['scale']:incomplete+=1
        text=source['text'];signal=source_signals(text)
        if signal['negative'] and in_window(source,today,rules.NEGATIVE_WINDOW_DAYS):negative_days.add(stamp(source['at']).date().isoformat())
        if text:
            for unit in chunks(source):
                assessed=rules.build_assessment(unit['text'],followup_answers=source['assessment'].get('followupAnswers'))
                # Independent safety processing above owns the red/orange safety flags.
                if rules.extract_signals(unit['text'])['dimensions'] and assessed['safetyStatus']!='needs_review':
                    raise_level(assessed['level'] or 'yellow',assessed['conclusion'],source['id'])
        # A negative reference pattern can request attention, but never prove a
        # symptom, a diagnosis, a green overall state or an orange/red grade.
        a=source['assessment']
        if a.get('analysisMode')=='retrieval' and a.get('level')=='yellow':
            raise_level('yellow','多模态检索存在需要核实的参考线索，不等于本人已存在相同症状。',source['id'])
        if not allowed(source,consent):continue
        for unit in chunks(source):
            eligible+=1;cached=cache.get((unit['id'],source['hash']))
            if not cached:continue
            if cached['status']!='done':failed+=1;continue
            done+=1
            for finding in json.loads(cached['findings']):
                # Revalidate cached quotes after every source revision, not just on ingestion.
                if finding['quote'] not in unit['text']:continue
                review=review_map.get(finding['id'])
                status=review['action'] if review and review['source_hash']==source['hash'] else 'pending'
                if status=='dismiss_finding':continue
                findings.append({**finding,'source_id':source['id'],'source_hash':source['hash'],'at':source['at'],'status':status})
                if status=='confirm_finding':
                    # Confirmation creates a reviewable concern, never an AI-only red.
                    level='orange' if finding['feature'] in ('functional_impact','safety') else 'yellow'
                    raise_level(level,'人工确认的筛查线索：'+finding['quote'],source['id'])
    if len(negative_days)>=rules.NEGATIVE_DAY_THRESHOLD:
        # This is an engineering follow-up rule, explicitly not a clinical cut-off.
        levels.append('orange');reasons.append({'level':'orange','text':f'近{rules.NEGATIVE_WINDOW_DAYS}天有{len(negative_days)}个不同日期出现本人负面记录，达到项目人工复核关注规则；该规则未作临床效度验证。','source_ids':[s['id'] for s in recent if s['text'] and source_signals(s['text'])['negative'] and in_window(s,today,rules.NEGATIVE_WINDOW_DAYS)]})
    level=max(levels,key=ORDER.get) if levels else 'unknown'
    reasons.sort(key=lambda r:ORDER.get(r.get('level'),-1),reverse=True)
    active_flags=[f for f in flags if f['status']!='resolved']
    consent_version={k:consent.get(k) for k in ('enabled','history','since_at','revision','extractor_version')}
    version=digest([VERSION,today.isoformat(),[(s['id'],s['hash']) for s in ledger],reviews,
                    sorted(cache.values(),key=lambda r:r['source_id']),consent_version])[:24]
    ai_status='paused' if not consent.get('enabled') else 'not_needed' if not eligible else 'ready' if done==eligible else 'failed' if failed else 'pending'
    return {'level':level,'label':LABELS[level],'rule_version':VERSION,'data_version':version,
            'window_start':(today-timedelta(days=29)).isoformat(),'window_end':today.isoformat(),
            'computed_at':now.isoformat(),'dimensions':dimensions,'reasons':reasons,
            'safety':{'status':'needs_review' if active_flags else 'not_identified','flags':flags},
            'coverage':{'records':len(recent),'scales':sum(s['kind']=='scale' for s in recent),
                        'multimodal':sum(s['kind']!='scale' for s in recent),'incompatible':incomplete,
                        'dimension_count':sum(d['count']>0 for d in dimensions)},
            'ai':{'status':ai_status,'units':eligible,'completed':done,'failed':failed,'findings':findings},
            'evidence':[{'id':s['id'],'at':s['at'],'kind':s['kind'],'reference':s['reference']} for s in recent],
            'notice':'综合等级用于筛查关注和支持优先级，不是诊断或自伤概率；压力、检索相似度和不同量表分数不混算。'}


async def case_user(case_id):
    # Case routes use the public code; numeric id is accepted only by the legacy route.
    case=await db.query_one_a('SELECT * FROM cases WHERE case_id=?',(case_id,))
    if not case:raise HttpError(404,'案例不存在')
    uid=case.get('user_id')
    count=await db.query_one_a('SELECT COUNT(*) AS n FROM cases WHERE user_id=?',(uid,)) if uid is not None else None
    if uid is None or count['n']!=1:raise HttpError(409,'缺少唯一账号关联，不能合并他人或不明确归属的筛查记录')
    return uid


async def review(uid,data,actor):
    note=str(data.get('note') or '').strip()
    action=data.get('action');item_id=str(data.get('item_id') or '')
    if not note or len(note)>2000 or action not in ('resolve_safety','followup_safety','confirm_finding','dismiss_finding'):
        raise HttpError(400,'请选择复核操作并填写复核依据（最多2000字）')
    current=await summary(uid)
    items=current['safety']['flags'] if action.endswith('_safety') else current['ai']['findings']
    item=next((x for x in items if x['id']==item_id and x['source_hash']==data.get('source_hash')),None)
    if not item:raise HttpError(409,'依据已变化或不属于该用户，请刷新后复核')
    await db.execute_a('INSERT INTO risk_reviews(user_id,item_id,source_hash,action,note,actor_id,created_at) VALUES (?,?,?,?,?,?,?)',
                       (uid,item_id,item['source_hash'],action,note,actor,datetime.now(CHINA).isoformat()))
    return await summary(uid)


async def population():
    users=await db.query_a("SELECT DISTINCT u.id FROM users u JOIN (SELECT user_id FROM screenings WHERE status='completed' UNION SELECT user_id FROM screening_supplements) r ON r.user_id=u.id WHERE u.role='user'")
    counts={level:0 for level in LABELS};safety=0
    for user in users:
        value=await summary(user['id']);counts[value['level']]+=1
        safety+=value['safety']['status']=='needs_review'
    return {'people':len(users),'distribution':counts,'safety_pending_people':safety,
            'rule_version':VERSION,'computed_at':datetime.now(CHINA).isoformat(),
            'notice':'按稳定账号去重的当前状态；历史预警事件数量另行统计，不将未关联记录拼接到个人。'}
