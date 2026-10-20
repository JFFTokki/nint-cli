import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWrite } from './files.mjs';

export async function captureInventory(ui, options, label) {
  const snapshot = await ui.snapshot();
  const directory = path.join(options.output, 'inventory');
  await mkdir(directory,{recursive:true});
  const id = `${Date.now()}-${randomUUID().slice(0,8)}`;
  const filename = path.join(directory,`capture-${id}.json`);
  const record = { id, capturedAt:snapshot.capturedAt, evidence:'live_browser_observation', label:label||snapshot.title,
    url:snapshot.url, title:snapshot.title, state:snapshot.state, snapshot,
    performedActions:ui.actions.filter(action=>action.url===snapshot.url),
    limitations:['仅记录当前已加载页面与可见交互候选；未自动遍历或执行候选动作','performed表示动作已执行，不表示业务流程已验收','元素引用仅在当前服务快照内有效'] };
  await atomicWrite(filename,`${JSON.stringify(record,null,2)}\n`);
  return { filename, recordId:id, state:snapshot.state, snapshot };
}

export async function reportInventory(options) {
  const directory=path.join(options.output,'inventory');
  await mkdir(directory,{recursive:true});
  const records=[];
  for (const name of (await readdir(directory)).filter(name=>/^capture-.*\.json$/.test(name)).sort()) {
    records.push({...JSON.parse(await readFile(path.join(directory,name),'utf8')), filename:path.join(directory,name)});
  }
  records.sort((left,right)=>Date.parse(left.capturedAt)-Date.parse(right.capturedAt)||left.id.localeCompare(right.id));
  const pages=[...new Map(records.map(record=>[record.url,record])).values()];
  const routes=new Map();
  for(const record of records)for(const element of record.snapshot.elements){
    try{const url=new URL(element.href);if(!/(^|\.)nint\.com$/i.test(url.hostname)||!['http:','https:'].includes(url.protocol))continue;
      url.hash='';const href=url.href;
      if(!routes.has(href))routes.set(href,{url:href,name:element.name,discoveredFrom:record.url,status:'discovered_only'});
    }catch{/* Non-navigation elements do not add routes. */}
  }
  for(const page of pages){try{const url=new URL(page.url);url.hash='';if(routes.has(url.href))routes.get(url.href).status=page.state;}catch{}}
  const result={ generatedAt:new Date().toISOString(), captures:records.length, visitedPages:pages.length,
    stateCounts:Object.fromEntries([...new Set(pages.map(page=>page.state))].map(state=>[state,pages.filter(page=>page.state===state).length])),
    interactionCandidates:pages.reduce((sum,page)=>sum+page.snapshot.elements.length,0),
    performedActions:new Set(records.flatMap(record=>record.performedActions).map(action=>action.id??JSON.stringify(action))).size,
    pages:pages.map(record=>({url:record.url,title:record.title,label:record.label,state:record.state,controls:record.snapshot.elements.length,truncated:record.snapshot.truncated,filename:record.filename})),
    discoveredRoutes:[...routes.values()],
    coverage:'当前账号本轮已观察页面；不代表全站、全部状态或全部交互已经验收' };
  const jsonPath=path.join(directory,'catalog.json'),markdownPath=path.join(directory,'catalog.md');
  await atomicWrite(jsonPath,`${JSON.stringify(result,null,2)}\n`);
  const clean=value=>String(value??'').replace(/\|/g,'\\|').replace(/[\r\n]/g,' ');
  const markdown=`# 情报通页面与交互盘点\n\n${result.coverage}。\n\n访问 ${result.visitedPages} 个不同页面，${result.interactionCandidates} 个可见交互候选，发现 ${routes.size} 个站内链接。元素数量不等于已验证功能数量。\n\n| 页面 | 状态 | 交互候选 | 证据 |\n|---|---|---:|---|\n${result.pages.map(page=>`| ${clean(page.title)} | ${page.state} | ${page.controls}${page.truncated?'（截断）':''} | [JSON](${page.filename}) |`).join('\n')}\n\n只读观察、动作执行与业务验收分别记录；未访问链接为 discovered_only。\n`;
  await atomicWrite(markdownPath,markdown);
  return { jsonPath,markdownPath,...result };
}
