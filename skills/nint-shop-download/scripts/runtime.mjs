import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';

export const scriptDir=path.dirname(fileURLToPath(import.meta.url));
export const project=path.resolve(process.env.NINT_PROJECT||process.cwd());
export const cliPath=[path.join(project,'bin/nint.mjs'),path.join(project,'packages/nint-cli/bin/nint.mjs')].find(file=>fs.existsSync(file));
if(!cliPath)throw Error('设置 NINT_PROJECT 为情报通 CLI 仓库或包含 packages/nint-cli 的工作台目录');
const cliRoot=path.dirname(path.dirname(cliPath));
if(!process.env.NINT_OUTPUT)throw Error('设置 NINT_OUTPUT 为本次运行的独立输出目录');
export const root=path.resolve(process.env.NINT_OUTPUT);
if(root===path.dirname(scriptDir)||root.startsWith(path.dirname(scriptDir)+path.sep))throw Error('业务输出不得放入 skill 目录');
export const config=path.resolve(process.env.NINT_CONFIG||path.join(cliRoot,'nint.config.json'));
export const python=process.env.NINT_PYTHON||'python3';
export const runtimeNode=process.env.NINT_NODE||process.execPath;
export const nodeModules=process.env.NINT_NODE_MODULES;
