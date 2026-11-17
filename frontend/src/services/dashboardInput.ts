import type { DashboardInput, DashboardResponse } from './mockApi';

/** Compatibility for older API responses. Drafts and fixed samples are never input. */
export function latestDashboardInput(data:DashboardResponse):DashboardInput|null {
  if(data.latestInput!==undefined)return data.latestInput;
  const candidates:DashboardInput[]=[];
  for(const record of data.screeningRecords || []){
    if(record.status==='completed')candidates.push({id:record.id,kind:'scale',at:record.date,recordId:record.id,scale:record,text:`${record.questionnaire}：${record.score}/${record.maxScore}分`});
  }
  for(const s of data.supplements || []){
    if(!s.createdAt)continue;
    candidates.push({id:`media:${s.id}`,kind:s.kind,at:s.createdAt,recordId:s.screeningId,supplement:s,
      text:s.text?.trim() || `上传了${s.kind==='audio'?'语音':s.kind==='image'?'图片':'文字记录'}：${s.filename || '未命名文件'}`});
  }
  const time=(at:string)=>Date.parse(dashboardInputTime(at));
  return candidates.filter(c=>Number.isFinite(time(c.at))).sort((a,b)=>time(b.at)-time(a.at) || Number(b.kind!=='scale')-Number(a.kind!=='scale'))[0] || null;
}

export function dashboardInputTime(at:string):string {
  let normalized=at.trim().replace(' ','T');
  if(/^\d{4}-\d{2}-\d{2}$/.test(normalized))normalized+='T00:00:00';
  return /(?:Z|[+-]\d\d:\d\d)$/.test(normalized)?normalized:normalized+'+08:00';
}
