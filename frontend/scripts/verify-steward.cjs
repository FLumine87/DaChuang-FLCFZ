// UI fixtures only: no real user's psychological records or model service are accessed.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const app = process.env.TEST_APP_URL || 'http://127.0.0.1:38982';
const settings={enabled:false,screening:true,chat:false,checkin:false,feedback:false,history:true};
const state={settings,version:1,updated_at:new Date().toISOString(),status:'ready',error:'',evidence_count:2,
  snapshot:{summary:'最近提到考试前的睡眠困扰，也尝试通过散步放松。',window_start:'2026-10-18',window_end:'2026-11-17',source:'ai',context_count:2,observations:[{text:'最近多次提到入睡困扰。',evidence_ids:['e1','e2']}],changes:[],questions:[]},
  memories:[{id:'m1',content:'遇到压力时可能更习惯先自己消化。',status:'pending',evidence_ids:['e1','e2']}],
  suggestions:[{id:'s1',title:'安排一小段散步',detail:'选择你愿意尝试的轻松活动。',reason:'你提到散步可以放松。',state:'suggested',evidence_ids:['e2']}],series:{'PHQ-9':[{at:'2026-11-10',score:7,max:27,id:'e1',version:'v1'}]}};
state.indicators={risk:{level:'yellow',at:'2026-11-17'},mbti:null};
state.snapshot.portrait=[{text:'你愿意认真理解自己的感受，也在寻找适合自己的放松方式。',evidence_ids:['e1','e2']}];
const evidence=[{id:'e1',source:'screening',body:'考试前有点睡不着。',occurred_at:'2026-11-10',payload:{}},{id:'e2',source:'chat',body:'散步让我觉得放松。',occurred_at:'2026-11-17',payload:{}}];
state.multimodal_history=[...Array.from({length:6},(_,i)=>({id:'text'+i,kind:'text',at:'2026-11-16T02:00:00+00:00',summary:'文字筛查原文 '+i,conclusion:'本次文字检索参考',analysis_mode:'retrieval'})),
  {id:'audio1',kind:'audio',at:'2026-11-15T02:00:00+00:00',summary:'语音筛查的转写原文。',filename:'test-voice.wav',conclusion:'本次语音检索参考',analysis_mode:'retrieval'},
  {id:'image1',kind:'image',at:'2026-11-14T02:00:00+00:00',summary:'图像筛查记录（未附带文字）',filename:'test-image.png',conclusion:'',metadata_only:true}];
evidence.push(...state.multimodal_history.map(x=>({id:x.id,source:'screening',body:x.id==='image1'?'用于查看原始依据的图像记录。':x.summary,occurred_at:x.at,payload:{kind:x.kind,filename:x.filename}})));
const rid='abcdef1234567890abcdef1234567890';
let run,finished=false,chatRequests=0,legacyExtract=0,feedback=0,imports=0;
const token=name=>'e30.'+Buffer.from(JSON.stringify({sub:name==='__steward_ui'?70001:70002,username:name,role:'user'})).toString('base64url')+'.test';

(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.TEST_BROWSER_PATH?{executablePath:process.env.TEST_BROWSER_PATH}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(token=>{localStorage.setItem('psych_token_persistent',token);},token('__steward_ui'));
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),p=url.pathname,method=req.method(),body=req.postDataJSON();
    const auth=req.headers()['authorization'];
    const own=auth==='Bearer '+token('__steward_ui');
    let result={};
    if(p==='/api/v1/steward')result=own?state:{...state,settings:{...settings,enabled:false},snapshot:{},memories:[],suggestions:[],evidence_count:0};
    else if(p.endsWith('/steward/settings')){Object.assign(settings,body);result={saved:true};}
    else if(p.endsWith('/steward/chat/import')){imports++;result={imported:true};}
    else if(p.endsWith('/steward/evidence')){const ids=url.searchParams.get('ids');result=ids?evidence.filter(e=>ids.split(',').includes(e.id)):evidence;}
    else if(p.endsWith('/steward/memories')){state.indicators.mbti={type:body.content.split(' ').pop(),status:'self_report',reason:'来自你本人提供的类型',evidence_ids:['e2']};result={saved:true};}
    else if(p.includes('/steward/memories/')){const m=state.memories.find(x=>x.id===p.split('/').pop());if(body.action==='confirm')m.status='confirmed';else if(body.action==='correct'){m.content=body.content;m.status='confirmed';}result={saved:true};}
    else if(p.includes('/steward/suggestions/')){state.suggestions[0].state=body.action==='accept'?'accepted':'dismissed';state.suggestions[0].plan_id=42;result={saved:true};}
    else if(p==='/api/personal/steward/feedback'){feedback++;result={saved:true};}
    else if(p.endsWith('/steward/safety'))result={crisis_hits:[]};
    else if(p.endsWith('/steward/chat/runs')){chatRequests++;run={id:rid,message:body.message,reply:'后台生成到一半',status:'running',created_at:new Date().toISOString()};result={id:rid};}
    else if(p.includes('/steward/chat/runs/'))result={...run,reply:finished?'后台生成到一半，切页后也已完成。':'后台生成到一半',status:finished?'done':'running'};
    else if(p.endsWith('/steward/chat/history'))result=own&&run?[{...run,reply:finished?'后台生成到一半，切页后也已完成。':'后台生成到一半',status:finished?'done':'running'}]:[];
    else if(p.includes('/chat/companion/stream'))return route.fulfill({status:200,contentType:'text/event-stream',body:'data: {"delta":"临时回应，不形成记忆。"}\n\ndata: [DONE]\n\n'});
    else if(p.includes('/kg/extract')){legacyExtract++;result={triples:[]};}
    else if(p.includes('/checkin/present'))result={checkin:null};
    else if(p==='/api/personal/plans')result={pending:state.suggestions[0].state==='accepted'?[{id:42,title:state.suggestions[0].title,source:'user',status:'pending',createdAt:new Date().toISOString()}]:[],archived:[],generatedAt:''};
    else if(p==='/api/account')result={account:{username:'__steward_ui',name:'',department:'',phone:'',email:'',role:'user'}};
    else if(p.includes('/screenings')||p.includes('/supplements'))result=[];
    else if(p.endsWith('/steward/graph'))result={nodes:[{id:'u',name:'我',label:'User'},{id:'e1',name:'考试前的睡眠',label:'Evidence'},{id:'m1',name:'愿意理解自己',label:'Memory'},{id:'s1',name:'散步放松',label:'Suggestion'}],links:[{source:'u',target:'e1',relation:'本人记录'},{source:'u',target:'m1',relation:'个人记忆'},{source:'m1',target:'e1',relation:'依据'},{source:'u',target:'s1',relation:'行动建议'}],neo4j_connected:true};
    return route.fulfill({status:200,json:result});
  });
  const go=async p=>{await page.evaluate(p=>location.hash='#'+p,p);await page.waitForURL('**/#'+p);await page.locator(`[data-workspace-route="${p}"][data-workspace-active="true"]`).last().waitFor();};
  try{
    await page.goto(app+'/#/personal/me/kg');
    await page.getByRole('button',{name:'选择来源并开启',exact:true}).click();
    await page.getByLabel('开启心理管家（关闭即暂停分析与使用记忆）').check();
    await page.getByLabel('允许使用陪伴聊天',{exact:true}).check();
    await page.getByLabel('允许使用每日问询',{exact:true}).check();
    await page.getByLabel('允许使用行动效果反馈',{exact:true}).check();
    await page.getByRole('button',{name:'保存选择',exact:true}).click();
    await page.getByRole('heading',{name:'我眼中的你',exact:true}).waitFor();
    assert.equal(imports,1);
    await page.getByRole('heading',{name:'我眼中的你',exact:true}).waitFor();
    await page.getByRole('heading',{name:'近期需要关注',exact:true}).waitFor();
    await page.getByRole('heading',{name:'心理档案关系图谱',exact:true}).waitFor();
    const history=page.locator('details').filter({has:page.locator('summary').filter({hasText:'筛查历史与原始记录'})});
    await history.locator('summary').click();
    await history.getByRole('heading',{name:'文字筛查 · 6 条',exact:true}).waitFor();
    await history.getByRole('heading',{name:'语音筛查 · 1 条',exact:true}).waitFor();
    await history.getByRole('heading',{name:'图像筛查 · 1 条',exact:true}).waitFor();
    await history.getByText('文件：test-voice.wav',{exact:true}).waitFor();
    await history.getByText('未保存分析结果',{exact:true}).waitFor();
    assert.equal(await history.getByText('文字筛查原文 5',{exact:true}).count(),0);
    await history.getByRole('button',{name:'查看其余 1 条文字筛查记录',exact:true}).click();
    await history.getByText('文字筛查原文 5',{exact:true}).waitFor();
    await history.getByRole('heading',{name:'PHQ-9 历次结果',exact:true}).waitFor();
    await history.locator('article').filter({hasText:'test-image.png'}).getByRole('button',{name:'查看原始依据',exact:true}).click();
    await page.getByText('用于查看原始依据的图像记录。',{exact:true}).waitFor();
    await page.getByRole('button',{name:'收起依据',exact:true}).click();
    await history.locator('summary').click();
    assert.equal(await page.getByRole('button',{name:'档案与记忆',exact:true}).count(),0);
    assert.equal(await page.getByText('我的特点与记忆',{exact:true}).isVisible(),false);
    await page.locator('summary').filter({hasText:'记忆与依据管理'}).click();
    await page.getByRole('button',{name:'符合我',exact:true}).click();
    await page.getByText('本人已确认',{exact:true}).waitFor();
    await page.getByRole('button',{name:'纠正',exact:true}).click();
    await page.getByLabel('纠正记忆').fill('我更愿意和朋友讨论压力。');
    await page.getByRole('button',{name:'保存纠正',exact:true}).click();
    await page.getByLabel('纠正记忆').waitFor({state:'hidden'});
    await page.getByText('我更愿意和朋友讨论压力。',{exact:true}).waitFor();
    await page.getByRole('button',{name:'查看依据',exact:true}).first().click();
    await page.getByText('散步让我觉得放松。',{exact:true}).waitFor();
    await page.getByRole('button',{name:'收起依据',exact:true}).click();
    await page.locator('summary').filter({hasText:'记忆与依据管理'}).click();
    await page.getByRole('button',{name:'填写我的类型',exact:true}).click();
    await page.getByLabel('我的MBTI类型').selectOption('INFP');
    await page.getByRole('button',{name:'保存本人类型',exact:true}).click();
    await page.getByText('本人提供的类型',{exact:true}).waitFor();
    await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('.app-content')?.scrollTo(0,0);});
    await page.screenshot({path:path.resolve(__dirname,'../../tmp/steward-profile.png'),fullPage:true});
    await go('/personal/me/feed');
    await page.getByRole('button',{name:'加入行动计划',exact:true}).click();
    await page.getByText('已加入行动计划',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:/^(有帮助|一般|没帮助)$/}).count(),0);
    assert.equal(feedback,0);
    await go('/personal/me/chat');
    const composer=page.getByPlaceholder('聊聊你的状态、兴趣或烦恼…（Enter 发送，Shift+Enter 换行）');
    const temporary=page.getByRole('checkbox',{name:'临时对话：不保存本次消息，不形成长期记忆'});
    await temporary.check();await composer.fill('不应保存的临时内容');await page.getByRole('button',{name:'发送',exact:true}).click();
    await page.getByText('临时回应，不形成记忆。',{exact:true}).waitFor();
    assert.equal(chatRequests,0);assert.equal(legacyExtract,0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('psych_chat:v1:__steward_ui')?.includes('不应保存的临时内容')),false);
    await temporary.uncheck();await composer.fill('正常保存的近况');await page.getByRole('button',{name:'发送',exact:true}).click();
    await page.getByText('后台生成到一半',{exact:true}).waitFor();
    await go('/personal/settings');finished=true;
    const preferences=page.getByRole('heading',{name:'AI 与分析偏好',exact:true}).locator('..');
    await preferences.getByRole('heading',{name:'检索与分析偏好',exact:true}).waitFor();
    await preferences.getByRole('heading',{name:'心理管家与记忆设置',exact:true}).waitFor();
    assert.equal(await preferences.evaluate(el=>el.classList.contains('ui-card') && el.nextElementSibling===null),true,'combined preferences must be the final settings card');
    assert.equal(await page.getByRole('heading',{name:'我的专属心理管家',exact:true}).count(),0);
    assert.equal(await preferences.getByRole('button',{name:'更新分析',exact:true}).count(),0);
    await page.waitForTimeout(400);await go('/personal/me/chat');
    await page.getByText('后台生成到一半，切页后也已完成。',{exact:true}).waitFor();
    await page.reload();await page.getByText('后台生成到一半，切页后也已完成。',{exact:true}).waitFor();
    assert.equal(chatRequests,1);
    await page.setViewportSize({width:390,height:844});await go('/personal/me/kg');
    await page.getByRole('heading',{name:'我眼中的你',exact:true}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'mobile overflow');
    await page.screenshot({path:path.resolve(__dirname,'../../tmp/steward-mobile.png'),fullPage:true});
    await page.evaluate(t=>{localStorage.setItem('psych_token_persistent',t);location.hash='#/personal/me/chat';},token('__other_steward'));
    await page.getByText('后台生成到一半，切页后也已完成。',{exact:true}).waitFor({state:'detached'});
    assert.deepEqual(errors,[]);
    console.log('PASS: consent, text/audio/image screening history and expansion/source evidence, scales retained, memory confirmation/correction, plans/status without feedback prompts, temporary privacy, durable chat across navigation/reload, mobile, account isolation');
  }catch(error){console.error(page.url(),errors,(await page.locator('body').innerText()).slice(0,1800));throw error;}
  finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
