import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const exec=promisify(execFile),bin=fileURLToPath(new URL('../bin/nint.mjs',import.meta.url));

test('真实 CLI 进程：版本、帮助、本地配置、不覆盖已有文件、错误退出码和离线状态',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'nint-cli-test-'));
  try{
    assert.equal((await exec(process.execPath,[bin,'--version'],{cwd:temp})).stdout.trim(),'0.3.0');
    assert.match((await exec(process.execPath,[bin,'--help'],{cwd:temp})).stdout,/用法/);assert.deepEqual(await readdir(temp),[]);
    await exec(process.execPath,[bin,'init','--config','custom.json','--output','./artifacts'],{cwd:temp});
    const original=await readFile(path.join(temp,'custom.json'),'utf8'),config=JSON.parse(original);
    assert.deepEqual(Object.keys(config).sort(),['output','dataDir','startUrl','actionTimeout','downloadTimeout','local'].sort());
    assert.deepEqual(config.local,{});assert.equal(config.output,'artifacts');
    if(process.platform!=='win32')assert.equal((await stat(path.join(temp,'custom.json'))).mode&0o777,0o600);
    await assert.rejects(exec(process.execPath,[bin,'init','--config','custom.json'],{cwd:temp}),e=>e.code===2);
    assert.equal(await readFile(path.join(temp,'custom.json'),'utf8'),original);
    for(const command of ['plan','download'])await assert.rejects(exec(process.execPath,[bin,command,'--json'],{cwd:temp}),e=>e.code===2&&JSON.parse(e.stdout).type==='error');
    const status=await exec(process.execPath,[bin,'session','status','--json'],{cwd:temp});assert.equal(JSON.parse(status.stdout).running,false);
    await assert.rejects(exec(process.execPath,[bin,'ui','snapshot','--json'],{cwd:temp}),e=>e.code===1);
    assert.deepEqual(await readdir(temp),['custom.json']);
  }finally{await rm(temp,{recursive:true,force:true});}
});
