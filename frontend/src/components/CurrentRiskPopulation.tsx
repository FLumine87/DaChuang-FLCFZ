import { useEffect, useState } from 'react';
import { getToken, request, USE_MOCK } from '../services/http';
import { usePageActive } from '../services/pageActivity';
import { riskLabels, type RiskLevel } from '../services/riskSummary';

export default function CurrentRiskPopulation(){
  const active=usePageActive(),token=getToken();
  const [value,setValue]=useState<{token:string|null;data?:{people:number;distribution:Record<RiskLevel,number>;safety_pending_people:number};error?:string}>({token:''});
  useEffect(()=>{
    if(!active||USE_MOCK)return;
    let live=true;
    const load=async()=>{try{const data=await request.get<{people:number;distribution:Record<RiskLevel,number>;safety_pending_people:number}>('/api/admin/risk-summary');if(!data.distribution)throw new Error();if(live&&getToken()===token)setValue({token,data});}catch{if(live&&getToken()===token)setValue({token,error:'当前综合状态统计暂不可用'});}};
    void load();const timer=setInterval(()=>void load(),30000);return()=>{live=false;clearInterval(timer);};
  },[active,token]);
  const data=value.token===token?value.data:undefined;
  return <section aria-label="当前综合状态人数" className="ui-card p-4"><h3 className="font-semibold text-slate-800">当前综合状态 · 按用户统计</h3><p className="mt-1 text-xs text-slate-500">采用统一近30天评估；历史预警列表保留事件发生时的等级与处置记录。</p>{data?<><div className="mt-3 flex flex-wrap gap-3 text-xs">{Object.entries(riskLabels).map(([level,label])=><span key={level} className="rounded-lg bg-slate-50 px-3 py-2">{label} <strong>{data.distribution[level as RiskLevel] || 0}</strong> 人</span>)}</div><p className="mt-2 text-xs text-slate-500">共{data.people}个有筛查记录的账号；{data.safety_pending_people}人另有待复核安全提示。</p></>:<p className="mt-3 text-xs text-slate-500">{USE_MOCK?'演示模式不生成真实用户风险。':value.error || '正在读取当前综合状态…'}</p>}</section>;
}
