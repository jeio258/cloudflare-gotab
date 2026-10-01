// 找回密码表单适配 headless 验证：注入「原密码」输入并随请求提交
import { chromium, request as playwrightRequest } from 'playwright';
import { spawn } from 'node:child_process';

const base = process.env.GOTAB_BASE_URL || 'http://127.0.0.1:8799';
// 复用本机已装的 Chrome（WSL 下指向 Windows 侧可执行文件）；Windows Chrome 不支持 stdio 调试管道，改用 CDP 端口连接
const CHROME = process.env.GOTAB_CHROME_PATH || '/mnt/d/Chrome/App/chrome.exe';
// browser.close() 对 CDP 连接仅断开不杀进程：残留标签页里的 SPA 会持续回写 localStorage，必须先关页
async function closeStalePages(browser) {
  const ctx = browser.contexts()[0];
  if (ctx) for (const p of ctx.pages()) await p.close().catch(() => {});
}
async function launchBrowser() {
  // Windows 防火墙仅放行了固定 CDP 端口（GOTAB_CDP_PORT，默认 9333）
  const port = Number(process.env.GOTAB_CDP_PORT) || 9333;
  // 若已有实例占用该端口则直接复用
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
  const proc = spawn(
    CHROME,
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/cdp-probe`, '--no-first-run', 'about:blank'],
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
const failures = [];
const log = (...a) => console.log(...a);
const check = (name, ok) => { log((ok ? '[OK] ' : '[FAIL] ') + name); if (!ok) failures.push(name); };

const api = await playwrightRequest.newContext();
const uname = 'fp' + (Date.now() % 1000000);
const email = uname + '@test.local';
const oldPw = 'orig123456';
{
  const r = await api.post(base + '/api/register', {
    data: { username: uname, password: oldPw, email },
  });
  const b = await r.json().catch(() => null);
  check('注册一次性用户 ' + uname, b?.code === 200);
}

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
// 共享 CDP profile 下 IndexedDB 初始化失败属环境噪音（Windows Chrome+WSL 路径），前端已降级处理
const isEnvNoise = (t) => t.includes('IndexedDB 初始化失败');
page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error' && !isEnvNoise(m.text())) consoleErrors.push(m.text().slice(0, 200)); });

let capturedBody = null;
page.on('request', (req) => {
  if (req.url().includes('/api/findPassword') && req.method() === 'POST') capturedBody = req.postData();
});

await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
// SPA 会在 unload 时把内存态回写存储，同页清空会被覆盖；先离开页面再经 CDP 清存储
await page.goto('about:blank');
await page.waitForTimeout(500);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Storage.clearDataForOrigin', { origin: new URL(base).origin, storageTypes: 'all' });
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(5000);

await page.locator('.ant-avatar').first().click({ force: true }).catch(() => {});
await page.waitForTimeout(1200);
await page.getByText('登录/注册').first().click({ force: true }).catch(() => {});
await page.waitForTimeout(1500);
await page.getByText('找回密码').first().click({ force: true }).catch(() => {});
await page.waitForTimeout(1500);

let hasField = false;
for (let i = 0; i < 12; i++) {
  hasField = (await page.locator('#gotab-oldPassword').count()) > 0;
  if (hasField) break;
  await page.waitForTimeout(300);
}
check('找回表单出现注入的原密码输入', hasField);
await page.screenshot({ path: '/tmp/findpassword-form.png', timeout: 8000 }).catch(() => {});

// 验证码字段已被 overrides 隐藏并自动填充，无需手动输入
const codeItemVisible = await page
  .locator('#findPassword-form_emailCode')
  .evaluate((el) => {
    const item = el.closest('.ant-form-item');
    return item ? getComputedStyle(item).display !== 'none' : true;
  })
  .catch(() => null);
check('验证码表单项已隐藏', codeItemVisible === false);
const codeAutoFilled = await page.inputValue('#findPassword-form_emailCode').catch(() => '');
check('验证码已自动填充', codeAutoFilled === '000000');

if (hasField) {
  await page.fill('#findPassword-form_username', uname);
  await page.fill('#findPassword-form_email', email);
  await page.fill('#gotab-oldPassword', oldPw);
  await page.fill('#findPassword-form_newPassword', 'newpass9');
  await page.fill('#findPassword-form_confirmPassword', 'newpass9');

  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/findPassword') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null),
    page.getByRole('button', { name: '找回密码' }).click({ force: true }).catch(() => {}),
  ]);
  const body = resp ? await resp.json().catch(() => null) : null;
  log('captured request body: ' + capturedBody);
  log('response: ' + JSON.stringify(body));

  check('请求体包含 oldPassword', !!capturedBody && capturedBody.includes('oldPassword'));
  check('请求体 oldPassword 值正确', !!capturedBody && capturedBody.includes(oldPw));
  check('找回密码提交成功 code=200', body?.code === 200);
  check('请求体含自动填充的验证码(后端忽略)', !!capturedBody && capturedBody.includes('000000'));

  const lr = await api.post(base + '/api/login', { data: { username: uname, password: 'newpass9' } });
  const lb = await lr.json().catch(() => null);
  check('重置后新密码可登录', lb?.code === 200);
}

check('无 console 报错', consoleErrors.length === 0);
if (consoleErrors.length) log('console errors: ' + JSON.stringify(consoleErrors.slice(0, 5)));

await browser.close();
await api.dispose();
log(failures.length ? ('FAILURES: ' + failures.join(', ')) : 'ALL PASSED');
process.exit(failures.length ? 1 : 0);
