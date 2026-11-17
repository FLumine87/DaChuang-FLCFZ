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
