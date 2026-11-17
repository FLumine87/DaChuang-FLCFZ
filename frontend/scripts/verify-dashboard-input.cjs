// Synthetic API fixtures only. No real account records or model calls.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const app=process.env.TEST_APP_URL||'http://127.0.0.1:38982';
const at='2026-11-17T10:00:00+08:00';
const oldScale={id:'SCR-OLD',questionnaire:'PHQ-9',score:3,maxScore:27,level:'green',status:'completed',date:'2026-11-16',supplement:{kind:'text',text:'不得出现的旧输入',analysis:{conclusion:'不得出现的旧分析'}}};
const scale={...oldScale,id:'SCR-LATEST',questionnaire:'GAD-7',score:7,maxScore:21,date:'2026-11-17',supplement:undefined};
const hit={id:'CURRENT-HIT',similarity:0.8,modality:'image',summary:'仅属于当前记录的相似结果',tags:[],alertLevel:'unknown',date:'2026-11-17'};
const input=(kind)=>kind==='scale'
  ? {id:'scale:99',kind,at,recordId:scale.id,text:'GAD-7：7/21分',scale}
  : {id:`media:${kind}`,kind,at,recordId:null,text:kind==='text'?'本次真实文字输入':`上传了${kind==='image'?'图片':'语音'}：latest.${kind==='image'?'png':'wav'}`,
      supplement:{id:99,kind,createdAt:at,analysis:{conclusion:`本次${kind}记录分析`,level:'unknown',levelLabel:'未评估',hits:[hit]}}};
let latest=input('scale'), searches=0, requests=0;
const risk={level:'unknown',coverage:{records:2},safety:{flags:[]},dimensions:[],reasons:[],evidence:[],ai:{status:'paused',findings:[]}};
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.TEST_BROWSER_PATH?{executablePath:process.env.TEST_BROWSER_PATH}:{})});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('psych_token_persistent','e30.'+btoa(JSON.stringify({sub:90001,username:'__input_fixture',role:'user'}))+'.test'));
    await page.route('**/api/**',async route=>{
      const p=new URL(route.request().url()).pathname;
      let data={};
      if(p==='/api/personal/dashboard'){
        requests++;
        data={latestInput:latest,userProfile:{name:'合成用户'},screeningRecords:[oldScale],supplements:[],warningEvents:[],personalTimeline:[],actionPlan:[],questionnaireCatalog:[],moodTrend:[],warningDistribution:[]};
      }else if(p.endsWith('/risk-summary'))data=risk;
      else if(p==='/api/personal/search'){
        searches++;
        assert.equal(route.request().postDataJSON().query,'本次真实文字输入');
        data={results:[hit],report:{summary:'只对应最新文字的RAG解释',recommendations:['只对应最新文字的建议']}};
      }else if(p==='/api/personal/supplements'||p==='/api/personal/screenings'||p==='/api/personal/records')data=[];
      else if(p.includes('/checkin/present'))data={checkin:null};
      await route.fulfill({json:data});
    });
    const home=page.locator('[data-workspace-route="/personal/dashboard"][data-workspace-active="true"]');
    const card=home.locator('section').filter({has:page.getByRole('heading',{name:'近期的检测结果',exact:true})}).first();
    await page.goto(app+'/#/personal/dashboard');
    await card.getByText('「GAD-7：7/21分」',{exact:true}).waitFor();
    assert.equal(await card.getByText('不得出现的旧输入',{exact:false}).count(),0);
    assert.equal(await card.getByText('不得出现的旧分析',{exact:false}).count(),0);
    await card.getByText('RAG 给出的解释与建议',{exact:false}).waitFor();
    assert.ok((await card.getByRole('link',{name:'查看本次报告',exact:true}).getAttribute('href')).includes('SCR-LATEST'));
    assert.equal(searches,0,'a scale result must not trigger a search of older media');
    for(const kind of ['image','audio','text']){
      const previousRequests=requests;
      // A real navigation leaves Dashboard mounted; it must reload when returning.
      await page.goto(app+'/#/personal/records');
      await home.waitFor({state:'hidden'});
      latest=input(kind);
      await page.goto(app+'/#/personal/dashboard');
      await card.getByText(`「${latest.text}」`,{exact:true}).waitFor();
      assert.ok(requests>previousRequests,'returning to the retained homepage refreshes its data');
      await card.getByText('CURRENT-HIT',{exact:true}).waitFor();
      assert.ok((await card.getByRole('link',{name:'查看检索依据',exact:true}).getAttribute('href')).includes('assessmentSupplementId=99'),'media links reopen the selected record, rather than search its filename');
      assert.equal(await card.getByText('不得出现的旧输入',{exact:false}).count(),0);
      if(kind==='text'){
        await card.getByText('只对应最新文字的RAG解释',{exact:true}).waitFor();
        await card.getByText('只对应最新文字的建议',{exact:false}).waitFor();
      }else{
        assert.equal(searches,0,'media must use its own saved analysis');
        await card.getByText(`本次${kind}记录分析`,{exact:true}).last().waitFor();
      }
    }
    assert.equal(searches,1);
    await card.screenshot({path:path.resolve(__dirname,'../../tmp/dashboard-latest-input.png')});
    latest=null;
    await page.reload();
    await card.getByText('还没有检测记录',{exact:false}).first().waitFor();
    assert.equal(await card.getByText('不得出现的旧输入',{exact:false}).count(),0,'authoritative empty input must not fall back to older data');
    assert.deepEqual(errors,[]);
    console.log('PASS: latest scale/text/audio/image, saved/current analysis alignment, retained-page refresh, report links, empty state, no stale samples, input and RAG columns retained');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
