import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { assertNavigation } from './browser.mjs';

export class UiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function safeUrl(value) {
  try {
    const url = new URL(value);
    if(!['http:','https:','about:'].includes(url.protocol))return `${url.protocol}[omitted]`;
    if (url.username || url.password) { url.username = ''; url.password = ''; }
    for (const key of [...url.searchParams.keys()]) if (/token|password|secret|ticket|session|code|auth/i.test(key)) url.searchParams.set(key, '[redacted]');
    if (/token|password|secret|ticket|session|code|auth/i.test(url.hash)) url.hash = '#[redacted]';
    return url.href;
  } catch { return ''; }
}
export function assertNintUrl(value) {
  assertNavigation(value);
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !/(^|\.)nint\.com$/i.test(url.hostname) || url.username || url.password) {
    throw new UiError('invalid_url', '只允许打开已知情报通 nint.com 页面');
  }
  return url.href;
}

// Runs inside each frame; references point to actual DOM nodes, not a selector that might resolve elsewhere.
function collectFrame({ snapshotId, offset, limit }) {
  const visible = el => [...el.getClientRects()].some(rect=>rect.width>0&&rect.height>0) && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const nodes = [];
  const roots = [document];
  const selector = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[onclick],[tabindex],[contenteditable="true"],[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="radio"],[role="combobox"],[role="menuitem"],[role="slider"],canvas';
  let examined = 0, capped = false;
  for (let index = 0; index < roots.length; index++) {
    for (const el of roots[index].querySelectorAll('*')) {
      if (++examined > 40000) { capped = true; break; }
      if (el.shadowRoot) roots.push(el.shadowRoot);
      const labelledControl=el.matches('input[type="checkbox"],input[type="radio"]')&&[...(el.labels??[])].some(visible);
      if (!visible(el) && el.type !== 'file' && !labelledControl) continue;
      const native = el.matches(selector);
      const pointer = !native && getComputedStyle(el).cursor === 'pointer' && !el.parentElement?.closest(selector) && text(el.innerText).length > 0;
      if (!native && !pointer) continue;
      const explicit = el.getAttribute('aria-label');
      const labelled = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ');
      const labels = el.labels ? [...el.labels].map(label => label.innerText).join(' ') : '';
      const name = text(explicit || labelled || labels || el.getAttribute('placeholder') || el.getAttribute('title') || el.innerText || (['submit','button'].includes(el.type) ? el.value : '') || el.id).slice(0,180);
      const type = el.type ?? '';
      const sensitive = type === 'password' || /password|passwd|token|secret|otp|验证码|账号|用户名|邮箱|手机|账户|登录/i.test(name + el.id + el.getAttribute('name'));
      const fingerprint = () => JSON.stringify([el.tagName, el.id, el.getAttribute('name'), el.getAttribute('role'), el.getAttribute('type'), el.getAttribute('href'), text(el.getAttribute('aria-label')), text(el.innerText).slice(0,300),el.labels?[...el.labels].map(label=>text(label.innerText)).join(' '):'',Boolean(el.disabled)]);
      const actions = ['click', 'hover', 'press', 'read'];
      if (el.matches('input:not([type="file"]):not([type="checkbox"]):not([type="radio"]),textarea,[contenteditable="true"]')) actions.push('fill');
      if (el.matches('select')) actions.push('select');
      if (el.matches('input[type="checkbox"],input[type="radio"],[role="checkbox"],[role="radio"]')) actions.push('check', 'uncheck');
      if (type === 'file') actions.push('upload');
      const ref = `e${offset + nodes.length + 1}`;
      nodes.push({ ref, el, fingerprint: fingerprint(), getFingerprint: fingerprint, sensitive,
        descriptor: { ref, tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), type, name, id: el.id || undefined,
          href: el.matches('a[href]') ? el.href : undefined, disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
          checked: typeof el.checked === 'boolean' ? el.checked : undefined,
          value: sensitive ? '[redacted]' : typeof el.value === 'string' && type !== 'file' ? el.value.slice(0,300) : undefined,
          sensitive, visible: visible(el)||labelledControl, nativeVisible:visible(el), discovery: native ? 'semantic' : 'pointer_hint', actions,
          options: el.matches('select') ? [...el.options].slice(0,200).map(option => ({ label: text(option.text), value: option.value, disabled: option.disabled })) : undefined } });
      if (nodes.length >= limit) { capped = true; break; }
    }
    if (capped) break;
  }
  window.__NINT_CLI_UI__ = { snapshotId, nodes: new Map(nodes.map(item => [item.ref, item])) };
  const body = document.body?.innerText ?? '';
  const password = [...document.querySelectorAll('input[type="password"]')].some(visible);
  const login = password || /扫码登录|账号登录|请先登录/.test(body.slice(0,5000));
  const permission = /暂无权限|权限不足|无权访问|没有访问权限|未开通该功能/.test(body.slice(0,8000));
  const verification = /滑动.{0,8}验证|拖动.{0,8}滑块|请完成.{0,8}验证|安全验证/.test(body.slice(0,8000));
  return { elements: nodes.map(item => item.descriptor), truncated: capped, examined,
    headings: [...document.querySelectorAll('h1,h2,h3,[role="heading"],.breadcrumb')].filter(visible).map(el => text(el.innerText).slice(0,200)).slice(0,40),
    state: verification ? 'verification_required' : login ? 'login_required' : permission ? 'permission_denied' : 'observed',
    tables: [...document.querySelectorAll('table,[role="grid"]')].filter(visible).length,
    dialogs: [...document.querySelectorAll('[role="dialog"],dialog[open],.modal.show')].filter(visible).length };
}

export class UiController {
  constructor(browser) {
    this.browser = browser;
    this.pages = new Map(); this.nextTab = 0; this.latest = null; this.targets = new Map();
    for (const page of browser.context.pages()) this.register(page);
    this.active = this.register(browser.page);
    browser.context.on('page', page => { const id=this.register(page);if(!this.suspendAutoSelect)this.active=id;this.invalidate(); });
    this.actions = [];
  }
  register(page) {
    for (const [id, existing] of this.pages) if (existing === page) return id;
    const id = `t${++this.nextTab}`; this.pages.set(id, page);
    page.on('close', () => { this.pages.delete(id);if(this.active===id)this.active=this.pages.keys().next().value;this.invalidate(); });
    return id;
  }
  get page() {
    const page = this.pages.get(this.active);
    if (!page || page.isClosed()) throw new UiError('tab_closed', '当前标签页已关闭；使用 ui tabs 与 ui tab 选择页面');
    return page;
  }
  invalidate() { this.latest = null; this.targets.clear(); }
  tabs() { return [...this.pages].filter(([,page]) => !page.isClosed()).map(([id,page]) => ({ id, active: id === this.active, url: safeUrl(page.url()) })); }
  async snapshot(limit = 1200) {
    const page = this.page;
    const snapshotId = `s-${randomUUID()}`;
    const elements = [], frames = [], targets = new Map();
    let truncated = false;
    for (const [index, frame] of page.frames().entries()) {
      if (elements.length >= limit) { truncated = true; break; }
      try {
        const result = await frame.evaluate(collectFrame, { snapshotId, offset: elements.length, limit: limit - elements.length });
        for (const element of result.elements) {
          if (element.href) element.href = safeUrl(element.href);
          elements.push({ ...element, frame: `f${index}` });
          targets.set(element.ref, { frame, url: frame.url(), sensitive:element.sensitive });
        }
        frames.push({ id: `f${index}`, url: safeUrl(frame.url()), ...result, elements: undefined });
        truncated ||= result.truncated;
      } catch (error) { frames.push({ id: `f${index}`, url: safeUrl(frame.url()), state: 'unavailable', error: '页面正在跳转或 frame 不可访问' }); }
    }
    const snapshot = { snapshotId, capturedAt: new Date().toISOString(), tab: this.active, url: safeUrl(page.url()),
      title: await page.title().catch(() => ''), state: frames[0]?.state ?? 'unavailable', frames, elements, truncated, tabs: this.tabs() };
    this.latest = { id: snapshotId, page, url: page.url() }; this.targets = targets;
    return snapshot;
  }
  async target(snapshotId, ref) {
    if (!snapshotId || !ref) throw new UiError('missing_reference', '请提供 --snapshot 与 --ref，先运行 ui snapshot');
    const latest = this.latest;
    const target = this.targets.get(ref);
    if (!latest || latest.id !== snapshotId || latest.page !== this.page || latest.url !== this.page.url() || !target || target.frame.isDetached() || target.frame.url() !== target.url) {
      throw new UiError('stale_snapshot', '快照或元素引用已过期，请重新运行 ui snapshot');
    }
    const handle = await target.frame.evaluateHandle(({ snapshotId, ref }) => {
      const state = window.__NINT_CLI_UI__;
      const item = state?.snapshotId === snapshotId ? state.nodes.get(ref) : null;
      if (!item?.el.isConnected || item.fingerprint !== item.getFingerprint()) return null;
      return item.el;
    }, { snapshotId, ref });
    const element = handle.asElement();
    if (!element) { await handle.dispose(); throw new UiError('stale_element', '目标节点已改变，请重新运行 ui snapshot'); }
    return element;
  }
  async execute(action, params = {}, options = {}) {
    const timeout = options.actionTimeout ?? 30000;
    const limit = Math.min(Number(params.limit ?? 1200),5000);
    if (action === 'snapshot') return this.snapshot(limit);
    if (action === 'tabs') return { tabs: this.tabs() };
    if(action==='tab'){
      if(!this.pages.has(params.tab))throw new UiError('unknown_tab','未找到指定专用标签页');
      this.active=params.tab;this.invalidate();return {action,status:'performed',snapshot:await this.snapshot(limit)};
    }
    if(action==='open'&&!this.pages.has(this.active))this.active=this.register(await this.browser.context.newPage());
    const page = this.page;
    if (action === 'read') {
      let element;
      try {
        if (params.ref) element = await this.target(params.snapshotId, params.ref);
        const text = element ? await element.evaluate(el => el.innerText ?? el.textContent ?? '') : await page.locator('body').innerText({ timeout });
        return { tab: this.active, url: safeUrl(page.url()), text: text.slice(0,Number(params.limit ?? 20000)), truncated: text.length > Number(params.limit ?? 20000) };
      } finally { await element?.dispose(); }
    }
    if (action === 'screenshot') {
      const filename = await artifactPath(options.output, 'page', '.png');
      await page.screenshot({ path: filename, fullPage: true, timeout });
      return { filename, snapshot: await this.snapshot(limit) };
    }
    let element, second, result;
    const sensitive=this.targets.get(params.ref)?.sensitive;
    try {
      if (['click','fill','select','check','uncheck','hover','press','drag','upload','download'].includes(action)) element = await this.target(params.snapshotId,params.ref);
      const descriptor = element ? await element.evaluate(el => ({ name: el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText?.slice(0,120) || el.id, tag: el.tagName.toLowerCase() })) : {};
      if (action === 'open') await page.goto(assertNintUrl(params.url), { waitUntil: 'domcontentloaded', timeout });
      else if (action === 'back') await page.goBack({ waitUntil: 'domcontentloaded', timeout });
      else if (action === 'forward') await page.goForward({ waitUntil: 'domcontentloaded', timeout });
      else if (action === 'reload') await page.reload({ waitUntil: 'domcontentloaded', timeout });
      else if (action === 'tab') {
        if (!this.pages.has(params.tab)) throw new UiError('unknown_tab','未找到指定专用标签页');
        this.active = params.tab;
      } else if (action === 'close-tab') {
        const selected = this.pages.get(params.tab ?? this.active);
        if (!selected) throw new UiError('unknown_tab','未找到指定标签页');
        await selected.close();
        if (!this.pages.has(this.active)) this.active = this.pages.keys().next().value ?? this.register(await this.browser.context.newPage());
      } else if (action === 'click' || action === 'hover') {
        const proxy=await element.evaluateHandle(el=>el.matches('input[type="checkbox"],input[type="radio"]')?[...(el.labels??[])].find(label=>[...label.getClientRects()].some(rect=>rect.width>0&&rect.height>0))??null:null);
        try{const target=proxy.asElement()??element;if(action==='click')await target.click({timeout});else await target.hover({timeout});}
        finally{await proxy.dispose();}
      }
      else if (action === 'fill') {
        if (typeof params.value !== 'string') throw new UiError('missing_value','fill 需要 --value');
        await element.fill(params.value,{timeout});
      } else if (action === 'select') {
        if (typeof params.value !== 'string') throw new UiError('missing_value','select 需要 --value');
        await element.selectOption(params.value,{timeout});
      } else if (action === 'check' || action === 'uncheck') {
        const native=await element.evaluate(el=>el.matches('input[type="checkbox"],input[type="radio"]'));
        if(native){
          const desired=action==='check';
          if(await element.isChecked()!==desired){
            const proxy=await element.evaluateHandle(el=>[...(el.labels??[])].find(label=>[...label.getClientRects()].some(rect=>rect.width>0&&rect.height>0))??null);
            try{if(proxy.asElement())await proxy.asElement().click({timeout});else await element.setChecked(desired,{timeout});}
            finally{await proxy.dispose();}
          }
          if(await element.isChecked()!==desired)throw new UiError('check_failed','控件状态读回不一致');
        }
        else{
          const desired=String(action==='check');
          if(await element.getAttribute('aria-checked')!==desired)await element.click({timeout});
          if(await element.getAttribute('aria-checked')!==desired)throw new UiError('check_failed','自定义控件状态读回不一致');
        }
      }
      else if (action === 'press') {
        if (!params.key) throw new UiError('missing_key','press 需要 --key');
        await element.press(params.key,{timeout});
      } else if (action === 'scroll') {
        await page.evaluate(({x,y})=>window.scrollBy(x,y),{x:Number(params.x??0),y:Number(params.y??600)});
      } else if (action === 'wait') {
        if (!params.text) throw new UiError('missing_text','wait 需要 --text');
        await page.getByText(params.text,{exact:false}).first().waitFor({state:params.state??'visible',timeout});
      } else if (action === 'drag') {
        second = await this.target(params.snapshotId,params.target);
        const sourceBox=await element.boundingBox(),targetBox=await second.boundingBox();
        if (!sourceBox || !targetBox) throw new UiError('not_visible','拖拽起点或终点不可见');
        await page.mouse.move(sourceBox.x+sourceBox.width/2,sourceBox.y+sourceBox.height/2);
        await page.mouse.down();
        try { await page.mouse.move(targetBox.x+targetBox.width/2,targetBox.y+targetBox.height/2,{steps:12}); }
        finally { await page.mouse.up(); }
      } else if (action === 'upload') {
        if (!params.files?.length) throw new UiError('missing_file','upload 需要 --file');
        await element.setInputFiles(params.files,{timeout});
      } else if (action === 'download') {
        const pending=page.waitForEvent('download',{timeout:options.downloadTimeout??timeout});
        const [download]=await Promise.all([pending,element.click({timeout})]);
        const extension=path.extname(download.suggestedFilename()).replace(/[^.a-zA-Z0-9]/g,'').slice(0,12) || '.bin';
        const filename=await artifactPath(options.output,'download',extension);
        const temporary=`${filename}.part`;
        try { await download.saveAs(temporary); if (await download.failure()) throw new Error('浏览器下载失败'); await rename(temporary,filename); }
        finally { await unlink(temporary).catch(()=>{}); }
        result={filename,verification:'browser_download_only'};
      } else throw new UiError('unknown_action',`未知 UI 操作：${action}`);
      this.actions.push({ at:new Date().toISOString(), action, url:safeUrl(page.url()), target:descriptor, status:'performed' });
      if (this.actions.length > 500) this.actions.shift();
      this.invalidate();
      return { action, status:'performed', ...result, snapshot:await this.snapshot(limit) };
    } catch(error){this.invalidate();if(sensitive&&action==='fill')throw new UiError('sensitive_action_failed','敏感输入操作失败，请在专用窗口检查输入框');throw error;}
    finally { await element?.dispose(); await second?.dispose(); }
  }
}

async function artifactPath(directory,prefix,extension) {
  await mkdir(directory,{recursive:true});
  return path.join(directory,`${prefix}-${Date.now()}-${randomUUID().slice(0,8)}${extension}`);
}
