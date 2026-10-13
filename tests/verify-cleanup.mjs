import { launchBrowser } from './lib/chrome.mjs';

const base = process.env.GOTAB_BASE_URL || 'http://127.0.0.1:8799';
const USER = process.env.GOTAB_USER || 'test@gotab.local';
const PASS = process.env.GOTAB_PASS || 'test123456';
const { browser, newPage, close } = await launchBrowser();
const page = await newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });

const log = (...a) => console.log(...a);

log('1) pre-login: open settings drawer & 壁纸主题');
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(6000);
await page.locator('.ant-avatar').first().click();
await page.waitForTimeout(1500);
const wpItem = page.getByText('壁纸主题', { exact: false });
log('壁纸主题 text count (pre-login):', await wpItem.count());
if (await wpItem.count()) {
  await wpItem.first().click({ force: true });
  await page.waitForTimeout(2000);
  const upWall = await page.evaluate(() =>
    [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null && b.textContent.trim() === '上传').length
  );
  log('wallpaper 上传 buttons visible (pre-login):', upWall);
  await page.screenshot({ path: '/tmp/cleanup-wallpaper.png' });
}

log('2) drawer menu items visibility (pre-login)');
// 重新打开 settings (可能因进入壁纸主题后退出了)
const avatar = page.locator('.ant-avatar').first();
const visMenus = await page.evaluate(() =>
  [...document.querySelectorAll('li[role="menuitem"], .ant-menu-item')]
    .filter((e) => e.offsetParent !== null)
    .map((e) => (e.textContent || '').trim())
);
log('VISIBLE drawer menu items:', JSON.stringify(visMenus));

log('3) post-login: open add-card & check 上传 / 推送收录');
// 打开登录抽屉
await avatar.click({ force: true }).catch(() => {});
await page.waitForTimeout(1200);
await page.getByText('登录/注册').first().click().catch(() => {});
await page.waitForTimeout(1500);
await page.locator('#login-form_username').fill(USER);
await page.locator('#login-form_password').fill(PASS);
await Promise.all([
  page.waitForResponse((r) => r.url().endsWith('/api/login') && r.request().method() === 'POST', { timeout: 10000 }),
  page.getByRole('button', { name: '登 录' }).click(),
]);
await page.waitForTimeout(2000);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const addTextCount = await page.getByText('添加卡片').count();
log('添加卡片 text count (post-login):', addTextCount);
await page.getByText('添加卡片').first().click({ force: true });
await page.waitForTimeout(2000);
const uploadCount = await page.evaluate(() =>
  [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null && b.textContent.trim() === '上传').length
);
const pushVisible = await page.evaluate(() =>
  [...document.querySelectorAll('span, button')].filter((b) => b.offsetParent !== null && b.textContent.includes('推送收录')).length
);
log('add-card 上传 buttons visible (post-login):', uploadCount, '| 推送收录 refs visible:', pushVisible);
await page.screenshot({ path: '/tmp/cleanup-addcard.png' });
await close();
