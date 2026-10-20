import { fork } from 'node:child_process';
import { open, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readSession,sessionRequest,sessionOptions,sessionFile } from './session.mjs';

export async function existingSession(dataDir){
  const state=await readSession(dataDir);if(!state)return null;
  try{return await sessionRequest(dataDir,'status',{signal:AbortSignal.timeout(2000)});}
  catch(error){
    let dead=false;try{process.kill(state.pid,0);}catch(cause){dead=cause.code==='ESRCH';}
    if(!dead)throw error;
    // Only remove the stale descriptor we inspected, never a newer service's descriptor.
    if((await readSession(dataDir))?.token===state.token)await unlink(sessionFile(dataDir));
    return null;
  }
}

export async function startSession(options){
  const current=await existingSession(options.dataDir);if(current)return{...current,status:'already_running'};
  await mkdir(options.dataDir,{recursive:true,mode:0o700});
  const log=await open(path.join(options.dataDir,'nint-session.log'),'a',0o600);
  let child;
  try{
    child=fork(fileURLToPath(new URL('./session-daemon.mjs',import.meta.url)),[],{detached:true,execArgv:[],stdio:['ignore',log.fd,log.fd,'ipc'],windowsHide:false});
    const ready=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill();reject(new Error('常驻服务启动超时，查看 data/nint-session.log'));},Math.max(30000,options.actionTimeout+10000));
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',()=>{clearTimeout(timer);reject(new Error('常驻服务启动失败，查看专用数据目录的 nint-session.log'));});
      child.once('message',message=>{clearTimeout(timer);message.ok?resolve(message.status):reject(new Error(message.error));});
      child.send({options:sessionOptions(options)});
    });
    child.disconnect();child.unref();
    return{...ready,status:'started'};
  }finally{await log.close();}
}

export async function stopSession(options){
  const state=await readSession(options.dataDir);if(!state)return{running:false,status:'not_running'};
  await sessionRequest(options.dataDir,'stop',{signal:options.signal});
  const start=Date.now();
  while(Date.now()-start<15000){
    const current=await readSession(options.dataDir);
    if(!current||current.token!==state.token)return{running:false,status:'stopped'};
    await delay(100,undefined,{signal:options.signal});
  }
  throw new Error('服务正在关闭但尚未释放专用目录，请稍后检查 session status');
}
