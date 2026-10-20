import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadOptions } from '../src/config.mjs';
import { acquireLock, assertNavigation } from '../src/browser.mjs';
import { reportInventory } from '../src/inventory.mjs';
import { sessionOptions } from '../src/session.mjs';

test('配置隔离：本地备注不进入运行选项或服务请求，路径与命令行覆盖正确',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'nint-config-test-'));
  try{
    await writeFile(path.join(temp,'custom.json'),JSON.stringify({output:'./artifacts',dataDir:'./profile-root',local:{privateNote:'local-only-fixture'}}));
    const options=await loadOptions(['ui','scroll','--config',path.join(temp,'custom.json'),'--output','./override','--y','-200'],temp);
    assert.equal(options.output,path.join(temp,'override'));assert.equal(options.dataDir,path.join(temp,'profile-root'));assert.equal(options.params.y,-200);
    assert.equal(options.startUrl,'https://art.nint.com/');assert.equal(options.local,undefined);
    assert.ok(!JSON.stringify(options).includes('local-only-fixture'));
    assert.ok(!JSON.stringify(sessionOptions({...options,local:{privateNote:'local-only-fixture'}})).includes('local-only-fixture'));
    for(const argv of [['plan'],['download'],['init','--category','placeholder'],['ui','click'],['session','start','--action-timeout','-1'],['session','start','--start-url','https://outside.example/'],['init','--output','./data/browser-profile/artifacts']])await assert.rejects(loadOptions(argv,temp));
    await writeFile(path.join(temp,'invalid.json'),JSON.stringify({unknownPreference:'placeholder'}));
    await assert.rejects(loadOptions(['init','--config','invalid.json'],temp),/未知配置字段/);
  }finally{await rm(temp,{recursive:true,force:true});}
});

test('专用目录锁保持所有权，页面导航限制在情报通域名',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'nint-lock-test-'));
  try{
    const release=await acquireLock(temp);await assert.rejects(acquireLock(temp),/另一个 CLI/);await release();
    const again=await acquireLock(temp);await again();
    for(const url of ['https://outside.example/','https://nint.com.outside.example/','file:///tmp/fixture','https://user:pass@art.nint.com/'])assert.throws(()=>assertNavigation(url));
    assert.doesNotThrow(()=>assertNavigation('https://art.nint.com/'));assert.doesNotThrow(()=>assertNavigation('about:blank'));
  }finally{await rm(temp,{recursive:true,force:true});}
});

test('盘点按观察时间保留最新状态，区分发现链接并去重动作',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'nint-inventory-test-'));
  try{
    await mkdir(path.join(temp,'inventory'));
    const base={url:'https://art.nint.com/fixture',title:'fixture',label:'fixture',performedActions:[{id:'same-action',action:'click'}]};
    await writeFile(path.join(temp,'inventory','capture-z-old.json'),JSON.stringify({...base,id:'old',capturedAt:'2000-01-01T00:00:00Z',state:'permission_denied',snapshot:{elements:[{name:'old'}]}}));
    await writeFile(path.join(temp,'inventory','capture-a-new.json'),JSON.stringify({...base,id:'new',capturedAt:'2000-01-02T00:00:00Z',state:'observed',snapshot:{elements:[{name:'new',href:'https://art.nint.com/other'}]}}));
    const report=await reportInventory({output:temp});
    assert.equal(report.pages[0].state,'observed');assert.equal(report.interactionCandidates,1);assert.equal(report.performedActions,1);assert.equal(report.discoveredRoutes[0].status,'discovered_only');
  }finally{await rm(temp,{recursive:true,force:true});}
});
