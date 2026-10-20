import { createSession } from './session.mjs';

process.once('message',async message=>{
  let service;
  try{
    service=await createSession(message.options);
    const close=()=>void service.close();
    process.once('SIGINT',close);process.once('SIGTERM',close);
    // The server and dedicated Chrome keep the process alive after the CLI disconnects.
    await service.browser.page.goto(message.options.startUrl,{waitUntil:'domcontentloaded',timeout:message.options.actionTimeout}).catch(()=>{});
    process.send?.({ok:true,status:{running:true,pid:process.pid,dataDir:message.options.dataDir}});
  }catch(error){
    await service?.close().catch(()=>{});
    process.send?.({ok:false,error:error.message});process.disconnect?.();process.exitCode=1;
  }
});
