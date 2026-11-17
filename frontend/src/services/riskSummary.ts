import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken, request } from './http';
import { usePageActive } from './pageActivity';

export type RiskLevel='unknown'|'green'|'yellow'|'orange'|'red';
export const riskLabels:Record<RiskLevel,string>={unknown:'待评估',green:'现有记录未提示明显关注信号',yellow:'需要关注',orange:'建议人工复核',red:'需及时安全复核'};
export interface RiskItem { id:string; source_id:string; source_hash:string; at:string; status:string; label?:string; kind?:string; recent?:boolean; urgent?:boolean; feature?:string; quote?:string; certainty?:string }
export interface RiskSummary {
  review_history?:{item_id:string;action:string;note:string;actor_id:number;created_at:string}[];
  level:RiskLevel;label:string;rule_version:string;data_version:string;window_start:string;window_end:string;computed_at:string;notice:string;
  reasons:{text:string;source_ids:string[]}[];
  dimensions:{code:string;label:string;level:RiskLevel;severity:string;score?:number;max_score?:number;at?:string;count:number;trend:{delta:number;label:string;previous_at:string}|null}[];
  coverage:{records:number;scales:number;multimodal:number;incompatible:number;dimension_count:number};
  safety:{status:string;flags:RiskItem[]};ai:{status:string;units:number;completed:number;failed:number;findings:RiskItem[]};
  evidence:{id:string;at:string;kind:string;reference:string}[];
}

/** A readable overview of the canonical result, without exposing workflow rules. */
export function riskOverview(data:RiskSummary):string {
  const safety=data.safety.flags.filter(item=>item.status!=='resolved');
  if(data.level==='red')return '近期筛查中出现了需要及时了解的安全相关情况，建议现在就联系可信任的人或专业人员，一起确认当前状况并获得支持。';
  if(safety.some(item=>item.recent))return '结合近期的筛查记录，目前有一些安全相关情况需要进一步了解，建议尽快与专业人员沟通，说明最近的感受和生活状况，获得适合你的支持。';
  const domains=data.dimensions.filter(d=>d.code!=='PSS-10' && ['yellow','orange'].includes(d.level)).map(d=>d.label);
  const focus=domains.length?`${domains.slice(0,2).join('、')}方面的筛查结果值得关注`:'近期的记录中有一些值得进一步了解的情况';
  if(safety.length){
    const recent=data.level==='unknown'?'近期的筛查信息还不充分，暂时无法完整判断目前的状态':data.level==='green'?'近期筛查尚未提示明显需要关注的新情况':focus;
    return `${recent}。结合此前的记录，建议与专业人员一起回顾近况，进一步了解当前感受和支持需要。`;
  }
  if(data.level==='orange')return `综合近30天的记录，${focus}，建议联系专业人员进一步了解困扰的持续时间及其对日常生活的影响，并商量适合你的调整方式。`;
  if(data.level==='yellow')return `综合近30天的记录，${focus}，可以继续留意自己的感受、睡眠和日常生活变化；如果困扰持续或影响生活，建议寻求专业支持。`;
  if(data.level==='green')return '从近30天已有的筛查记录看，目前未发现明显需要关注的信号。可以继续保持适合自己的生活节奏，并留意感受和日常状态的变化。';
  return '目前的近期筛查信息还不充分，暂时无法完整判断你的状态。可以结合实际需要补充近况或完成相关筛查，帮助更清楚地了解最近的感受与变化。';
}

export function useRiskSummary(caseId?:string) {
  const active=usePageActive(),token=getToken();
  const endpoint=caseId?`/api/admin/cases/${encodeURIComponent(caseId)}/risk-summary`:'/api/personal/risk-summary';
  const key=token+':'+endpoint;
  const [state,setState]=useState<{key:string;data?:RiskSummary;error?:string}>({key:''});
  const sequence=useRef(0);
  const load=useCallback(async()=>{
    const order=++sequence.current;
    try {
      const data=await request.get<RiskSummary>(endpoint);
      if(!data?.coverage || !data?.safety || !data?.ai)throw new Error('近期综合结果暂未返回，请稍后重试');
      if(getToken()===token && sequence.current===order)setState({key,data});
    }catch(e){if(getToken()===token && sequence.current===order)setState({key,error:e instanceof Error?e.message:'近期综合结果暂不可用'});}
  },[endpoint,key,token]);
  useEffect(()=>{
    if(!active)return;
    let live=true;
    const update=()=>{if(live)void load();};
    update();const timer=setInterval(update,30000);
    window.addEventListener('risk-summary-changed',update);
    return()=>{live=false;clearInterval(timer);window.removeEventListener('risk-summary-changed',update);};
  },[active,load]);
  return {...(state.key===key?state:{}),reload:load};
}

export async function reviewRisk(caseId:string,item:RiskItem,action:string,note:string) {
  const value=await request.post<RiskSummary>(`/api/admin/cases/${encodeURIComponent(caseId)}/risk-reviews`,{item_id:item.id,source_hash:item.source_hash,action,note});
  window.dispatchEvent(new Event('risk-summary-changed'));
  return value;
}
