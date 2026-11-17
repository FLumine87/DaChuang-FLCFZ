import { useRef, useState } from 'react';
import { getCurrentSession } from '../auth/session';
import { stewardApi, useSteward } from '../services/steward';

const riskMeta: Record<string,{label:string; note:string; style:string}> = {
  green:{label:'筛查风险较低',note:'保持适合自己的节奏，继续留意状态变化。',style:'bg-emerald-50 text-emerald-800 border-emerald-100'},
  yellow:{label:'近期需要关注',note:'有值得关注的筛查线索，可以结合下面的建议照顾自己。',style:'bg-amber-50 text-amber-800 border-amber-100'},
  orange:{label:'建议人工复核',note:'近期筛查提示需要进一步关注，建议联系专业人员了解情况。',style:'bg-orange-50 text-orange-800 border-orange-100'},
  red:{label:'优先寻求支持',note:'请优先联系可信任的人或专业人员，了解当前是否需要及时支持。',style:'bg-rose-50 text-rose-800 border-rose-100'},
  unknown:{label:'风险待评估',note:'目前没有可用的近期筛查分层，不将缺少记录视为低风险。',style:'bg-slate-50 text-slate-700 border-slate-200'},
};
const types=['INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP','ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP'];

export default function PsychologicalOverview() {
  const {data}=useSteward();
  const owner=useRef(getCurrentSession()?.username);
  const [edit,setEdit]=useState(false);
  const [type,setType]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  if (!data?.settings.enabled || owner.current!==getCurrentSession()?.username) return null;
  const risk=data.indicators?.risk;
  const meta=riskMeta[risk?.level ?? 'unknown'] ?? riskMeta.unknown;
  const mbti=data.indicators?.mbti ?? data.snapshot.mbti;
  const portrait=data.snapshot.portrait?.length ? data.snapshot.portrait : data.memories.filter(m=>m.status==='confirmed').slice(0,3).map(m=>({text:m.content,evidence_ids:m.evidence_ids}));
  const observations=(data.snapshot.observations ?? []).filter(x=>!/(?:PHQ|GAD|SCL|ISI|PSS|\d+\s*\/\s*\d+)/i.test(x.text));
  const save=async()=>{
    if (!type || busy || owner.current!==getCurrentSession()?.username) return;
    setBusy(true);setError('');
    try { await stewardApi.remember(`我的 MBTI 是 ${type}`);setEdit(false); }
    catch { setError('类型暂未保存，请稍后重试。'); }
    finally { setBusy(false); }
  };
  return <section aria-label="管家心理分析" className="overflow-hidden rounded-3xl border border-primary-100 bg-white shadow-sm">
    <div className="grid gap-0 lg:grid-cols-[minmax(0,1.7fr)_minmax(250px,1fr)]">
      <div className="space-y-5 bg-gradient-to-br from-primary-50/80 via-white to-blue-50/60 p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-primary-600">心理管家 · 为你准备的分析</span><span className="text-xs text-slate-500">{data.status==='updating' ? '正在更新，已有分析可继续阅读' : data.updated_at ? `更新于 ${new Date(data.updated_at).toLocaleDateString('zh-CN')}` : '正在整理已有信息'}</span></div>
        <div><h2 className="text-xl font-semibold text-slate-900">我眼中的你</h2><p className="mt-1 text-xs text-slate-500">基于你的表达与经历形成的理解，可以随时修正。</p></div>
        {portrait.length ? <div className="space-y-3">{portrait.map((p,i)=><p key={i} className="text-base leading-8 text-slate-700">{p.text}</p>)}</div> : <p className="text-base leading-8 text-slate-700">{observations[0]?.text ?? (data.status==='failed' ? '个人画像暂未更新成功。下方保留了已有建议和真实筛查状态，可点击更新分析重试。' : data.status==='ready' ? '现有信息能够帮助观察近期状态，还不足以可靠判断长期个性。下面先呈现已有依据的理解与建议。' : '管家正在结合已有记录整理你的心理画像。近期状态与建议会在这页直接呈现，不需要先逐条确认记忆。')}</p>}
        <div className="border-t border-primary-100 pt-4"><h3 className="text-sm font-semibold text-slate-900">最近的你</h3><p className="mt-2 text-sm leading-7 text-slate-600">{observations.slice(0,2).map(x=>x.text).join(' ') || data.snapshot.summary || '近期状态正在整理，风险卡片依据已保存的筛查结果展示。'}</p></div>
        {data.suggestions.find(s=>s.state==='suggested') && <div className="rounded-2xl border border-primary-100 bg-white/80 p-4"><p className="text-xs font-medium text-primary-600">今天先做一件事</p><h3 className="mt-2 font-semibold text-slate-800">{data.suggestions.find(s=>s.state==='suggested')?.title}</h3><p className="mt-1 text-sm leading-6 text-slate-600">{data.suggestions.find(s=>s.state==='suggested')?.detail}</p></div>}
      </div>
      <div className="space-y-4 border-t border-slate-100 p-5 lg:border-l lg:border-t-0">
        <article className={`rounded-2xl border p-4 ${meta.style}`} aria-label="近期筛查风险"><p className="text-xs font-medium">近期筛查风险</p><h3 className="mt-2 text-2xl font-semibold">{meta.label}</h3><p className="mt-2 text-xs leading-6">{meta.note}</p><p className="mt-2 text-[11px] opacity-75">{risk?.at ? `依据 ${new Date(risk.at).toLocaleDateString('zh-CN')} 等近期筛查；不是实时诊断` : '依据近30天各项最新筛查，独立于性格类型'}</p></article>
        <article className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4" aria-label="MBTI人格倾向"><div className="flex items-center justify-between gap-2"><h3 className="text-xs font-medium text-violet-800">MBTI · 自我理解</h3><button className="text-xs text-violet-700" onClick={()=>setEdit(!edit)}>{mbti ? '更正类型' : '填写我的类型'}</button></div><p className="mt-3 text-3xl font-semibold tracking-wider text-violet-900">{mbti?.type ?? '暂未判断'}</p><p className="mt-2 text-xs font-medium text-violet-700">{mbti ? mbti.status==='self_report' ? '本人提供的类型' : 'AI探索性倾向 · 待确认' : '现有信息不足以判断四字母类型'}</p>{mbti?.reason && <p className="mt-2 text-xs leading-6 text-slate-600">{mbti.reason}</p>}<p className="mt-3 text-[11px] leading-5 text-slate-500">用于了解偏好，不是正式MBTI测评，也不决定心理风险。</p>
          {edit && <div className="mt-3 space-y-2"><select aria-label="我的MBTI类型" value={type} onChange={e=>setType(e.target.value)} className="w-full rounded-lg border border-violet-200 bg-white p-2 text-sm"><option value="">选择你已了解的类型</option>{types.map(t=><option key={t}>{t}</option>)}</select><button disabled={!type||busy} onClick={()=>void save()} className="rounded-lg bg-violet-600 px-3 py-2 text-xs text-white disabled:opacity-50">保存本人类型</button></div>}{error && <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p>}
        </article>
      </div>
    </div>
  </section>;
}
