// 移动端回归测试（headless）：多视口断言无横向溢出 / 关键元素可见 / 零 console 报错 / 零失败请求。
// 需本地 wrangler pages dev 已起在 baseUrl（GOTAB_BASE_URL 可覆盖，默认 127.0.0.1:8799）。
import { chromium } from 'playwright';
import { detectChrome } from './lib/chrome.mjs';

const base = process.env.GOTAB_BASE_URL || 'http://127.0.0.1:8799';
const VIEWPORTS = [
  { name: 'iPhone 12 390x844', width: 390, height: 844 },
  { name: 'Android 360x640', width: 360, height: 640 },
];
const failures = [];
const log = (...a) => console.log(...a);
const check = (name, ok) => {
  log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({ headless: true, executablePath: detectChrome(), args: ['--no-sandbox'] });
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  const bad = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('IndexedDB 初始化失败')) errs.push(m.text().slice(0, 120)); });
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(0, 70)}`); });

  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(6000);
  for (let i = 0; i < 5; i++) { const c = page.locator('.ant-notification-notice-close').first(); if (!(await c.count())) break; await c.click({ force: true }).catch(() => {}); await page.waitForTimeout(500); }
  await page.waitForTimeout(800);

  const info = await page.evaluate(() => ({
    vw: window.innerWidth,
    docScrollW: document.documentElement.scrollWidth,
    hasViewportMeta: !!document.querySelector('meta[name="viewport"]'),
    rootChildren: document.getElementById('root')?.children.length || 0,
    avatarVisible: !!document.querySelector('.ant-avatar')?.offsetParent,
    // 触控热区：overrides.css 的 coarse 规则把图标按钮扩到 44px（防回归）
    iconBtns: [...document.querySelectorAll('.ant-btn:has(.anticon)')]
      .filter((b) => b.offsetParent)
      .map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }),
  }));

  log(`\n===== ${vp.name} =====`);
  check(`${vp.name} 视口生效(innerWidth=${vp.width})`, info.vw === vp.width);
  check(`${vp.name} 无横向溢出(docScrollW=${info.docScrollW})`, info.docScrollW <= info.vw + 1);
  check(`${vp.name} viewport meta 存在`, info.hasViewportMeta);
  check(`${vp.name} 已渲染(root children>=1)`, info.rootChildren >= 1);
  check(`${vp.name} 头像可见`, info.avatarVisible);
  check(`${vp.name} 图标按钮命中区≥44px`, info.iconBtns.length > 0 && info.iconBtns.every(([w, h]) => w >= 44 && h >= 44));
  check(`${vp.name} 零 console 报错`, errs.length === 0);
  check(`${vp.name} 零失败请求(>=400)`, bad.length === 0);
  if (errs.length) log('  console:', JSON.stringify([...new Set(errs)].slice(0, 5)));
  if (bad.length) log('  失败请求:', JSON.stringify([...new Set(bad)].slice(0, 5)));
  await ctx.close();
}
await browser.close();
console.log(failures.length === 0 ? '\nALL PASSED' : `\nFAILURES: ${failures.length} ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
