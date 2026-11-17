import { useState } from 'react';
import { FileText, Image, Mic } from 'lucide-react';
import type { MultimodalHistoryItem, StewardState } from '../services/steward';

const kinds=[{kind:'text',label:'文字筛查',Icon:FileText},{kind:'audio',label:'语音筛查',Icon:Mic},{kind:'image',label:'图像筛查',Icon:Image}] as const;
const date=(value:string)=>!value?'日期未知':new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const button='rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-primary-50';

export default function ScreeningHistory({series,media=[],open=false,onEvidence}:{series:StewardState['series'];media?:MultimodalHistoryItem[];open?:boolean;onEvidence:(ids:string[])=>void}) {
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});
  const toggle=(key:string)=>setExpanded(old=>({...old,[key]:!old[key]}));
  return <details open={open} className="rounded-xl border border-slate-100 p-3">
    <summary className="cursor-pointer text-sm font-medium text-slate-600">筛查历史与原始记录</summary>
    <div className="mt-4 space-y-5">
      <section aria-label="多模态筛查历史" className="space-y-4"><h3 className="font-medium text-slate-900">多模态筛查记录 <span className="text-xs font-normal text-slate-400">（{media.length} 条）</span></h3>
        {!media.length && <p className="text-xs text-slate-500">暂无已获准纳入档案的多模态筛查记录。</p>}
        {kinds.map(({kind,label,Icon})=>{
          const rows=media.filter(item=>item.kind===kind);
          if (!rows.length) return null;
          return <div key={kind} className="space-y-2"><h4 className="flex items-center gap-2 text-sm font-medium text-slate-700"><Icon aria-hidden="true" className="h-4 w-4 text-primary-500"/>{label} · {rows.length} 条</h4>
            {(expanded[kind]?rows:rows.slice(0,5)).map(item=><article key={item.id} className="space-y-2 rounded-xl bg-slate-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><time className="text-xs text-slate-500">{date(item.at)}</time><span className="text-[11px] text-slate-500">{item.analysis_mode==='retrieval'?'检索参考':item.conclusion?'当次筛查结果':'未保存分析结果'}</span></div>{item.filename && <p className="break-all text-xs text-slate-500">文件：{item.filename}</p>}<p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{item.summary}</p>{item.conclusion && <p className="break-words text-xs leading-6 text-slate-500">{item.analysis_mode==='retrieval'?'当次检索参考：':'当次结果：'}{item.conclusion}</p>}<button className="text-xs text-primary-600" onClick={()=>onEvidence([item.id])}>查看原始依据</button></article>)}
            {rows.length>5 && <button className="text-xs text-primary-600" onClick={()=>toggle(kind)}>{expanded[kind]?'收起记录':`查看其余 ${rows.length-5} 条${label}记录`}</button>}
          </div>;
        })}
      </section>
      <section aria-label="量表筛查历史" className="space-y-4 border-t border-slate-100 pt-4"><h3 className="font-medium text-slate-900">量表筛查记录</h3>{!Object.keys(series).length && <p className="text-xs text-slate-500">暂无已获准纳入档案的量表记录。</p>}{Object.entries(series).map(([name,values])=><div key={name} className="space-y-2"><h4 className="font-medium">{name} 历次结果</h4><p className="text-xs text-slate-500">保留各次日期和量表版本，分数不与其他量表合并。</p><div className="flex flex-wrap gap-2">{(expanded[name]?values:values.slice(0,12)).map(v=><button key={v.id} className={button} onClick={()=>onEvidence([v.id])}>{v.at ? new Date(v.at).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'}) : '日期未知'} · {v.score}/{v.max}{v.version?` · ${v.version}`:''}</button>)}</div>{values.length>12 && <button className="text-xs text-primary-600" onClick={()=>toggle(name)}>{expanded[name]?'收起量表记录':`查看其余 ${values.length-12} 次结果`}</button>}</div>)}</section>
    </div>
  </details>;
}
