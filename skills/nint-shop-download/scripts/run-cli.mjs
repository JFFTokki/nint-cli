import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
import {root, cliPath, config} from './runtime.mjs';
export {root};
export async function cli(action, params = {}) {
  if (!['snapshot', 'read', 'tables', 'tabs'].includes(action)) await delay(2000 + Math.floor(Math.random() * 3000));
  const args = [cliPath, 'ui', action,
    '--config', config, '--json'];
  for (const [k, v] of Object.entries(params)) args.push(`--${k}`, String(v));
  const at = new Date().toISOString();
  const started=Date.now();
  let result;
  try {
    const commandTimeout = action === 'download' ? Number(params['download-timeout'] ?? 300000) + 30000 :
      ['snapshot', 'read'].includes(action) ? 45000 : Number(params['action-timeout'] ?? 60000) + 15000;
    const { stdout } = await exec(process.execPath, args, { maxBuffer: 20 * 1024 * 1024, timeout: commandTimeout });
    result = JSON.parse(stdout);
  } catch (error) {
    let detail = error.stdout || error.message;
    if (action === 'fill' && params.value) detail = detail.split(String(params.value)).join('[redacted_input]');
    result = { type: 'error', error: detail };
  }
  await fs.mkdir(path.join(root, 'evidence'), { recursive: true });
  const loggedParams = action === 'fill' ? { ...params, value: '[redacted_input]' } : params;
  const snapshot = result.snapshot ?? (result.snapshotId ? result : null);
  const logSnapshot = snapshot ? { ...snapshot, observedElementCount: snapshot.elements.length,
    elements: snapshot.elements.filter(e =>
      (e.tag === 'select') ||
      (e.tag === 'input' && (e.id || e.name)) ||
      (e.tag === 'button' && e.name !== '删除') ||
      e.id || /复制表格|热销品牌数据|热销品牌店铺类型分布|^(行业数据|子行业数据|热销品牌|热销宝贝|月|周)$/.test(e.name)
    ) } : null;
  const loggedResult = result.snapshot ? { ...result, snapshot: logSnapshot } : snapshot ? logSnapshot : result;
  await fs.appendFile(path.join(root, 'evidence/actions.jsonl'), JSON.stringify({ at, durationMs:Date.now()-started, action, params: loggedParams, result: loggedResult }) + '\n');
  if (snapshot) await fs.writeFile(path.join(root, 'evidence/latest-snapshot.json'), JSON.stringify({...snapshot,elements:snapshot.elements.filter(e=>!e.sensitive)}, null, 2));
  if (result.type === 'error') throw new Error(JSON.stringify(result));
  return result;
}
export function compact(result) {
  const s = result.snapshot ?? result;
  if (!s.elements) return result;
  return {
    filename: result.filename, snapshotId: s.snapshotId, url: s.url, state: s.state,
    frames: s.frames,
    elements: s.elements.filter(e => !e.sensitive).map(e => ({
      ref: e.ref, tag: e.tag, type: e.type, name: e.name, id: e.id,
      value: e.value, checked: e.checked, href: e.href, options: e.options
    }))
  };
}
export async function byName(action, name, params = {}, extra = {}, attempt = 0) {
  const s = await cli('snapshot');
  const hits = s.elements.filter(e => e.name === name && Object.entries(extra).every(([k, v]) => e[k] === v));
  if (hits.length !== 1) throw new Error(`Expected one element ${name}, got ${hits.length}`);
  try { return await cli(action, { snapshot: s.snapshotId, ref: hits[0].ref, ...params }); }
  catch(error){if(/快照或元素引用已过期/.test(error.message)&&attempt<2)return byName(action,name,params,extra,attempt+1);throw error;}
}
export async function byId(action, id, params = {}, attempt = 0) {
  const s = await cli('snapshot');
  const hits = s.elements.filter(e => e.id === id);
  if (hits.length !== 1) throw new Error(`Expected one id ${id}, got ${hits.length}`);
  try { return await cli(action, { snapshot: s.snapshotId, ref: hits[0].ref, ...params }); }
  catch(error){if(/快照或元素引用已过期/.test(error.message)&&attempt<2)return byId(action,id,params,attempt+1);throw error;}
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [action = 'snapshot', raw = '{}'] = process.argv.slice(2);
  console.log(JSON.stringify(compact(await cli(action, JSON.parse(raw))), null, 2));
}
