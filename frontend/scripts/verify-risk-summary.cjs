// All APIs are intercepted: synthetic screening, no real user/model calls.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const app=process.env.TEST_APP_URL||'http://127.0.0.1:38982';
const token=(role,name)=>'e30.'+Buffer.from(JSON.stringify({sub:90001,username:name,role})).toString('base64url')+'.test';
const at='2026-11-17T09:00:00+08:00';
const flag={id:'safety:fixture',source_id:'scale:1',source_hash:'synthetic-hash',at,kind:'scale',label:'量表安全相关条目',recent:true,status:'needs_review'};
const finding={id:'ai:fixture',source_id:'multimodal:2',source_hash:'synthetic-hash-2',at,feature:'functional_impact',quote:'课程调整后，很多事情安排不过来了。',certainty:'uncertain',status:'pending'};
let resolved=false,ready=false,confirmed=false,rejectReview=true,reviews=0,offline=false;
function summary(other=false){
  const level=other?'unknown':!resolved||confirmed?'orange':'green';
  return {level,rule_version:'recent-screening-v1',data_version:other?'other-v1':confirmed?'shared-v3':resolved?'shared-v2':'shared-v1',window_start:'2026-10-19',window_end:'2026-11-17',computed_at:at,notice:'合成测试数据；用于筛查关注和支持优先级，不代表诊断。',
    reasons:other?[]:[{text:!resolved?'存在需要独立复核的安全相关条目。':confirmed?'人工确认的生活影响线索。':'最近一次有效量表症状较少。',source_ids:['scale:1']}],
    dimensions:other?[]:[{code:'PHQ-9',label:'抑郁相关症状',level:'green',severity:'极少',score:0,max_score:27,count:1,trend:null},{code:'PSS-10',label:'压力',level:'unknown',severity:'压力自评分数（无统一诊断界值）',score:20,max_score:40,count:1,trend:{delta:1,label:'分数上升',previous_at:at}}],
    coverage:{records:other?0:71,scales:other?0:2,multimodal:other?0:69,incompatible:other?0:1,dimension_count:other?0:2},
    safety:{status:other||resolved?'not_identified':'needs_review',flags:other?[]:[{...flag,status:resolved?'resolved':'needs_review'}]},
    ai:{status:other?'paused':ready?'ready':'pending',units:other?0:72,completed:other?0:ready?72:3,failed:0,findings:!other&&ready?[{...finding,status:confirmed?'confirm_finding':'pending'}]:[]},
    evidence:other?[]:Array.from({length:71},(_,i)=>({id:`multimodal:${i+1}`,at,kind:'text',reference:`合成筛查 ${i+1}`})),
    review_history:resolved?[{item_id:flag.id,action:'resolve_safety',note:'合成复核意见',actor_id:999,created_at:at}]:[]};
}
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.TEST_BROWSER_PATH?{executablePath:process.env.TEST_BROWSER_PATH}:{})});
  const errors=[];
  async function makePage(role,name){
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(t=>localStorage.setItem('psych_token_persistent',t),token(role,name));
    await page.route('**/api/**',async route=>{
      const p=new URL(route.request().url()).pathname;
      const other=name==='__risk_other';let data={};
      if(p.endsWith('/risk-reviews')){
        reviews++;const body=route.request().postDataJSON();assert.ok(body.note.trim());
        if(rejectReview)return route.fulfill({status:409,json:{message:'依据已变化，请刷新后复核'}});
        if(body.action==='resolve_safety')resolved=true;
        if(body.action==='confirm_finding')confirmed=true;
        data=summary();
      }else if(p.endsWith('/risk-summary')){
        if(offline)return route.fulfill({status:503,json:{message:'综合评估暂不可用'}});
        data=summary(other);
      }else if(p==='/api/personal/dashboard')data={userProfile:{name:'合成用户'},screeningRecords:[{id:'SCR-UI',questionnaire:'PHQ-9',score:0,maxScore:27,level:'green',status:'completed',date:'2026-11-17'}],supplements:[],warningEvents:[],personalTimeline:[],actionPlan:[],questionnaireCatalog:[],moodTrend:[],warningDistribution:[]};
      else if(p==='/api/v1/steward')data={settings:{enabled:false,screening:true,chat:false,checkin:false,feedback:false,history:true,risk_ai:false},snapshot:{},version:0,evidence_count:0,memories:[],suggestions:[],series:{}};
      else if(p==='/api/admin/cases'||p==='/api/admin/cases/CASE-UI'){
        const c={id:'CASE-UI',userId:90001,name:'合成布局用户',age:20,gender:'',department:'测试',tags:[],screeningCount:2,lastScreening:at,alertLevel:summary().level,status:'active',notes:'',screenings:[],alerts:[],timeline:[],supplements:[],tasks:[]};
        data=p.endsWith('CASE-UI')?c:{items:[c],total:1,page:1,pageSize:50};
      }else if(p.includes('/checkin/present'))data={checkin:null};
      return route.fulfill({json:data});
    });
    return page;
  }
  try{
    const personal=await makePage('user','__risk_personal');
    await personal.goto(app+'/#/personal/dashboard');
    const home=personal.locator('[data-workspace-route="/personal/dashboard"][data-workspace-active="true"]');
    const homeRisk=home.getByRole('region',{name:'近期综合风险',exact:true});
    await homeRisk.getByRole('heading',{name:'建议人工复核',exact:true}).waitFor();
    assert.equal(await home.getByText('量表给的分数',{exact:true}).count(),0);
    await home.getByText('最近一次输入',{exact:false}).first().waitFor();
    await home.getByText('RAG 给出的解释与建议',{exact:false}).waitFor();
    assert.equal(await homeRisk.evaluate(el=>{const column=el.parentElement,grid=column.parentElement;return grid.children.length===3 && grid.firstElementChild===column;}),true,'risk must replace only the first score column, keeping input and RAG columns');
    await personal.goto(app+'/#/personal/me/kg');
    const card=personal.getByRole('region',{name:'近期综合风险',exact:true});
    await card.getByRole('heading',{name:'建议人工复核',exact:true}).waitFor();
    await card.locator('summary').filter({hasText:'为什么是这个等级'}).click();
    await card.getByText('已完成3/72段原文。',{exact:false}).waitFor();
    await card.getByText('当前资料不足', {exact:false}).count();
    await card.locator('summary').filter({hasText:'本轮纳入的全部筛查记录'}).click();
    assert.equal(await card.locator('li').filter({hasText:/合成筛查 \d+/}).count(),71);
    assert.equal(await card.getByRole('button',{name:'复核后解除本条提示',exact:true}).count(),0,'personal users cannot clear safety through the staff review control');
    await personal.screenshot({path:path.resolve(__dirname,'../../tmp/risk-personal.png'),fullPage:true});
    const admin=await makePage('admin','__risk_staff');
    await admin.goto(app+'/#/admin/cases');await admin.getByRole('button',{name:'查看详情',exact:true}).click();
    const reviewCard=admin.getByRole('region',{name:'近期综合风险',exact:true});
    await reviewCard.getByRole('heading',{name:'建议人工复核',exact:true}).waitFor();
    await reviewCard.locator('summary').filter({hasText:'为什么是这个等级'}).click();
    await reviewCard.getByRole('button',{name:'复核后解除本条提示',exact:true}).click();
    const save=reviewCard.getByRole('button',{name:'保存复核',exact:true});
    assert.equal(await save.isDisabled(),true);
    await reviewCard.getByLabel('复核依据与处理意见').fill('合成复核意见');await save.click();
    await reviewCard.getByRole('alert').getByText('依据已变化，请刷新后复核',{exact:true}).waitFor();
    await reviewCard.getByRole('heading',{name:'建议人工复核',exact:true}).waitFor();
    rejectReview=false;await save.click();
    await reviewCard.getByRole('heading',{name:'现有记录未提示明显关注信号',exact:true}).waitFor();
    await personal.reload();await card.getByRole('heading',{name:'现有记录未提示明显关注信号',exact:true}).waitFor();
    ready=true;await admin.reload();await admin.getByRole('button',{name:'查看详情',exact:true}).click();
    await reviewCard.getByRole('heading',{name:'现有记录未提示明显关注信号',exact:true}).waitFor();
    await reviewCard.locator('summary').filter({hasText:'为什么是这个等级'}).click();
    await reviewCard.getByText('生活影响 · AI提示，待核实',{exact:true}).waitFor();
    await reviewCard.getByRole('button',{name:'确认此条线索',exact:true}).click();
    await reviewCard.getByLabel('复核依据与处理意见').fill('合成：确认生活影响线索');await reviewCard.getByRole('button',{name:'保存复核',exact:true}).click();
    await reviewCard.getByRole('heading',{name:'建议人工复核',exact:true}).waitFor();
    await personal.reload();await card.getByRole('heading',{name:'建议人工复核',exact:true}).waitFor();
    await personal.setViewportSize({width:390,height:844});
    await card.locator('summary').filter({hasText:'为什么是这个等级'}).click();
    assert.ok(await personal.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    const other=await makePage('user','__risk_other');await other.goto(app+'/#/personal/me/kg');
    await other.getByRole('heading',{name:'待评估',exact:true}).waitFor();
    assert.equal(await other.getByText(finding.quote,{exact:true}).count(),0);
    offline=true;await other.reload();await other.getByText('综合评估暂不可用',{exact:true}).waitFor();
    assert.equal(await other.getByRole('heading',{name:'现有记录未提示明显关注信号',exact:true}).count(),0);
    assert.equal(reviews,3);assert.deepEqual(errors,[]);
    console.log('PASS: shared personal/admin grades, full history coverage, AI progress/pending review, failed review preserves state, audited review, personal permission boundary, mobile, account isolation, outage has no invented grade');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
