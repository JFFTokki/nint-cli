import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {launchBrowser} from '../src/browser.mjs';
import {UiController,assertNintUrl,safeUrl} from '../src/ui.mjs';
import {createSession,sessionRequest,readSession,sessionFile} from '../src/session.mjs';
import {fixtureHtml} from './helpers.mjs';
const exec=promisify(execFile),bin=fileURLToPath(new URL('../bin/nint.mjs',import.meta.url));

async function fixtureBrowser(options){
 const browser=await launchBrowser(options,async(profile,settings)=>chromium.launchPersistentContext(profile,{...settings,headless:true}));
 await browser.context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='art.nint.com'){
   if(route.request().isNavigationRequest())await route.fallback();else await route.abort();return;
  }
  await route.fulfill({contentType:'text/html',body:fixtureHtml(url.pathname==='/fixture')});
 });
 await browser.page.goto('https://art.nint.com/fixture');return browser;
}
const config=temp=>({dataDir:path.join(temp,'data'),output:path.join(temp,'output'),startUrl:'https://art.nint.com/',actionTimeout:3000,downloadTimeout:3000});
async function byId(ui,action,id,params={},options={}){const snapshot=await ui.snapshot();const element=snapshot.elements.find(e=>e.id===id);assert.ok(element,`missing ${id}`);return ui.execute(action,{snapshotId:snapshot.snapshotId,ref:element.ref,...params},options);}

test('UI快照绑定DOM节点：过期引用、重绘、敏感输入、iframe、shadow、选择/上传/下载与标签页',{timeout:60000},async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),'nint-ui-test-'));const options=config(temp);let browser;
 try{
  browser=await fixtureBrowser(options);const ui=new UiController(browser);
  let snapshot=await ui.snapshot();assert.equal(snapshot.state,'login_required');assert.ok(!JSON.stringify(snapshot).includes('fixture-secret-value'));
  assert.ok(snapshot.elements.some(e=>e.id==='inside'));assert.ok(snapshot.elements.some(e=>e.id==='shadow-button'));
  const original=snapshot,field=snapshot.elements.find(e=>e.id==='generic');
  const filled=await ui.execute('fill',{snapshotId:snapshot.snapshotId,ref:field.ref,value:'测试内容'},options);
  assert.equal(await browser.page.locator('#generic').inputValue(),'测试内容');
  await assert.rejects(ui.execute('fill',{snapshotId:original.snapshotId,ref:field.ref,value:'错误内容'},options),error=>error.code==='stale_snapshot');
  assert.equal(await browser.page.locator('#generic').inputValue(),'测试内容');
  snapshot=await ui.snapshot();const victim=snapshot.elements.find(e=>e.id==='victim');
  await browser.page.locator('#victim').evaluate(el=>el.outerHTML='<button id="victim">不同节点</button>');
  await assert.rejects(ui.target(snapshot.snapshotId,victim.ref),error=>error.code==='stale_element');
  await byId(ui,'select','choose',{value:'b'},options);assert.equal(await browser.page.locator('#choose').inputValue(),'b');
  await byId(ui,'check','tick',{},options);assert.equal(await browser.page.locator('#tick').isChecked(),true);
  await byId(ui,'uncheck','tick',{},options);assert.equal(await browser.page.locator('#tick').isChecked(),false);
  await byId(ui,'click','tick',{},options);assert.equal(await browser.page.locator('#tick').isChecked(),true);
  await byId(ui,'click','inside',{},options);await byId(ui,'click','shadow-button',{},options);
  const file=path.join(temp,'fixture.txt');await writeFile(file,'local fixture');await byId(ui,'upload','file',{files:[file]},options);
  assert.equal(await browser.page.locator('#file').evaluate(el=>el.files[0].name),'fixture.txt');
  const download=await byId(ui,'download','download',{},options);assert.equal(await readFile(download.filename,'utf8'),'a,b\n1,2');assert.equal(download.verification,'browser_download_only');
  const image=await ui.execute('screenshot',{},options);assert.ok((await stat(image.filename)).size>100);
  const oldTab=ui.active;await byId(ui,'click','popup',{},options);await browser.context.waitForEvent('page',{timeout:50}).catch(()=>{});
  assert.ok(ui.tabs().length>=3);await ui.execute('tab',{tab:oldTab},options);assert.equal(ui.active,oldTab);
  await assert.rejects(browser.page.goto('https://outside.example/'));
  assert.throws(()=>assertNintUrl('https://outside.example/'));assert.throws(()=>assertNintUrl('https://nint.com.evil.example/'));
  assert.ok(!safeUrl('https://art.nint.com/a?token=fixture-token&view=example#access_token=test').includes('fixture-token'));
 }finally{await browser?.context.close().catch(()=>{});await rm(temp,{recursive:true,force:true});}
});

test('本地服务：认证、串行操作、跨 CLI 进程、盘点、取消与停止',{timeout:60000},async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),'nint-service-test-'));const options=config(temp);let service;
 try{
  service=await createSession(options,{launchBrowser:fixtureBrowser});
  const state=await readSession(options.dataDir),base=`http://127.0.0.1:${state.port}`;
  assert.equal((await fetch(`${base}/status`)).status,403);
  assert.equal((await fetch(`${base}/status`,{headers:{Authorization:`Bearer ${state.token}`,Origin:'https://example.com'}})).status,403);
  if(process.platform!=='win32')assert.equal((await stat(sessionFile(options.dataDir))).mode&0o777,0o600);
  const malformed=await fetch(`${base}/command`,{method:'POST',headers:{Authorization:`Bearer ${state.token}`,'Content-Type':'application/json'},body:'not json'});assert.equal(malformed.status,400);
  const status=await sessionRequest(options.dataDir,'status');assert.equal(status.running,true);assert.ok(!JSON.stringify(status).includes(state.token));
  const initial=await sessionRequest(options.dataDir,{group:'ui',action:'snapshot'});
  const field=initial.elements.find(e=>e.id==='generic');
  const first=sessionRequest(options.dataDir,{group:'ui',action:'fill',params:{snapshotId:initial.snapshotId,ref:field.ref,value:'first'}});
  const second=sessionRequest(options.dataDir,{group:'ui',action:'fill',params:{snapshotId:initial.snapshotId,ref:field.ref,value:'second'}});
  const responses=await Promise.allSettled([first,second]);assert.equal(responses.filter(r=>r.status==='fulfilled').length,1);assert.equal(responses.filter(r=>r.status==='rejected').length,1);
  assert.equal(await service.ui.page.locator('#generic').inputValue(),responses[0].status==='fulfilled'?'first':'second');
  const subprocess=await exec(process.execPath,[bin,'ui','snapshot','--data-dir',options.dataDir,'--output',options.output,'--json'],{cwd:temp});
  assert.ok(JSON.parse(subprocess.stdout).elements.some(e=>e.id==='generic'));
  const capture=await sessionRequest(options.dataDir,{group:'inventory',action:'capture',params:{label:'fixture页面'}});assert.ok((await readFile(capture.filename,'utf8')).includes('live_browser_observation'));
  const report=await sessionRequest(options.dataDir,{group:'inventory',action:'report'});assert.equal(report.visitedPages,1);assert.ok(report.interactionCandidates>0);
  await assert.rejects(sessionRequest(options.dataDir,{group:'download'}),/未知会话命令/);
  assert.equal((await sessionRequest(options.dataDir,'status')).running,true);
  const last=await sessionRequest(options.dataDir,{group:'ui',action:'snapshot'});
  assert.ok(last.elements.length>0);
  const cancelled=new AbortController();const pending=sessionRequest(options.dataDir,{group:'ui',action:'wait',params:{text:'never appears fixture'}},{signal:cancelled.signal});
  const timer=setTimeout(()=>cancelled.abort(),100);try{await assert.rejects(pending);}finally{clearTimeout(timer);}
  assert.equal((await sessionRequest(options.dataDir,'status')).running,true);
  const stopped=await exec(process.execPath,[bin,'session','stop','--data-dir',options.dataDir,'--json'],{cwd:temp});assert.equal(JSON.parse(stopped.stdout).status,'stopped');assert.equal(await readSession(options.dataDir),null);
 }finally{await service?.close();await rm(temp,{recursive:true,force:true});}
});
