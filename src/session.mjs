import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, open, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { acquireLock, launchBrowser } from './browser.mjs';
import { UiController } from './ui.mjs';
import { captureInventory, reportInventory } from './inventory.mjs';

export const sessionFile = dataDir=>path.join(dataDir,'nint-session.json');
export async function readSession(dataDir) {
  let state;
  try{state=JSON.parse(await readFile(sessionFile(dataDir),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw new Error('会话描述文件无效，请检查专用数据目录');}
  if(state.protocol!==2||!Number.isInteger(state.port)||state.port<1||state.port>65535||!Number.isInteger(state.pid)||state.pid<1||!/^\w{64}$/.test(state.token)||path.resolve(state.dataDir)!==path.resolve(dataDir))throw new Error('会话描述文件不符合本地服务格式');
  return state;
}
function authorized(request,token,port){
  if(request.headers.origin!==undefined||request.headers.host!==`127.0.0.1:${port}`)return false;
  const supplied=request.headers.authorization??'';const expected=`Bearer ${token}`;
  return Buffer.byteLength(supplied)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(supplied),Buffer.from(expected));
}
async function requestBody(request){
  let size=0;const chunks=[];
  for await(const chunk of request){size+=chunk.length;if(size>1024*1024)throw new Error('请求过大');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const optionKeys=['output','dataDir','startUrl','actionTimeout','downloadTimeout'];
export const sessionOptions=options=>Object.fromEntries(optionKeys.filter(key=>options[key]!==undefined).map(key=>[key,options[key]]));

/** The server owns one dedicated browser and serializes every operation against it. */
export async function createSession(options,dependencies={}){
  const release=await (dependencies.acquireLock??acquireLock)(options.dataDir);
  let browser,server,closing=false,closePromise,active,tail=Promise.resolve(),queued=0;
  const token=randomBytes(32).toString('hex');
  let state;
  const close=()=>closePromise??=(async()=>{
    closing=true;
    active?.abort(new Error('常驻会话已停止'));
    await browser?.context.close().catch(()=>{});
    if(server){server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));}
    await tail.catch(()=>{});
    const current=await readSession(options.dataDir).catch(()=>null);
    if(current?.token===token)await unlink(sessionFile(options.dataDir)).catch(()=>{});
    await release();
  })();
  try{
    browser=await (dependencies.launchBrowser??launchBrowser)(options);
    const ui=new UiController(browser);
    server=http.createServer(async(request,response)=>{
      response.setHeader('Cache-Control','no-store');
      if(!authorized(request,token,server.address()?.port)){response.writeHead(403);response.end('Forbidden');return;}
      const json=value=>{response.setHeader('Content-Type','application/json');response.end(JSON.stringify(value));};
      if(request.method==='GET'&&request.url==='/status'){
        json({running:!closing,pid:process.pid,protocol:2,busy:queued>0,tabs:ui.tabs(),dataDir:options.dataDir});return;
      }
      if(request.method==='POST'&&request.url==='/stop'){
        json({status:'stopping'});setImmediate(()=>void close());return;
      }
      if(request.method!=='POST'||request.url!=='/command'){response.writeHead(404);response.end();return;}
      let command;
      try{command=await requestBody(request);if(!command||typeof command!=='object'||Array.isArray(command))throw new Error('命令必须为JSON对象');}catch(error){response.statusCode=400;json({error:error.message});return;}
      if(closing){response.statusCode=409;json({error:'会话正在停止'});return;}
      const controller=new AbortController();
      response.on('close',()=>{if(!response.writableEnded)controller.abort(new Error('客户端已断开'));});
      queued++;
      response.setHeader('Content-Type','application/x-ndjson');
      const send=value=>{if(!response.destroyed)response.write(`${JSON.stringify(value)}\n`);};
      const job=async()=>{
        controller.signal.throwIfAborted();if(closing)throw new Error('会话已停止');active=controller;
        const settings={...options,...sessionOptions(command.options??{}),dataDir:options.dataDir,signal:controller.signal};
        if(path.resolve(command.options?.dataDir??options.dataDir)!==path.resolve(options.dataDir))throw new Error('命令的数据目录与会话不一致');
        if(command.group==='ui'){
          const page=ui.pages.get(ui.active);
          const cancel=()=>{void(async()=>{if(browser.context.pages().filter(p=>!p.isClosed()).length<=1)await browser.context.newPage();await page?.close();})().catch(()=>{});};
          controller.signal.addEventListener('abort',cancel,{once:true});
          try{return await ui.execute(command.action,command.params,settings);}
          finally{controller.signal.removeEventListener('abort',cancel);}
        }
        if(command.group==='inventory'){
          if(command.action==='capture')return captureInventory(ui,settings,command.params?.label);
          if(command.action==='report')return reportInventory(settings);
        }
        throw new Error('未知会话命令');
      };
      tail=tail.then(async()=>{
        try{send({type:'result',result:await job()});}
        catch(error){send({type:'error',error:{code:error.code??'session_error',message:error.message}});}
        finally{active=null;queued--;response.end();}
      }).catch(()=>{});
    });
    server.requestTimeout=30000;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    state={protocol:2,pid:process.pid,port:server.address().port,token,dataDir:options.dataDir,createdAt:new Date().toISOString()};
    const file=await open(sessionFile(options.dataDir),'w',0o600);
    try{await file.chmod(0o600);await file.writeFile(JSON.stringify(state));}finally{await file.close();}
    browser.context.on('close',()=>{if(!closing)void close();});
    return {state,ui,browser,close};
  }catch(error){await close();throw error;}
}

export async function sessionRequest(dataDir,command,{signal,onEvent}={}){
  const state=await readSession(dataDir);
  if(!state)throw new Error('常驻会话未启动，请先运行 nint session start');
  const headers={Authorization:`Bearer ${state.token}`};
  const endpoint=command==='status'?'/status':command==='stop'?'/stop':'/command';
  let response;
  try{response=await fetch(`http://127.0.0.1:${state.port}${endpoint}`,{method:command==='status'?'GET':'POST',headers:{...headers,'Content-Type':'application/json'},body:typeof command==='object'?JSON.stringify(command):undefined,signal});}
  catch(error){if(signal?.aborted)throw error;throw new Error('无法连接本地会话服务；使用 nint session start 检查或重启');}
  if(!response.ok)throw new Error(`本地会话请求失败：HTTP ${response.status}`);
  if(endpoint!=='/command')return response.json();
  let buffer='',result,received=false;const decoder=new TextDecoder();
  const parse=async line=>{
    if(!line.trim())return;const item=JSON.parse(line);
    if(item.type==='event')await onEvent?.(item.event);
    else if(item.type==='result'){result=item.result;received=true;}
    else if(item.type==='error'){const error=new Error(item.error.message);error.code=item.error.code;throw error;}
  };
  for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);await parse(line);}}
  buffer+=decoder.decode();await parse(buffer);
  if(!received)throw new Error('会话连接结束但未收到结果');
  return result;
}
