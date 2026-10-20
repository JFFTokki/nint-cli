import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { chromium } from 'playwright';

export function assertNavigation(url) {
  if (url === 'about:blank') return;
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || !/(^|\.)nint\.com$/i.test(parsed.hostname) || parsed.username || parsed.password) {
    throw new Error('只允许访问情报通 nint.com 页面');
  }
}

export async function acquireLock(dataDir) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const filename = path.join(dataDir, 'nint-cli.lock');
  const owner = JSON.stringify({ pid: process.pid, host: hostname(), token: randomUUID() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(filename, 'wx', 0o600);
      try { await file.writeFile(owner); } finally { await file.close(); }
      return async () => { if (await readFile(filename, 'utf8').catch(() => '') === owner) await unlink(filename); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const previous = await readFile(filename, 'utf8').catch(() => '');
      let stale = false;
      try {
        const lock = JSON.parse(previous);
        if (lock.host === hostname() && Number.isInteger(lock.pid) && lock.pid > 0) {
          try { process.kill(lock.pid, 0); } catch (cause) { stale = cause.code === 'ESRCH'; }
        }
      } catch { /* Unknown ownership is not permission to remove the lock. */ }
      if (stale && attempt === 0 && await readFile(filename, 'utf8').catch(() => '') === previous) await unlink(filename);
      else throw new Error(`此专用目录正被另一个 CLI 使用，或存在未确认的锁：${filename}`);
    }
  }
  throw new Error('无法获取专用浏览器锁');
}

export async function launchBrowser(options, launcher = chromium.launchPersistentContext.bind(chromium)) {
  const profile = path.join(options.dataDir, 'browser-profile');
  await mkdir(profile, { recursive: true, mode: 0o700 });
  let context;
  try {
    context = await launcher(profile, { channel: 'chrome', headless: false, acceptDownloads: true,
      locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: null,
      args: ['--no-first-run', '--no-default-browser-check'], serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      try { if (route.request().isNavigationRequest()) assertNavigation(route.request().url()); } catch { await route.abort('blockedbyclient'); return; }
      await route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(options.actionTimeout);
    page.setDefaultNavigationTimeout(options.actionTimeout);
    return { context, page };
  } catch (error) {
    await context?.close().catch(() => {});
    throw new Error(`专用 Chrome 启动失败。请确认已安装 Google Chrome，并关闭使用同一 data/browser-profile 的CLI。${error.message}`);
  }
}
