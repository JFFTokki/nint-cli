import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {cli, root} from './run-cli.mjs';
import {scriptDir, python, runtimeNode} from './runtime.mjs';

const exec=promisify(execFile);
const month=process.argv[2];
if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(month??''))throw Error('用法: node download-month.mjs YYYY-MM [已下载原始文件]');
const out=path.join(root,month,'童装_婴儿装_亲子装');
await fs.mkdir(out,{recursive:true});
if (await fs.stat(path.join(out,'店铺下载队列.json')).then(()=>true,()=>false)) throw Error('该月份目录已有队列；续跑请使用原队列，重新下载请改用新的 NINT_OUTPUT，避免覆盖进度');
const lock=await fs.open(path.join(root,'.workflow.lock'),'wx').catch(()=>{throw Error('流程已有任务运行，请等本次下载及核验完成');});
async function waitFor(predicate,label){
 for(let attempt=0;attempt<15;attempt++){
  const s=await cli('snapshot');
  if(['login_required','verification_required','permission_denied'].includes(s.state))throw Error(s.state);
  const matches=s.elements.filter(predicate);
  console.log(JSON.stringify({phase:label,attempt,unmet:matches.length===1?[]:['unique_control'],observed:{url:s.url,matches:matches.length}}));
  if(matches.length===1)return{s,e:matches[0]};
  await delay(2000+Math.random()*2000);
 }
 throw Error(`等待控件超时: ${label}`);
}
async function act(action,predicate,label,params={}){
 for(let attempt=0;attempt<3;attempt++){
  const {s,e}=await waitFor(predicate,label);
  if(action==='check'&&e.checked||action==='uncheck'&&!e.checked||action==='select'&&e.value===params.value)return;
  try{return await cli(action,{snapshot:s.snapshotId,ref:e.ref,...params});}
  catch(error){if(!/快照或元素引用已过期/.test(error.message)||attempt===2)throw error;}
 }
}
const name=(value,tag)=>e=>e.name===value&&(!tag||e.tag===tag)&&e.visible;
const id=value=>e=>e.id===value;
function validateQuery(s){
 const u=new URL(s.url);
 const conditions={path:u.pathname,rcid:u.searchParams.get('rcid'),cid:u.searchParams.get('cid'),start:s.elements.find(id('period_start'))?.value,end:s.elements.find(id('period_end'))?.value,month:s.elements.some(e=>e.id==='report_type_month'&&e.checked),scope:s.elements.filter(e=>e.type==='checkbox'&&e.checked&&/全部/.test(e.name)).map(e=>e.name),sort:s.elements.filter(e=>e.type==='radio'&&e.checked&&/销量|销售额/.test(e.name)).map(e=>e.name)};
 const valid=conditions.path==='/stat-ali-new/hot_shop'&&conditions.rcid==='2011010117'&&conditions.cid==='50008165'&&conditions.start===month&&conditions.end===month&&conditions.month&&JSON.stringify(conditions.scope)==='["天猫全部"]'&&JSON.stringify(conditions.sort)==='["销量"]';
 console.log(JSON.stringify({phase:'query_verified',unmet:valid?[]:['query_mismatch'],observed:conditions}));
 if(!valid)throw Error('查询条件不符');
 return conditions;
}
try{
 let source=process.argv[3]&&path.resolve(process.argv[3]);
 if(!source){
  await act('click',name('行业分析','a'),'行业分析');
  await act('click',name('母婴','a'),'母婴');
  await act('click',name('童装/婴儿装/亲子装','a'),'童装/婴儿装/亲子装');
  await act('click',name('热销店铺','a'),'热销店铺');
  await act('check',id('report_type_month'),'月报');
  await act('select',id('period_start'),'开始月份',{value:month});
  await act('select',id('period_end'),'结束月份',{value:month});
  await act('check',name('天猫全部'),'天猫全部');
  await act('uncheck',name('淘宝全部'),'取消淘宝全部');
  await act('check',e=>e.name==='销量'&&e.type==='radio','销量排序');
  validateQuery(await cli('snapshot'));
  await act('click',id('submit-button'),'检索');
  let previous='',stable=0;
  for(let attempt=0;attempt<30;attempt++){
   const r=await cli('read',{limit:50000});
   if(/请先登录|安全验证|验证码|无权限/.test(r.text))throw Error('页面要求登录、验证或权限');
   const ready=/Top300\s*店铺销量/.test(r.text)&&/店铺销量排名/.test(r.text);
   stable=ready&&r.text===previous?stable+1:0;previous=r.text;
   console.log(JSON.stringify({phase:'result_ready',attempt,unmet:stable?[]:['stable_sales_ranking'],observed:{ready,stable}}));
   if(stable)break;
   if(attempt===29)throw Error('榜单结果未稳定');
   await delay(2000+Math.random()*2000);
  }
  const query=validateQuery(await cli('snapshot'));
  await fs.writeFile(path.join(out,'query.json'),JSON.stringify(query,null,2));
  await act('click',id('dropdownMenuButton'),'下载菜单');
  const r=await act('download',name('店铺详细数据'),'店铺详细数据',{output:path.join(out,'原始下载'),'download-timeout':300000});
  source=r.filename;
 }
 const payload=path.join(out,'source-verified.json');
 console.log((await exec(python,[path.join(scriptDir,'verify-source.py'),source,month,payload])).stdout);
 console.log((await exec(runtimeNode,[path.join(scriptDir,'build-top100.mjs'),payload,out],{maxBuffer:2e6})).stdout);
 console.log((await exec(python,[path.join(scriptDir,'verify-result.py'),out])).stdout);
 console.log(JSON.stringify({phase:'complete',unmet:[],observed:{month,out,shops:100,productDownloadsStarted:false}}));
}finally{await lock.close();await fs.unlink(path.join(root,'.workflow.lock'));}
