// All API responses are synthetic. No real plans are modified.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const app=process.env.TEST_APP_URL||'http://127.0.0.1:38982';
const original={id:987,title:'完成一件小事',detail:'用于验证完成动画',source:'user',status:'pending',createdAt:'2026-11-17 10:00',dueAt:'2026-11-20 23:59'};
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.TEST_BROWSER_PATH?{executablePath:process.env.TEST_BROWSER_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1200,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let completed=false,requests=0,fail=false,release;
  await page.addInitScript(()=>localStorage.setItem('psych_token_persistent','e30.'+btoa(JSON.stringify({sub:987,username:'__plan_ui',role:'user'}))+'.test'));
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let data={};
    if(path==='/api/personal/plans')data={pending:completed?[]:[original],archived:completed?[{...original,status:'done',completedAt:'2026-11-17 10:05'}]:[]};
    else if(path.endsWith('/987/complete')){
      requests++;
      if(fail)return route.fulfill({status:500,json:{message:'保存失败，请重试'}});
      await new Promise(resolve=>release=resolve);
      completed=true;data={plan:{...original,status:'done',completedAt:'2026-11-17 10:05'}};
    }else if(path.endsWith('/987/restore')){completed=false;data={plan:original};}
    else if(path==='/api/v1/steward')data={settings:{enabled:false},snapshot:{},memories:[],suggestions:[],series:{},evidence_count:0};
    return route.fulfill({status:200,json:data});
  });
  try{
    await page.goto(app+'/#/personal/me/feed');
    let checkbox=page.getByRole('checkbox',{name:'完成计划：完成一件小事',exact:true});
    await checkbox.click();
    await page.waitForFunction(()=>document.querySelector('input[aria-busy="true"]'));
    assert.equal(await checkbox.isChecked(),false,'must not celebrate before persistence');
    assert.equal(await page.locator('[data-plan-celebration]').count(),0);
    assert.equal(requests,1);
    release();
    await page.locator('[data-plan-celebration]').waitFor({state:'attached'});
    await page.waitForFunction(()=>{const p=document.querySelector('.plan-confetti-piece');return p && Number(getComputedStyle(p).opacity)>.1;});
    assert.equal(await checkbox.isChecked(),true);
    assert.equal(await page.locator('.plan-confetti-piece').count(),22);
    assert.equal(await page.locator('.plan-task-title').evaluate(e=>getComputedStyle(e).animationName),'plan-strike');
    await page.screenshot({path:require('node:path').resolve(__dirname,'../../tmp/plan-completion.png')});
    await checkbox.waitFor({state:'detached'});
    await page.getByRole('button',{name:/已完成计划/}).click();
    await page.getByRole('button',{name:'回归',exact:true}).click();
    await checkbox.waitFor();
    fail=true;
    await checkbox.click();
    await page.waitForFunction(()=>!document.querySelector('input[aria-busy="true"]'));
    assert.equal(await checkbox.isChecked(),false);
    assert.equal(await page.locator('[data-plan-celebration]').count(),0);
    fail=false;
    await checkbox.focus();await page.keyboard.press('Space');
    await page.waitForFunction(()=>document.querySelector('input[aria-busy="true"]'));
    release();await checkbox.waitFor({state:'detached'});
    await page.reload();
    assert.equal(await checkbox.count(),0,'completed task must stay completed after reload');
    await page.getByRole('button',{name:/已完成计划/}).click();
    await page.getByRole('button',{name:'回归',exact:true}).click();
    await checkbox.waitFor();
    await page.emulateMedia({reducedMotion:'reduce'});
    await checkbox.click();await page.waitForFunction(()=>document.querySelector('input[aria-busy="true"]'));
    release();await checkbox.waitFor({state:'detached'});
    assert.equal(requests,4);
    assert.deepEqual(errors,[]);
    console.log('PASS: completion persistence, checkbox, confetti/strike animations, restore, save failure, keyboard, reload, reduced motion');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
