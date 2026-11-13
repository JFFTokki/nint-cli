import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const runtime=new URL('../skills/nint-shop-download/scripts/runtime.mjs',import.meta.url);
const skill=fileURLToPath(new URL('../skills/nint-shop-download',import.meta.url));
const run=(env)=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`const m=await import(${JSON.stringify(runtime.href)});console.log(JSON.stringify({cliPath:m.cliPath,config:m.config}));`],{env:{...process.env,NINT_CONFIG:'',NINT_NODE_MODULES:'',...env},encoding:'utf8',stdio:['ignore','pipe','pipe']}));
test('skill resolves standalone and workbench CLI layouts without spreadsheet runtime',async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),'nint-skill-'));
 try {
  for(const layout of ['', 'packages/nint-cli']){
   const project=path.join(temp,layout?'workbench':'standalone');
   const cli=path.join(project,layout,'bin/nint.mjs');
   await mkdir(path.dirname(cli),{recursive:true});await writeFile(cli,'');
   const env={NINT_PROJECT:project,NINT_OUTPUT:path.join(temp,'output')};
   assert.deepEqual(run(env),{cliPath:cli,config:path.join(project,layout,'nint.config.json')});
   assert.equal(run({...env,NINT_CONFIG:path.join(temp,'custom.json')}).config,path.join(temp,'custom.json'));
   for(const output of [skill,path.join(skill,'output')]) assert.throws(()=>run({...env,NINT_OUTPUT:output}),/业务输出不得放入 skill 目录/);
  }
  assert.throws(()=>run({NINT_PROJECT:temp,NINT_OUTPUT:path.join(temp,'output')}),/设置 NINT_PROJECT/);
 } finally {await rm(temp,{recursive:true,force:true});}
});
