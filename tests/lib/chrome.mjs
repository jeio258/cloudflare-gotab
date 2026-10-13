// 测试共享：headless Chrome 启动与 CDP 复用（e2e/findpassword-ui/verify-cleanup 三处共用）
// 浏览器探测优先级：GOTAB_CHROME_PATH > agent-browser 内置 Linux Chrome > 系统 chrome/chromium > Windows Chrome（WSL 兜底）
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

export function detectChrome() {
  const explicit = process.env.GOTAB_CHROME_PATH;
  if (explicit && existsSync(explicit)) return explicit;

  const ab = join(homedir(), '.agent-browser', 'browsers');
  if (existsSync(ab)) {
    const dirs = readdirSync(ab)
      .filter((d) => d.startsWith('chrome-'))
      .sort();
    for (const d of dirs.reverse()) {
      const p = join(ab, d, 'chrome');
      if (existsSync(p)) return p;
    }
  }

  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const r = spawnSync('which', [name], { stdio: 'pipe' });
    const p = String(r.stdout || '').trim();
    if (r.status === 0 && p) return p;
  }

  return '/mnt/d/Chrome/App/chrome.exe';
}

// browser.close() 对 CDP 连接仅断开不杀进程：残留标签页里的 SPA 会持续回写 localStorage，必须先关页
async function closeStalePages(browser) {
  const ctx = browser.contexts()[0];
  if (ctx) for (const p of ctx.pages()) await p.close().catch(() => {});
}

// 启动（或复用已有 CDP 实例）。Windows 防火墙仅放行了固定 CDP 端口（GOTAB_CDP_PORT，默认 9333）
let launchSeq = 0;
export async function launchBrowser() {
  const port = Number(process.env.GOTAB_CDP_PORT) || 9333;
  const CHROME = detectChrome();
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`);
    const j = await r.json();
    const browser = await chromium.connectOverCDP(j.webSocketDebuggerUrl);
    await closeStalePages(browser);
    return {
      browser,
      newPage: async (opts) => (browser.contexts()[0] || (await browser.newContext())).newPage(opts),
      close: async () => {
        await browser.close().catch(() => {});
      },
    };
  } catch {
    /* 未占用，正常启动 */
  }
  const profile = `/tmp/cdp-probe-${process.pid}-${launchSeq++}`;
  const proc = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'],
    { stdio: 'ignore' }
  );
  const ws = await new Promise((resolve, reject) => {
    let tries = 0;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`);
        const j = await r.json();
        clearInterval(t);
        resolve(j.webSocketDebuggerUrl);
      } catch {
        if (++tries > 25) {
          clearInterval(t);
          proc.kill();
          reject(new Error('Chrome CDP 启动超时'));
        }
      }
    }, 300);
  });
  const browser = await chromium.connectOverCDP(ws);
  await closeStalePages(browser);
  return {
    browser,
    newPage: async (opts) => (browser.contexts()[0] || (await browser.newContext())).newPage(opts),
    close: async () => {
      await closeStalePages(browser);
      await browser.close().catch(() => {});
      proc?.kill();
    },
  };
}
