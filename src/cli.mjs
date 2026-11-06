import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadOptions, UsageError } from './config.mjs';
import { startSession, stopSession, existingSession } from './session-client.mjs';
import { sessionRequest, sessionOptions } from './session.mjs';
import { reportInventory } from './inventory.mjs';

const help = `情报通 CLI

用法：nint <init|login|session|ui|inventory> [选项]
  init                         创建本地 nint.config.json，不覆盖已有文件
  login                        打开常驻专用 Chrome，在窗口中手动登录
  session start|status|stop     启动、查看、停止专用浏览器常驻会话
  ui snapshot|read|tables|tabs   查看页面、文字、已加载表格或专用标签页
  ui open --url URL            打开情报通页面
  ui click|fill|select|check|uncheck|hover|press|drag|upload|download
  ui scroll|wait|back|forward|reload|screenshot|tab|close-tab
  inventory capture|report     保存页面盘点，或汇总已观察页面

选项：
  --config FILE                本地配置，默认 nint.config.json
  --output DIR --data-dir DIR   输出目录与专用浏览器数据目录
  --start-url URL              启动页面，限 nint.com 及其子域
  --browser-executable FILE    指定专用 Chrome 可执行文件
  --action-timeout MS           UI 等待时间，默认 60000
  --download-timeout MS         浏览器下载等待时间，默认 60000
  --snapshot ID --ref ID        使用最新快照与元素引用操作
  --value TEXT --key KEY        填写/选择内容或按键名称
  --target REF --file FILE      拖拽目标或上传文件（可重复）
  --text TEXT --state STATE     等待文字可见/隐藏
  --tab ID --x N --y N          选择标签页或滚动距离
  --label TEXT --limit N        盘点标签或读取数量上限
  --json --help --version

需要 Node.js 22.13+ 和 Google Chrome。每位使用者在自己的专用窗口登录。`;

export async function main(argv) {
  let options;
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('用户中断'));
  try {
    options = await loadOptions(argv);
    if (options.command === 'help') {
      console.log(options.version ? JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version : help);
      return 0;
    }
    if (options.command === 'init') {
      const relative = filename => path.relative(path.dirname(options.configPath),filename).split(path.sep).join('/') || '.';
      const config = {output:relative(options.output),dataDir:relative(options.dataDir),startUrl:options.startUrl,actionTimeout:options.actionTimeout,downloadTimeout:options.downloadTimeout,local:{}};
      if (options.browserExecutable !== undefined) config.browserExecutable = relative(options.browserExecutable);
      await writeFile(options.configPath,`${JSON.stringify(config,null,2)}\n`,{flag:'wx',mode:0o600});
      console.log(options.json ? JSON.stringify({configPath:options.configPath}) : `已创建 ${options.configPath}`);
      return 0;
    }
    process.once('SIGINT',interrupt); process.once('SIGTERM',interrupt);
    options.signal = controller.signal;
    let result;
    if (options.command === 'login') {
      result = {...await startSession(options),loginStatus:'manual',message:'请在专用 Chrome 窗口完成登录；CLI 不自动判断账号登录成功。'};
    } else if (options.command === 'session') {
      if (options.action === 'start') result = await startSession(options);
      else {
        const current = await existingSession(options.dataDir);
        result = current ? (options.action === 'stop' ? await stopSession(options) : current) : {running:false,status:'not_running'};
      }
    } else if (options.command === 'inventory' && options.action === 'report') result = await reportInventory(options);
    else result = await sessionRequest(options.dataDir,{group:options.command,action:options.action,params:options.params,options:sessionOptions(options)},{signal:options.signal});
    printInteractive(result,options);
    return controller.signal.aborted ? 130 : 0;
  } catch (error) {
    const code = controller.signal.aborted ? 130 : error instanceof UsageError || error.code === 'EEXIST' ? 2 : 1;
    const message = error.code === 'EEXIST' ? '配置文件已存在，请编辑它或用 --config 指定新文件' : error.message;
    if (options?.json || argv.includes('--json')) console.log(JSON.stringify({type:'error',error:message,exitCode:code}));
    else console.error(`错误：${message}`);
    return code;
  } finally {
    process.removeListener('SIGINT',interrupt); process.removeListener('SIGTERM',interrupt);
  }
}

function printInteractive(result,options) {
  if (options.json) { console.log(JSON.stringify(result)); return; }
  if (result.filename) console.log(`已保存：${result.filename}`);
  if (result.jsonPath) console.log(`盘点：${result.jsonPath}\n${result.markdownPath}`);
  const snapshot = result.snapshot ?? (result.snapshotId ? result : null);
  if (snapshot) {
    console.log(`快照 ${snapshot.snapshotId} | ${snapshot.tab} | ${snapshot.state}\n${snapshot.title}\n${snapshot.url}`);
    for (const element of snapshot.elements) console.log(`${element.ref}\t${element.frame}\t${element.tag}${element.type?`:${element.type}`:''}\t${element.disabled?'[禁用] ':''}${element.name}${element.value!==undefined?` = ${element.value}`:''}`);
    if (snapshot.truncated) console.log('元素清单已截断，可提高 --limit 或切换页面状态后重新查看。');
  } else if (!result.filename && !result.jsonPath) console.log(JSON.stringify(result,null,2));
}
