// 端到端 API + UI 测试（headless）。需要本地 wrangler pages dev 已起在 baseUrl。
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
const USER = process.env.GOTAB_USER || 'test@gotab.local';
const PASS = process.env.GOTAB_PASS || 'test123456';
const failures = [];
const log = (...a) => console.log(...a);
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  log(`${ok ? '✓' : '✗'} ${name}: ${ok ? 'pass' : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  if (!ok) failures.push(name);
};

const api = await playwrightRequest.newContext();
const okJson = async (resp) => ({ status: resp.status(), body: await resp.json().catch(() => null) });
// 限流幂等：429 时等待窗口重置(62s)后重试一次，避免连跑 e2e 互撞（配合 20/60s 窗口）
let rateWaitDone = false;
async function loginPost(data) {
  let r = await api.post(`${base}/api/login`, { data });
  let body = await r.json().catch(() => null);
  if (body?.code === 429 && !rateWaitDone) {
    rateWaitDone = true;
    log('(login 429，等待限流窗口重置 62s)');
    await new Promise((res) => setTimeout(res, 62000));
    r = await api.post(`${base}/api/login`, { data });
    body = await r.json().catch(() => null);
  }
  return { r, body };
}
const cleanupUsers = [];

// 1. 静态与兜底
{
  const r = await api.get(`${base}/`);
  const html = await r.text();
  eq('home <title>', html.match(/<title>([^<]*)<\/title>/)?.[1], 'Gotab');
  eq('home http 200', r.status(), 200);
  const m = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
  if (m) {
    const rr = await api.get(base + m[1]);
    eq('asset 200', rr.status(), 200);
  } else failures.push('asset ref not found');
  const r404 = await api.get(`${base}/api/does-not-exist`);
  const { status, body } = await okJson(r404);
  eq('catch-all 200', status, 200);
  eq('catch-all code 404', body?.code, 404);
  // OPTIONS 预检：204 无 body（回归：曾返回 204 带 "null" 体）
  const rOpt = await api.fetch(`${base}/api/login`, { method: 'OPTIONS' });
  const optText = await rOpt.text();
  eq('OPTIONS 204 无 body', rOpt.status() === 204 && optText.length === 0, true);
}

// 2. 登录错误
{
  const { body } = await loginPost({ username: USER, password: 'wrong' });
  eq('wrong pwd code', body?.code, 400);
}

// 2.5 注册(无验证码)/找回/资料编辑
{
  const uname = `u${Date.now() % 1000000}`;
  cleanupUsers.push(uname);
  const email = `${uname}@test.local`;
  // 带任意验证码值也应成功（证明后端不再校验）
  const r0 = await api.post(`${base}/api/register`, {
    data: { username: uname, password: 'pass123', email, emailCode: '000000' },
  });
  const { body: b0 } = await okJson(r0);
  eq('register 成功(任意验证码值)', b0?.code, 200);
  // 无 emailCode 字段同样成功
  const uname2 = `v${Date.now() % 1000000}`;
  cleanupUsers.push(uname2);
  const r1 = await api.post(`${base}/api/register`, {
    data: { username: uname2, password: 'pass123', email: `${uname2}@test.local` },
  });
  const { body: b1 } = await okJson(r1);
  eq('register 成功(无验证码字段)', b1?.code, 200);
  // 重复用户名
  const r2 = await api.post(`${base}/api/register`, {
    data: { username: uname, password: 'pass123', email: `x${email}` },
  });
  const { body: b2 } = await okJson(r2);
  eq('register 重复用户名', b2?.code, 400);
  // 已下线的验证码前置接口走兜底 404
  const rc = await api.post(`${base}/api/emailCode`, { data: { email } });
  const { body: bc } = await okJson(rc);
  eq('emailCode 已下线(兑底404)', bc?.code, 404);
  // 新用户登录(userType=0)
  const { body: b3 } = await loginPost({ username: uname, password: 'pass123' });
  eq('新用户登录 code', b3?.code, 200);
  eq('新用户 userType=0', b3?.data?.userInfo?.userType, 0);
  const ntoken = b3?.data?.token;
  // 资料编辑
  const r4 = await api.post(`${base}/api/user/editUserInfo`, {
    headers: { authorization: ntoken },
    data: { username: uname, nickname: '昵称', sex: 1, phone: '13800138000' },
  });
  const { body: b4 } = await okJson(r4);
  eq('editUserInfo code', b4?.code, 200);
  eq('editUserInfo nickname', b4?.data?.nickname, '昵称');
  eq('editUserInfo sex', b4?.data?.sex, 1);
  // findPassword 找回
  const r6bad = await api.post(`${base}/api/findPassword`, {
    data: { username: uname, email, newPassword: 'newpass1', confirmPassword: 'newpass1' },
  });
  const { body: b6bad } = await okJson(r6bad);
  eq('findPassword 缺原密码被拒', b6bad?.code, 400);
  const r6 = await api.post(`${base}/api/findPassword`, {
    data: { username: uname, email, oldPassword: 'pass123', newPassword: 'newpass1', confirmPassword: 'newpass1' },
  });
  const { body: b6 } = await okJson(r6);
  eq('findPassword 重置成功', b6?.code, 200);
  const { body: b7 } = await loginPost({ username: uname, password: 'newpass1' });
  eq('重置后新密码可登录', b7?.code, 200);
}

// 3. 正确登录 + getUserInfo + 同步 round-trip（对 D1 残留状态鲁棒）
let token = '';
{
  const { body } = await loginPost({ username: USER, password: PASS });
  eq('login code', body?.code, 200);
  token = body?.data?.token;
  eq('login token', typeof token === 'string' && token.length > 20, true);
  eq('userInfo username', body?.data?.userInfo?.username, USER);
}
const authHdr = { authorization: token };
{
  const r1 = await api.get(`${base}/api/user/pullWT`, { headers: authHdr });
  const { body: b1 } = await okJson(r1);
  const baseTs = Number(b1?.data?.timestamp) || 0;
  const stored = b1?.data?.data || null;

  const ts1 = Math.max(Date.now(), baseTs + 1);
  const data1 = { home: { a: 1 }, card: { items: [] } };
  const r2 = await api.post(`${base}/api/user/push`, {
    headers: authHdr,
    data: { data: data1, timestamp: ts1, baseTimestamp: baseTs },
  });
  const { body: b2 } = await okJson(r2);
  eq('push first ts >= ts1', typeof b2?.data?.timestamp === 'number' && b2.data.timestamp >= ts1, true);

  // 数据上限：超大快照被拒绝（P0-4）
  const rBig = await api.post(`${base}/api/user/push`, {
    headers: authHdr,
    data: { data: { blob: 'x'.repeat(300000) }, timestamp: ts1 + 5, baseTimestamp: 0 },
  });
  const { body: bBig } = await okJson(rBig);
  eq('push 超大数据被拒', bBig?.code, 400);

  // UTF-8 字节限额：100K 中文字符=300KB 必须被拒（回归：按 UTF-16 长度旧实现会放行）
  const rZh = await api.post(`${base}/api/user/push`, {
    headers: authHdr,
    data: { data: { blob: '中'.repeat(100000) }, timestamp: ts1 + 6, baseTimestamp: ts1 },
  });
  const { body: bZh } = await okJson(rZh);
  eq('push 中文超字节被拒', bZh?.code, 400);

  // 冲突：baseTimestamp 取一个肯定小于已存的数
  const r3 = await api.post(`${base}/api/user/push`, {
    headers: authHdr,
    data: { data: { ...data1, home: { a: 2 } }, timestamp: ts1 - 10, baseTimestamp: 1 },
  });
  eq('conflict http', r3.status(), 409);
  const b3 = await r3.json();
  eq('conflict code', b3?.code, 409);
  eq('conflict msg', b3?.msg, '云端数据已更新');

  const r4 = await api.get(`${base}/api/user/pullWT`, { headers: authHdr });
  const { body: b4 } = await okJson(r4);
  eq('pull data matches', b4?.data?.data, data1);
  eq('pull ts >= ts1', typeof b4?.data?.timestamp === 'number' && b4.data.timestamp >= ts1, true);

  // 仅打印残留信息便于排查
  if (stored) log(`(注：首次 pullWT 有残留数据 ${JSON.stringify(stored).slice(0, 80)})`);
}

// 4. isAdmin（管理员放行）
{
  const r = await api.get(`${base}/api/user/isAdmin`, { headers: authHdr });
  const { body } = await okJson(r);
  eq('isAdmin code', body?.code, 200);
  eq('isAdmin data', body?.data, true);
}

// 5. 改密码 round-trip
{
  const r1 = await api.post(`${base}/api/user/changePassword`, {
    headers: authHdr,
    data: { oldPassword: PASS, newPassword: 'tmp654321', confirmPassword: 'tmp654321' },
  });
  const { body: b1 } = await okJson(r1);
  eq('changePwd ok', b1?.code, 200);
  const { body: b2 } = await loginPost({ username: USER, password: 'tmp654321' });
  eq('login new pwd', b2?.code, 200);
  const token2 = b2?.data?.token;
  await api.post(`${base}/api/user/changePassword`, {
    headers: { authorization: token2 },
    data: { oldPassword: 'tmp654321', newPassword: PASS, confirmPassword: PASS },
  });
}

// 6. getWebsiteInfo
{
  const r = await api.post(`${base}/api/tools/getWebsiteInfo`, { data: { url: 'https://example.com' } });
  const { body } = await okJson(r);
  eq('getWebsiteInfo code', body?.code, 200);
  eq('getWebsiteInfo title', body?.data?.title, 'Example Domain');
  // 契约：icon 为空串(前端回落内置图标)或真实 URL；退化占位 data:, 已被归一
  eq('getWebsiteInfo icon 合法(空串或 http)',
    typeof body?.data?.icon === 'string' && (body?.data?.icon === '' || /^https?:\/\//.test(body?.data?.icon)), true);
  // 图标退化占位 data:, 必须被归一为空串（回归：透传会导致前端卡片破图）
  eq('getWebsiteInfo icon 非退化占位', body?.data?.icon !== 'data:,', true);
}

// 6.5 挂件接口（游客可调，公共数据）
{
  const r1 = await api.get(`${base}/api/getCityList`);
  const { body: b1 } = await okJson(r1);
  eq('cityList code', b1?.code, 200);
  const hasBeijing = Array.isArray(b1?.data) && b1.data.some((c) => c?.label === '北京' && c?.value === 'beijing');
  eq('cityList 含北京{label,value}', hasBeijing, true);

  const r2 = await api.get(`${base}/api/getWeather?city=beijing`);
  const { body: b2 } = await okJson(r2);
  const w = b2?.data?.data?.weather;
  eq('weather 双层 data.data', b2?.code === 200 && !!w, true);
  eq('weather city', b2?.data?.data?.city, '北京');
  eq('weather temp 为字符串', typeof w?.current_temperature === 'string', true);
  eq('weather icon 为字符串(防0丢失)', typeof w?.weather_icon_id === 'string', true);
  eq('weather forecast>=1', Array.isArray(w?.forecast_list) && w.forecast_list.length >= 1, true);
  eq('weather hourly>=1', Array.isArray(w?.hourly_forecast) && w.hourly_forecast.length >= 1, true);

  for (const type of ['weibo', 'douyin']) {
    const r = await api.get(`${base}/api/getHotEvents?type=${type}`);
    const { body } = await okJson(r);
    eq(`hot[${type}] code200+数组`, body?.code === 200 && Array.isArray(body?.data), true);
    if (Array.isArray(body?.data) && body.data.length) {
      const item = body.data[0];
      eq(`hot[${type}] 条目含 title/url`, typeof item?.title === 'string' && !!item?.url, true);
    } else log(`(注：hot[${type}] 为空，源可能不可达，容忍)`);
  }

  const r3 = await api.get(`${base}/api/yiyan?types=a,b`);
  const { body: b3 } = await okJson(r3);
  eq('yiyan code200', b3?.code, 200);
  eq('yiyan content 非空', typeof b3?.data?.content === 'string' && b3.data.content.length > 0, true);

  // 前端实际为 POST（body 带 types），需保证 POST 也 200（修复 404）
  const r3p = await api.post(`${base}/api/yiyan`, { data: { types: ['a', 'b'] } });
  const { body: b3p } = await okJson(r3p);
  eq('yiyan POST code200', b3p?.code, 200);
  eq('yiyan POST content 非空', typeof b3p?.data?.content === 'string' && b3p.data.content.length > 0, true);

  const r4 = await api.get(`${base}/api/exchange-rate`);
  const { body: b4 } = await okJson(r4);
  const rates = b4?.data?.rates || {};
  eq('fx CNY=1', rates.CNY, 1);
  const need = ['USD', 'EUR', 'GBP', 'JPY', 'HKD', 'AUD', 'CAD', 'CHF', 'NZD'];
  eq('fx 币种齐全', need.every((c) => typeof rates[c] === 'number' && rates[c] > 0), true);
}

// 7. UI 登录流程
{
  const { browser, newPage, close } = await launchBrowser();
  const page = await newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrs = [];
  // 共享 CDP profile 下 IndexedDB 初始化失败属环境噪音（Windows Chrome+WSL 路径），前端已降级处理
  const isEnvNoise = (t) => t.includes('IndexedDB 初始化失败');
  page.on('pageerror', (e) => consoleErrs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !isEnvNoise(m.text())) consoleErrs.push(m.text()); });

  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // SPA 会在 unload 时把内存态回写存储，同页清空会被覆盖；先离开页面再经 CDP 清存储
  await page.goto('about:blank');
  await page.waitForTimeout(500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Storage.clearDataForOrigin', { origin: new URL(base).origin, storageTypes: 'all' });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  // 公告弹层可能异步弹出，循环关闭并等其消失，避免遮挡头像
  for (let i = 0; i < 5; i++) {
    const nc = page.locator('.ant-notification-notice-close').first();
    if (!(await nc.count())) break;
    await nc.click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);
  }
  await page.locator('.ant-notification-notice').first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  await page.locator('.ant-avatar').first().click({ force: true });
  // 等待面板内登录表单出现（游客面板通常直接展开登录视图）
  await page.waitForSelector('#login-form_username', { state: 'visible', timeout: 15000 }).catch(() => {});
  if ((await page.locator('#login-form_username').count()) === 0) {
    const entry = page.getByText('登录/注册').first();
    if (await entry.count()) await entry.click();
    await page.waitForSelector('#login-form_username', { state: 'visible', timeout: 15000 });
  }
  await page.locator('#login-form_username').fill(USER);
  await page.locator('#login-form_password').fill(PASS);
  const [loginResp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/login') && r.request().method() === 'POST', { timeout: 10000 }),
    page.getByRole('button', { name: '登 录' }).click(),
  ]);
  eq('UI login http', loginResp.status(), 200);
  await page.waitForTimeout(1500);
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('persist:user');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  });
  const tok = JSON.parse(stored?.token || '""');
  eq('UI token persisted', typeof tok === 'string' && tok.length > 20, true);
  eq('UI no console errors', consoleErrs.length, 0);
  if (consoleErrs.length) log('UI console errors: ' + JSON.stringify(consoleErrs.slice(0, 5)));
  // Windows Chrome 经 CDP 截图可能因字体加载悬住，限时容忍
  await page.screenshot({ path: '/tmp/gotab-after-login.png', timeout: 8000 }).catch(() => {});
  await close();
}

// 7.1 UI 注册（验证码字段隐藏+自动填充，全链路）
{
  const { browser, newPage, close } = await launchBrowser();
  const page = await newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrs = [];
  const isEnvNoise = (t) => t.includes('IndexedDB 初始化失败');
  page.on('pageerror', (e) => consoleErrs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !isEnvNoise(m.text())) consoleErrs.push(m.text()); });

  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // 注册入口仅游客态可见；同上，先离开页面再经 CDP 清存储
  await page.goto('about:blank');
  await page.waitForTimeout(500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Storage.clearDataForOrigin', { origin: new URL(base).origin, storageTypes: 'all' });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  // 公告弹层循环关闭并等其消失（同上）
  for (let i = 0; i < 5; i++) {
    const nc = page.locator('.ant-notification-notice-close').first();
    if (!(await nc.count())) break;
    await nc.click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);
  }
  await page.locator('.ant-notification-notice').first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  await page.locator('.ant-avatar').first().click({ force: true });
  await page.waitForSelector('#login-form_username', { state: 'visible', timeout: 15000 }).catch(() => {});
  if ((await page.locator('#login-form_username').count()) === 0) {
    const entry = page.getByText('登录/注册').first();
    if (await entry.count()) await entry.click();
    await page.waitForSelector('#login-form_username', { state: 'visible', timeout: 15000 }).catch(() => {});
  }
  await page.getByText('没有账号？立即注册').first().click({ timeout: 15000 });
  await page.waitForSelector('#register-form_username', { state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1500);

  const uname = `ui${Date.now() % 1000000}`;
  cleanupUsers.push(uname);
  await page.locator('#register-form_username').fill(uname);
  await page.locator('#register-form_password').fill('pass123');
  await page.locator('#register-form_email').fill(`${uname}@test.local`);

  // 验证码字段被 overrides 隐藏并自动填充，无需交互
  const codeHidden = await page
    .locator('#register-form_emailCode')
    .evaluate((el) => {
      const item = el.closest('.ant-form-item');
      return item ? getComputedStyle(item).display === 'none' : false;
    })
    .catch(() => false);
  eq('UI 注册验证码字段已隐藏', codeHidden, true);
  const codeVal = await page.inputValue('#register-form_emailCode').catch(() => '');
  eq('UI 注册验证码已自动填充', codeVal, '000000');
  const sendBtn = await page.getByRole('button', { name: '获取验证码' }).count();
  eq('UI 获取验证码按钮已隐藏', sendBtn, 0);

  const [regResp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/register') && r.request().method() === 'POST', { timeout: 10000 }),
    page.getByRole('button', { name: '注 册' }).click(),
  ]);
  const regBody = await regResp.json().catch(() => null);
  eq('UI 注册 code', regBody?.code, 200);
  await page.waitForTimeout(1500);
  // 注册成功后切回登录视图，直接登录新号验证全链路
  await page.locator('#login-form_username').fill(uname);
  await page.locator('#login-form_password').fill('pass123');
  const [loginResp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/login') && r.request().method() === 'POST', { timeout: 10000 }),
    page.getByRole('button', { name: '登 录' }).click(),
  ]);
  eq('UI 注册后登录 http', loginResp.status(), 200);
  await page.waitForTimeout(1500);
  const uiStored = await page.evaluate(() => {
    const raw = localStorage.getItem('persist:user');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  });
  const uiTok = uiStored ? JSON.parse(uiStored?.token || '""') : '';
  eq('UI 注册后登录 token', typeof uiTok === 'string' && uiTok.length > 20, true);
  eq('UI 注册无 console 报错', consoleErrs.length, 0);
  if (consoleErrs.length) log('UI register console errors: ' + JSON.stringify(consoleErrs.slice(0, 5)));
  await page.screenshot({ path: '/tmp/gotab-after-register.png', timeout: 8000 }).catch(() => {});
  await close();
}

// 7.5 公告与默认主页（token=admin）
{
  // 普通用户无权限
  const uname = `n${Date.now() % 1000000}`;
  cleanupUsers.push(uname);
  await api.post(`${base}/api/register`, {
    data: { username: uname, password: 'pass123', email: `${uname}@test.local` },
  });
  const lj = (await loginPost({ username: uname, password: 'pass123' })).body;
  const rn = await api.post(`${base}/api/console/addNotice`, {
    headers: { authorization: lj?.data?.token },
    data: { title: 'x', content: 'y' },
  });
  eq('console 普通用户拒绝', (await okJson(rn)).body?.code, 403);
  const ia = await api.get(`${base}/api/user/isAdmin`, { headers: { authorization: lj?.data?.token } });
  eq('isAdmin 普通用户拒绝', (await okJson(ia)).body?.code, 403);

  // 发布公告（待确认）→ 确认 → 首页可见 → 编辑 → 删除
  const a1 = await api.post(`${base}/api/console/addNotice`, {
    headers: { authorization: token },
    data: { title: '公告标题', content: '公告内容' },
  });
  eq('addNotice code', (await okJson(a1)).body?.code, 200);
  // 请求体门禁：超大 content 直接 400（回归：handler 层统一限额）
  const aBig = await api.post(`${base}/api/console/addNotice`, {
    headers: { authorization: token },
    data: { title: 'big-body-test', content: 'x'.repeat(1200000) },
  });
  eq('addNotice 超大 body 被拒', (await okJson(aBig)).body?.code, 400);
  const l1 = await api.get(`${base}/api/console/getNoticeList`, { headers: { authorization: token } });
  const l1b = (await okJson(l1)).body;
  const noticeId = l1b?.data?.list?.[0]?.id;
  eq('getNoticeList 有记录且带 id', typeof noticeId === 'string', true);
  const c1 = await api.post(`${base}/api/console/confirmNotice`, {
    headers: { authorization: token },
    data: { id: noticeId },
  });
  eq('confirmNotice code', (await okJson(c1)).body?.code, 200);
  const g1 = await api.get(`${base}/api/getNotice`);
  const g1b = (await okJson(g1)).body;
  eq('getNotice 返回最新公告', !!g1b?.data?.title && !!g1b?.data?.content, true);
  const e1 = await api.post(`${base}/api/console/editNotice`, {
    headers: { authorization: token },
    data: { id: noticeId, title: '公告标题2', content: '内容2' },
  });
  eq('editNotice code', (await okJson(e1)).body?.code, 200);
  const d1 = await api.post(`${base}/api/console/deleteNotice`, {
    headers: { authorization: token },
    data: { id: noticeId },
  });
  eq('deleteNotice code', (await okJson(d1)).body?.code, 200);

  // 默认主页
  const payload = { home: { showMode: 'wallpaper' }, card: { listData: [] } };
  const s1 = await api.post(`${base}/api/console/setDefaultData`, {
    headers: { authorization: token },
    data: { data: payload },
  });
  eq('setDefaultData code', (await okJson(s1)).body?.code, 200);
  const t1 = await api.get(`${base}/api/getDefaultDataTime`);
  const t1b = (await okJson(t1)).body;
  eq('getDefaultDataTime 非空 ISO', typeof t1b?.data === 'string' && t1b.data.length > 0, true);
  const gd = await api.get(`${base}/api/getDefaultData`);
  const gdb = (await okJson(gd)).body;
  eq('getDefaultData 回读一致', JSON.stringify(gdb?.data?.data), JSON.stringify(payload));
  eq('getDefaultData 含 created_at', typeof gdb?.data?.created_at === 'string', true);

  // 用户管理（列表/新增/删除）
  const ul = await api.get(`${base}/api/console/getAwaitingApprovalUserAppellationList`, {
    headers: { authorization: token },
  });
  const ulb = (await okJson(ul)).body;
  eq('用户列表非空且含字段', Array.isArray(ulb?.data?.list) && ulb.data.list.length >= 1 && typeof ulb.data.list[0]?.username === 'string', true);
  // pageSize 钳制：超大分页参数不会放大查询
  const ulBig = await api.get(`${base}/api/console/getAwaitingApprovalUserAppellationList?pageSize=999999`, {
    headers: { authorization: token },
  });
  const ulBigb = (await okJson(ulBig)).body;
  eq('pageSize 钳制 ≤100', Array.isArray(ulBigb?.data?.list) && ulBigb.data.list.length <= 100, true);
  const cu = `cu${Date.now() % 1000000}`;
  const cu1 = await api.post(`${base}/api/console/addUser`, {
    headers: { authorization: token },
    data: { username: cu, password: 'pass123', nickname: '后台创建', sex: 0 },
  });
  eq('addUser code', (await okJson(cu1)).body?.code, 200);
  const cuList = await api.get(`${base}/api/console/getAwaitingApprovalUserAppellationList?username=${cu}`, {
    headers: { authorization: token },
  });
  const cuRow = (await okJson(cuList)).body?.data?.list?.[0];
  eq('addUser 列表可见', cuRow?.username === cu && cuRow?.userType === 0, true);
  const st = await api.post(`${base}/api/console/setUserType`, {
    headers: { authorization: token },
    data: { userId: cuRow?.id, type: 1 },
  });
  eq('setUserType 设管理员', (await okJson(st)).body?.code, 200);
  const du = await api.post(`${base}/api/console/deleteUser`, {
    headers: { authorization: token },
    data: { userId: cuRow?.id },
  });
  eq('deleteUser code', (await okJson(du)).body?.code, 200);
  // 默认主页历史列表
  const dhl = await api.get(`${base}/api/console/getDefaultDataList`, { headers: { authorization: token } });
  const dhlb = (await okJson(dhl)).body;
  eq('默认主页历史列表≥1', Array.isArray(dhlb?.data?.list) && dhlb.data.list.length >= 1, true);
}

// 7.6 搜索联想(同源 JSONP)与只读分享页
{
  // API：搜索联想
  const sg = await api.get(`${base}/api/search-suggest?wd=react&cb=cb123`);
  const sgText = await sg.text();
  const sgOk = sg.status() === 200 && sgText.startsWith('cb123(') && sgText.includes('"q"');
  eq('search-suggest JSONP', sgOk, true);
  // 产物已同源化：主 bundle 内不再直连百度 sugrec（新版入口为 index-*.js，静态 import main-*.js）
  {
    const r = await api.get(`${base}/`);
    const html = await r.text();
    const m =
      html.match(/src="(\/assets\/main-[^"]+\.js)"/) ||
      html.match(/src="(\/assets\/index-[^"]+\.js)"/) ||
      html.match(/href="(\/assets\/main-[^"]+\.js)"/);
    if (!m) failures.push('entry asset not found');
    else {
      let entry = await (await api.get(base + m[1])).text();
      // 若入口是 index chunk，跟随其静态 import 找到 main chunk 再校验
      if (!entry.includes('/api/search-suggest?wd=')) {
        const im = entry.match(/main-[A-Za-z0-9._-]+\.js/);
        if (im) entry = await (await api.get(base + '/assets/' + im[0])).text();
      }
      eq('main 已改用 /api/search-suggest', entry.includes('/api/search-suggest?wd='), true);
      eq('main 不含百度直连', !entry.includes('baidu.com/sugrec'), true);
    }
  }
  // 分享页：getShareData(管理员 username 或 share_id) 返回其云数据
  const sh1 = await api.get(`${base}/api/getShareData?path=${encodeURIComponent(USER)}`);
  const sh1b = (await okJson(sh1)).body;
  eq('getShareData 未开启分享返回 2', sh1b?.data, 2);
  const sh2 = await api.get(`${base}/api/getShareData?path=ghost_not_exist`);
  const sh2b = (await okJson(sh2)).body;
  eq('getShareData 未知返回 null', sh2b?.data === null, true);
}

// 7.7 站点配置端点（后台功能开关页依赖，原缺失返回 404）
{
  const r = await api.get(`${base}/api/getSiteConfig`);
  const { status, body } = await okJson(r);
  eq('getSiteConfig http 200', status, 200);
  eq('getSiteConfig code', body?.code, 200);
  eq('getSiteConfig 含 siteConfig', !!body?.data?.siteConfig, true);
  eq('getSiteConfig uploadWallpaper=close', body?.data?.siteConfig?.uploadWallpaper, 'close');
  eq('getSiteConfig cardPush=close', body?.data?.siteConfig?.cardPush, 'close');
}

// 8. 清理测试注册的普通用户（管理员删除）
for (const uname of cleanupUsers) {
  try {
    const r = await api.get(`${base}/api/console/getAwaitingApprovalUserAppellationList?username=${uname}`, {
      headers: { authorization: token },
    });
    const row = (await okJson(r)).body?.data?.list?.[0];
    if (row?.id) {
      await api.post(`${base}/api/console/deleteUser`, {
        headers: { authorization: token },
        data: { userId: row.id },
      });
      log(`cleanup user ${uname}`);
    }
  } catch {
    /* 忽略清理失败 */
  }
}

await api.dispose();
console.log(failures.length === 0 ? '\nALL PASSED' : `\nFAILURES: ${failures.length} ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
