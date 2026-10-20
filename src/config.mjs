import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { assertNavigation } from './browser.mjs';

export class UsageError extends Error {}
const optionNames = {
  config: 'string', output: 'string', 'data-dir': 'string', 'start-url': 'string',
  'action-timeout': 'string', 'download-timeout': 'string',
  json: 'boolean', help: 'boolean', version: 'boolean',
  snapshot: 'string', ref: 'string', target: 'string', value: 'string', key: 'string', url: 'string',
  text: 'string', state: 'string', tab: 'string', x: 'string', y: 'string', file: 'string', label: 'string', limit: 'string',
};
export const UI_ACTIONS = ['snapshot','read','open','click','fill','select','check','uncheck','hover','press','scroll','drag','upload','download','screenshot','tabs','tab','close-tab','back','forward','reload','wait'];
const fields = ['output','dataDir','startUrl','actionTimeout','downloadTimeout'];
const camel = key => key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

export async function loadOptions(argv, cwd = process.cwd()) {
  try {
    const normalized = [];
    for (let index = 0; index < argv.length; index++) {
      if (['--x','--y'].includes(argv[index]) && /^-?\d+(?:\.\d+)?$/.test(argv[index+1] ?? '')) normalized.push(`${argv[index]}=${argv[++index]}`);
      else normalized.push(argv[index]);
    }
    const parsed = parseArgs({ args: normalized, allowPositionals: true, strict: true,
      options: Object.fromEntries(Object.entries(optionNames).map(([key,type]) => [key,{type,...(key==='file'?{multiple:true}:{})}])) });
    const command = parsed.positionals[0] ?? 'help';
    if (!['help','init','login','session','ui','inventory'].includes(command)) throw new Error(`未知命令：${command}`);
    if (parsed.values.help || parsed.values.version || command === 'help') return {command:'help',version:Boolean(parsed.values.version)};
    const grouped = ['session','ui','inventory'].includes(command);
    if (parsed.positionals.length > (grouped ? 2 : 1)) throw new Error('一次只执行一个命令');
    const action = parsed.positionals[1];
    if (grouped && !({session:['start','status','stop'],ui:UI_ACTIONS,inventory:['capture','report']}[command]).includes(action)) throw new Error(`请指定有效的 ${command} 子命令，查看 --help`);
    const configPath = path.resolve(cwd,parsed.values.config ?? 'nint.config.json');
    let config = {};
    try { config = JSON.parse(await readFile(configPath,'utf8')); }
    catch (error) { if (error.code !== 'ENOENT' || (parsed.values.config && command !== 'init')) throw error; }
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('配置文件必须为 JSON 对象');
    const unknown = Object.keys(config).filter(key => ![...fields,'local'].includes(key));
    if (unknown.length) throw new Error(`未知配置字段：${unknown.join(', ')}`);
    if (config.local !== undefined && (!config.local || typeof config.local !== 'object' || Array.isArray(config.local))) throw new Error('local 必须是本地备注对象');
    // Local notes stay in the config file and never enter command or daemon options.
    const configured = Object.fromEntries(fields.filter(key => config[key] !== undefined).map(key => [key,config[key]]));
    const options = {output:path.join(cwd,'output'),dataDir:path.join(cwd,'data'),startUrl:'https://art.nint.com/',actionTimeout:60000,downloadTimeout:60000,...configured};
    for (const key of ['output','dataDir']) {
      if (config[key] !== undefined) {
        if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`${key} 必须是非空路径`);
        options[key] = path.resolve(path.dirname(configPath),config[key]);
      }
    }
    const cli = parsed.values;
    for (const [key,value] of Object.entries(cli)) if (fields.includes(camel(key))) options[camel(key)] = value;
    for (const key of ['output','dataDir']) {
      if (typeof options[key] !== 'string' || !options[key].trim()) throw new Error(`${key} 必须是非空路径`);
      options[key] = path.resolve(cwd,options[key]);
    }
    assertNavigation(options.startUrl);
    if (options.startUrl === 'about:blank') throw new Error('startUrl 必须是情报通网页地址');
    for (const key of ['actionTimeout','downloadTimeout']) {
      options[key] = Number(options[key]);
      if (!Number.isInteger(options[key]) || options[key] < 100 || options[key] > 3600000) throw new Error(`${key} 应为 100—3600000 毫秒`);
    }
    const relative = path.relative(path.join(options.dataDir,'browser-profile'),options.output);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('输出目录不能放在 browser-profile 内');
    const params = {snapshotId:cli.snapshot};
    for (const key of ['ref','target','value','key','url','text','state','tab','x','y','label','limit']) if (cli[key] !== undefined) params[key] = cli[key];
    if (cli.file) params.files = cli.file.map(filename => path.resolve(cwd,filename));
    if (params.state && !['visible','hidden'].includes(params.state)) throw new Error('--state 只支持 visible 或 hidden');
    for (const key of ['x','y','limit']) if (params[key] !== undefined) {
      params[key] = Number(params[key]);
      if (!Number.isFinite(params[key]) || (key==='limit' && (!Number.isInteger(params[key]) || params[key]<1 || params[key]>50000))) throw new Error(`无效的 --${key}`);
    }
    if (command === 'ui') {
      if (['click','fill','select','check','uncheck','hover','press','drag','upload','download'].includes(action) && (!params.snapshotId || !params.ref)) throw new Error(`${action} 需要 --snapshot 与 --ref，先执行 ui snapshot`);
      const required = {open:'url',fill:'value',select:'value',press:'key',drag:'target',wait:'text',tab:'tab'}[action];
      if (required && params[required] === undefined) throw new Error(`${action} 需要 --${required}`);
      if (action === 'upload' && !params.files?.length) throw new Error('upload 需要 --file');
    }
    return {...options,command,action,params,configPath,json:Boolean(cli.json)};
  } catch (error) { throw new UsageError(error.message); }
}
