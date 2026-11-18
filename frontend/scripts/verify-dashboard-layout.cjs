// Synthetic fixtures only: no real account, database writes or model calls.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const app=process.env.TEST_APP_URL||'http://127.0.0.1:4178';
const plan=i=>({id:i,title:`测试计划 ${i}`,detail:'记录今天的感受，照顾好自己。',source:'user',status:'pending',createdAt:'2026-11-19 09:00',dueAt:'2026-11-22 18:00',completedAt:''});
let pending=[], archived=Array.from({length:20},(_,i)=>({...plan(i+101),status:'done',completedAt:'2026-11-19 10:00'}));
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.TEST_BROWSER_PATH?{executablePath:process.env.TEST_BROWSER_PATH}:{})});
  try{
    const page=await browser.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('psych_token_persistent','e30.'+btoa(JSON.stringify({sub:90001,username:'__layout_fixture',role:'user'}))+'.test'));
    await page.route('**/api/**',async route=>{
      const p=new URL(route.request().url()).pathname;
      let data={};
      if(p==='/api/personal/dashboard')data={latestInput:null,userProfile:{name:'布局测试'},screeningRecords:[],supplements:[],warningEvents:[],personalTimeline:[],actionPlan:[],questionnaireCatalog:[],moodTrend:[],warningDistribution:[]};
      else if(p==='/api/personal/plans')data={pending,archived,generatedAt:''};
      else if(p.endsWith('/complete')){
        const id=Number(p.split('/').at(-2));
        const item=pending.find(x=>x.id===id);
        pending=pending.filter(x=>x.id!==id);
        archived.unshift({...item,status:'done',completedAt:'2026-11-19 10:00'});
        data={plan:archived[0]};
      }else if(p.endsWith('/risk-summary'))data={level:'unknown',coverage:{records:0},safety:{flags:[]},dimensions:[],reasons:[],evidence:[],ai:{status:'paused',findings:[]}};
      else if(['/api/personal/supplements','/api/personal/screenings','/api/personal/records'].includes(p))data=[];
      else if(p.includes('/checkin/present'))data={checkin:null};
      await route.fulfill({json:data});
    });
    const home=page.locator('[data-workspace-route="/personal/dashboard"][data-workspace-active="true"]').last();
    const hero=home.locator('.dashboard-hero');
    const card=hero.locator('.action-plan-card');
    const measure=()=>hero.evaluate(el=>{
      const r=el.getBoundingClientRect(),h=el.querySelector('h1').getBoundingClientRect(),c=el.querySelector('.action-plan-card').getBoundingClientRect();
      return {top:r.top,height:r.height,titleTop:h.top,cardHeight:c.height,resultTop:el.nextElementSibling.getBoundingClientRect().top};
    });
    for(const viewport of [{width:1574,height:825},{width:1440,height:1000},{width:1270,height:750}]){
      await page.setViewportSize(viewport);
      let baseline;
      for(const count of [0,1,4,30]){
        pending=Array.from({length:count},(_,i)=>plan(i+1));
        await page.goto(app+'/#/personal/dashboard');
        await page.reload();
        await card.getByText(`待进行 ${count} 项`,{exact:true}).waitFor();
        await page.waitForTimeout(950); // welcome entrance animation
        const box=await measure();
        baseline??=box;
        for(const key of ['height','titleTop','cardHeight','resultTop'])assert.ok(Math.abs(box[key]-baseline[key])<2,`${viewport.width}px / ${count} tasks: ${key} moved`);
        assert.ok(Math.abs(box.height-box.cardHeight)<2,'plan card must fill the hero');
        if(count===30){
          const list=card.locator('.plan-pending-list');
          assert.ok(await list.evaluate(el=>el.scrollHeight>el.clientHeight),'long pending list must scroll');
          await list.evaluate(el=>el.scrollTop=el.scrollHeight);
          await card.getByLabel('完成计划：测试计划 30',{exact:true}).waitFor({state:'visible'});
          await card.getByRole('button',{name:/已完成计划/}).click();
          assert.ok(await card.locator('.plan-archive').evaluate(el=>el.scrollHeight>el.clientHeight),'archive must scroll within the card');
          assert.ok(Math.abs((await measure()).resultTop-baseline.resultTop)<2,'opening archive moved results');
          await card.getByRole('button',{name:/制定计划/}).click();
          await card.getByPlaceholder('要做的这件事，一句话写清楚').waitFor();
          assert.ok(Math.abs((await measure()).resultTop-baseline.resultTop)<2,'opening form moved results');
        }
        if(viewport.width===1574 && count<=4){
          await page.evaluate(()=>window.scrollTo(0,0));
          await page.screenshot({path:path.resolve(__dirname,`../../tmp/dashboard-layout-${count}.png`),fullPage:true});
        }
      }
      pending=[plan(1)];
      await page.reload();
      await card.getByText('待进行 1 项',{exact:true}).waitFor();
      await page.waitForTimeout(950);
      const before=await measure();
      await card.getByLabel('完成计划：测试计划 1',{exact:true}).check();
      await card.getByText('待进行的计划都做完了。',{exact:true}).waitFor();
      assert.ok(Math.abs((await measure()).resultTop-before.resultTop)<2,'completing last task moved results');
    }
    for(const viewport of [{width:390,height:844},{width:1024,height:768}]){
      await page.setViewportSize(viewport);
      await page.reload();
      await card.getByText('待进行的计划都做完了。',{exact:true}).waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'single-column layout must not overflow horizontally');
      assert.ok(await hero.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length===1),'small screens must stack the columns');
      assert.ok(await card.evaluate(el=>el.getBoundingClientRect().top>=el.previousElementSibling.getBoundingClientRect().bottom),'mobile card overlaps welcome');
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: stable desktop layout with 0/1/4/30 tasks, last-task completion, scrolling pending/archive, open form, mobile/tablet stacking');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
