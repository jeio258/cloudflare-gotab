// 性能基线测试：桌面冷 / 移动冷（Lighthouse，各 2 轮取中位数）+ 热缓存回访（Playwright 双载）
// 用法：
//   node tests/perf/run-perf.mjs [--url=<https://tab.kfkf.asia/>] [--ci] [--update-baseline]
//   --ci            任一项低于基线阈值(默认-5)则非零退出（防回归门槛）
//   --update-baseline 以本次结果覆盖 baseline.json
// 说明：Lighthouse 默认禁缓存模拟首访，单轮噪声大（实测同配置 60↔44），故各档跑 2 轮取中位数。
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../lib/chrome.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const reportsDir = join(root, 'tests', 'perf', 'reports');
const baselinePath = join(root, 'tests', 'perf', 'baseline.json');
const TOLERANCE = 5; // --ci 模式下允许的得分下降容忍

const args = process.argv.slice(2);
const URL_ = (args.find((a) => a.startsWith('--url=')) || '').split('=')[1] || 'https://tab.kfkf.asia/';
const ci = args.includes('--ci');
const updateBaseline = args.includes('--update-baseline');
process.env.GOTAB_CDP_PORT = process.env.GOTAB_CDP_PORT || '9333';
const port = process.env.GOTAB_CDP_PORT;

const log = (...a) => console.log(...a);

function lighthouseRun(preset) {
  const out = `/tmp/lh-perf-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  const extra = preset === 'desktop' ? ['--preset=desktop'] : [];
  const r = spawnSync(
    'npx',
    ['-y', 'lighthouse', URL_, '--only-categories=performance', ...extra, '--output=json', `--output-path=${out}`, '--quiet', `--port=${port}`],
    { stdio: 'pipe', timeout: 300_000, encoding: 'utf8' }
  );
  if (!existsSync(out)) throw new Error(`lighthouse(${preset}) 无输出: ${String(r.stderr || r.stdout).slice(-300)}`);
  const d = JSON.parse(readFileSync(out, 'utf8'));
  const a = d.audits;
  const mv = (id) => {
    const x = a[id];
    return x ? x.numericValue ?? x.displayValue : null;
  };
  const row = {
    score: Math.round(d.categories.performance.score * 100),
    fcp: mv('first-contentful-paint'),
    lcp: mv('largest-contentful-paint'),
    tbt: mv('total-blocking-time'),
    si: mv('speed-index'),
    ttfb: mv('server-response-time'),
  };
  row.transferKB = Math.round(a['network-requests'].details.items.reduce((s, x) => s + (x.transferSize || 0), 0) / 1024);
  return row;
}

function median(vals) {
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function mergeMedian(rows) {
  return {
    score: median(rows.map((r) => r.score)),
    fcp: median(rows.map((r) => r.fcp)),
    lcp: median(rows.map((r) => r.lcp)),
    tbt: median(rows.map((r) => r.tbt)),
    si: median(rows.map((r) => r.si)),
    ttfb: median(rows.map((r) => r.ttfb)),
    transferKB: median(rows.map((r) => r.transferKB)),
  };
}

// 热缓存回访：先冷载填充缓存，再热载测真实指标
async function warmRound() {
  const { newPage, close } = await launchBrowser();
  const page = await newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    window.__perf = { lcp: 0 };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (e.entryType === 'largest-contentful-paint') window.__perf.lcp = e.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {}
  });
  const load = async () => {
    const t0 = Date.now();
    await page.goto(URL_, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2500);
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0] || {};
      return { ttfb: Math.round(n.responseStart || 0), transfer: n.transferSize || 0 };
    });
    const res = await page.evaluate(() =>
      performance.getEntriesByType('resource')
        .filter((e) => e.name.startsWith(location.origin))
        .reduce((s, e) => s + e.transferSize, 0)
    );
    const perf = await page.evaluate(() => window.__perf || {});
    return { wall: Date.now() - t0, ttfb: nav.ttfb, transferKB: Math.round((nav.transfer + res) / 1024), lcp: Math.round(perf.lcp) };
  };
  await load(); // 填充缓存
  await page.waitForTimeout(1000);
  const warm = await load();
  await close();
  return warm;
}

mkdirSync(reportsDir, { recursive: true });
const report = { url: URL_, at: new Date().toISOString(), tiers: {} };
log(`\n=== 性能基线测试 ${URL_} ===`);

log('· 桌面冷缓存 ×2（Lighthouse desktop）…');
report.tiers.desktop = mergeMedian([lighthouseRun('desktop'), lighthouseRun('desktop')]);
log('· 移动冷缓存 ×2（Lighthouse mobile）…');
report.tiers.mobile = mergeMedian([lighthouseRun('mobile'), lighthouseRun('mobile')]);
log('· 热缓存回访（Playwright 双载）…');
report.tiers.warm = await warmRound();

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
writeFileSync(join(reportsDir, `report-${stamp}.json`), JSON.stringify(report, null, 2));
log(`\n报告已存 tests/perf/reports/report-${stamp}.json`);

// 输出对照
const base = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;
const fmt = (tier, k) => {
  const v = report.tiers[tier][k];
  if (k === 'score') return `${v}${base ? ` (基线 ${base.tiers[tier]?.score})` : ''}`;
  return typeof v === 'number' ? `${Math.round(v)}${k.includes('KB') || k === 'ttfb' ? '' : 'ms'}` : v;
};
log('\n--- 桌面冷 ---  score fcp lcp tbt si ttfb transferKB');
log(`  ${fmt('desktop', 'score')}  ${fmt('desktop', 'fcp')} ${fmt('desktop', 'lcp')} ${fmt('desktop', 'tbt')} ${fmt('desktop', 'si')} ${fmt('desktop', 'ttfb')} ${fmt('desktop', 'transferKB')}`);
log('--- 移动冷 ---');
log(`  ${fmt('mobile', 'score')}  ${fmt('mobile', 'fcp')} ${fmt('mobile', 'lcp')} ${fmt('mobile', 'tbt')} ${fmt('mobile', 'si')} ${fmt('mobile', 'ttfb')} ${fmt('mobile', 'transferKB')}`);
log(`--- 热回访 ---  LCP ${fmt('warm', 'lcp')}ms  TTFB ${fmt('warm', 'ttfb')}ms  传输 ${fmt('warm', 'transferKB')}KB`);

if (updateBaseline) {
  writeFileSync(baselinePath, JSON.stringify({ url: URL_, at: report.at, tiers: report.tiers }, null, 2));
  log('\n基线已更新 baseline.json');
}
if (ci && base) {
  const bad = [];
  for (const tier of ['desktop', 'mobile']) {
    const drop = base.tiers[tier]?.score - report.tiers[tier].score;
    if (drop > TOLERANCE) bad.push(`${tier} ${base.tiers[tier].score}→${report.tiers[tier].score}（-${drop}）`);
  }
  if (report.tiers.warm.lcp > (base.tiers.warm?.lcp || 0) * 1.5) bad.push(`warm LCP 劣化 ${base.tiers.warm.lcp}→${report.tiers.warm.lcp}ms`);
  if (bad.length) { log(`\n[CI] 回归: ${bad.join('；')}`); process.exit(1); }
  log('\n[CI] 通过（无超过容忍度的回归）');
}
