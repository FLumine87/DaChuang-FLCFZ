// All network calls use synthetic fixtures; no real account or model calls.
const {chromium}=require('playwright');
const {expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const path=require('node:path');
const app=process.env.TEST_APP_URL||'http://127.0.0.1:38982';
const scale={id:'SCR-UNIFIED',questionnaire:'PHQ-9',score:3,maxScore:27,level:'green',status:'completed',date:'2026-11-16',answers:{1:3,2:0,3:0,4:0,5:0,6:0,7:0,8:0,9:0}};
let rows=[{id:'scale:1',kind:'scale',at:'2026-11-16T19:00:00+08:00',recordId:scale.id,text:'PHQ-9：3/27分',scale},
  ...['text','audio','image'].map((kind,i)=>({id:`media:${i+1}`,kind,at:`2026-11-16T${18-i}:30:00Z`,text:kind==='text'?'统一记录的真实文字':`合成${kind}文件`,
    supplement:{id:i+1,kind,createdAt:`2026-11-16T${18-i}:30:00Z`,text:kind==='text'?'统一记录的真实文字':'',filename:`fixture.${kind==='audio'?'wav':'png'}`,note:kind==='text'?'保留的便签':'',analysis:{level:'unknown',levelLabel:'未评估',conclusion:'合成多模态结果',hits:[]}}}))];
let offline=false,notes=0,deletes=0,reads=0;
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.TEST_BROWSER_PATH?{executablePath:process.env.TEST_BROWSER_PATH}:{})});
  try{
    // Use a non-China browser timezone to check the shared Shanghai timeline.
    const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'America/New_York'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('psych_token_persistent','e30.'+btoa(JSON.stringify({sub:90001,username:'__unified_fixture',role:'user'}))+'.test'));
    await page.route('**/api/**',async route=>{
      const p=new URL(route.request().url()).pathname;
      let data={};
      if(p==='/api/personal/records'){
        reads++;if(offline)return route.fulfill({status:403,json:{message:'合成记录读取失败'}});
        data=rows;
      }else if(p==='/api/personal/supplements/1/note'){
        notes++;assert.equal(route.request().method(),'PUT');
        const note=route.request().postDataJSON().content;
        rows=rows.map(r=>r.id==='media:1'?{...r,supplement:{...r.supplement,note}}:r);data={note};
      }else if(p==='/api/personal/supplements/2'&&route.request().method()==='DELETE'){
        deletes++;rows=rows.filter(r=>r.id!=='media:2');data={deleted:2};
      }else if(p==='/api/personal/screenings')data=[scale];
      else if(p.includes('/checkin/present'))data={checkin:null};
      else if(p==='/api/v1/steward')data={settings:{enabled:false,screening:true},snapshot:{},series:{},memories:[],suggestions:[],version:0,evidence_count:0};
      await route.fulfill({json:data});
    });
    await page.goto(app+'/#/personal/records');
    const view=page.locator('[data-workspace-route="/personal/records"][data-workspace-active="true"]');
    const button=name=>view.getByRole('button',{name,exact:false});
    await button(/^全部\s+4$/).waitFor();
    await expect(view.locator('article')).toHaveCount(4);
    assert.ok((await view.locator('article').first().innerText()).includes('统一记录的真实文字'),'mixed source records sort by actual time, not type');
    assert.equal(await view.getByText('2026 年 11 月 · 周二',{exact:true}).count(),1,'UTC media belongs to Nov 17 in Shanghai');
    assert.equal(await view.getByText('2026 年 11 月 · 周一',{exact:true}).count(),1);
    await button(/^量表\s+1$/).click();
    await expect(view.locator('article')).toHaveCount(1);
    await view.getByRole('link',{name:'查看量表详情与原始作答',exact:false}).click();
    await view.getByRole('heading',{name:'逐题作答',exact:true}).waitFor();
    assert.equal(await view.getByText('SCR-UNIFIED',{exact:false}).count(),1);
    await view.getByRole('button',{name:'返回筛查记录',exact:true}).click();
    await button(/^量表\s+1$/).waitFor();
    assert.equal(await button(/^量表\s+1$/).getAttribute('aria-pressed'),'true','detail return preserves type filter');
    await page.reload();await button(/^量表\s+1$/).waitFor();
    await expect(view.locator('article')).toHaveCount(1);
    await button(/^文字\s+1$/).click();
    await view.getByRole('button',{name:'编辑便签',exact:true}).click();
    await view.getByPlaceholder('给这条记录补一句自己的话：当时发生了什么、后来怎么样了…').fill('统一后仍可编辑便签');
    await view.getByRole('button',{name:'保存便签',exact:true}).click();
    await view.getByText('统一后仍可编辑便签',{exact:true}).waitFor();
    await button(/^语音\s+1$/).click();
    await view.getByRole('button',{name:'删除这条记录',exact:true}).click();
    await view.getByRole('button',{name:'确定删除',exact:true}).click();
    await button(/^语音\s+0$/).waitFor();
    await button(/^全部\s+3$/).click();
    await expect(view.locator('article')).toHaveCount(3);
    assert.equal(notes,1);assert.equal(deletes,1);
    const oldReads=reads;
    await page.goto(app+'/#/personal/screening?tab=scale');
    const workspace=page.locator('[data-workspace-route="/personal/screening"][data-workspace-active="true"]');
    await workspace.getByRole('heading',{name:'量表筛查记录',exact:true}).waitFor();
    assert.equal(await workspace.getByRole('heading',{name:'我的筛查记录',exact:true}).count(),0);
    assert.equal(await workspace.getByRole('heading',{name:'我的专属心理管家',exact:true}).count(),0);
    rows.push({id:'scale:2',kind:'scale',at:'2026-11-17T20:00:00+08:00',text:'新量表',scale:{...scale,id:'SCR-NEW'}});
    await page.goto(app+'/#/personal/records');await button(/^全部\s+4$/).waitFor();
    assert.ok(reads>oldReads,'returning to retained records reloads saved inputs');
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+2);
    await page.screenshot({path:path.resolve(__dirname,'../../tmp/unified-screening-records-mobile.png'),fullPage:true});
    offline=true;await page.reload();
    await view.getByText('读取失败：',{exact:false}).waitFor();
    assert.equal(await view.getByText('这一页还是空白。',{exact:true}).count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: mixed timeline, Shanghai dates, scale filter/details/answers, filter restoration, notes/deletion, retained-page refresh, preserved scale list, mobile, errors are not empty records');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
