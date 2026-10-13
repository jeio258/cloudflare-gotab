import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'web');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(src, dist, { recursive: true });

// 部署瘦身：剔除 Chrome 扩展专属文件与未使用的 install 向导（Pages 运行时不加载）
const EXT_ONLY = [
  'manifest.json',
  'background.js',
  'popup.html',
  'newtab.html',
  '_locales',
  '_metadata',
  'hash-manifest.json',
  'install',
];
for (const f of EXT_ONLY) rmSync(join(dist, f), { recursive: true, force: true });

// 替换 index.html 的 Go 模板占位符
const indexPath = join(dist, 'index.html');
let html = readFileSync(indexPath, 'utf8');
html = html
  .replace('{{ .Title }}', 'Gotab')
  .replace('{{ .Description }}', 'Gotab 新标签页')
  .replace('{{ .Keywords }}', 'gotab,新标签页,导航,起始页');

// siteConfig 单一数据源（functions/lib/siteConfig.json），生成前端 siteConfig.js
const SITE_CONFIG = JSON.parse(readFileSync(join(root, 'functions', 'lib', 'siteConfig.json'), 'utf8'));
const siteConfigJs =
  'globalThis.siteConfig = {\n' +
  Object.entries(SITE_CONFIG)
    .map(([k, v]) => `\t${k}: \`${v}\`,`)
    .join('\n') +
  '\n};\n';
writeFileSync(join(dist, 'siteConfig.js'), siteConfigJs);

// sitemap/robots 域名同源化：替换官方域名，并剔除已剔除的扩展专属页面
// 自定义域为规范域名：CF_PAGES_URL 是 pages.dev 哈希地址，写入 robots/sitemap 会与主域名不一致
const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://tab.kfkf.asia').replace(/\/+$/, '');

const robotsPath = join(dist, 'robots.txt');
if (existsSync(robotsPath)) {
  const robots = readFileSync(robotsPath, 'utf8').replace(
    /^Sitemap:\s*\S+$/m,
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`
  );
  writeFileSync(robotsPath, robots);
}

// 首屏体验：预设背景色 + 预加载默认壁纸，缓解 CSR 首帧白屏
// 背景色为默认壁纸主色调，JS 挂载后壁纸会覆盖，不影响最终视觉
html = html.replace(
  '</title>',
  '</title>\n    <link rel="preload" as="image" href="/images/wallpaper.webp" fetchpriority="high" />'
);
html = html.replace(
  '<meta name="color-scheme" content="light dark">',
  '<meta name="color-scheme" content="light dark">\n    <style>html{background:#12151a}</style>'
);

// 渲染阻塞削减：全局脚本 defer（siteConfig 与 idleCallback 均只设全局/注册回调，文档序保证执行顺序）
html = html.replace(
  '<script type="text/javascript" src="/siteConfig.js"></script>',
  '<script type="text/javascript" src="/siteConfig.js" defer></script>'
);
html = html.replace(
  '<script type="text/javascript" src="/idleCallback.js"></script>',
  '<script type="text/javascript" src="/idleCallback.js" defer></script>'
);

// 渲染阻塞削减：chunk CSS 合并为 1 个请求（引用均为绝对路径/data URI，合并不破坏基址）
const cssSrcs = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map((m) => m[1]);
if (cssSrcs.length >= 2) {
  const mergedCss = cssSrcs.map((href) => readFileSync(join(dist, href.replace(/^\//, '')), 'utf8')).join('\n');
  const mergedName = `main-${createHash('sha1').update(mergedCss).digest('hex').slice(0, 8)}.css`;
  writeFileSync(join(dist, 'assets', mergedName), mergedCss);
  // 整块折叠：连续 stylesheet 链接归并为 1 条（勿逐条替换，否则每条都被替换为合并链接）
  html = html.replace(/(?:<link rel="stylesheet"[^>]*>\s*)+/g, `  <link rel="stylesheet" crossorigin href="/assets/${mergedName}" />\n`);
}

// 死入口清理：注入补丁 JS；补丁 CSS 内联（内容小，免一次渲染阻塞请求）
cpSync(join(root, 'scripts', 'overrides.js'), join(dist, 'overrides.js'));
const overridesCss = readFileSync(join(root, 'scripts', 'overrides.css'), 'utf8');
html = html.replace(
  '</head>',
  '  <style>' + overridesCss + '</style>\n' + '  <script defer src="/overrides.js"></script>\n</head>'
);
writeFileSync(indexPath, html);

// 静态资源长缓存 + 安全响应头
// 静态资源：哈希文件名，内容不变
// 安全头：仅加入零功能风险项；CSP 因前端支持用户自定义图标/壁纸源未启用（见 dev-log 待跟进）
writeFileSync(
  join(dist, '_headers'),
  [
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
    '/images/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: SAMEORIGIN',
    '  Strict-Transport-Security: max-age=31536000',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()',
    // CSP 实用级：拦注入型 XSS；放宽项均有依据（无 eval；样式需 unsafe-inline（React 内联+补丁<style>）；
    // 自定义壁纸/图标走 https: 任意域；iframe 挂件需 frame-src https:；图片 blob 预览；控制台推荐接口 web.gotab.cn）
    '  Content-Security-Policy: default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob: https:; connect-src \'self\' https://web.gotab.cn; font-src \'self\' data:; media-src \'self\' https: blob:; frame-src \'self\' https:; worker-src \'self\' blob:; object-src \'none\'; base-uri \'self\'; frame-ancestors \'self\'; form-action \'self\'',
    '',
  ].join('\n')
);

// 搜索联想同源化：替换前端直连百度 sugrec 的 URL 为 /api/search-suggest
const SUG_SRC = 'https://www.baidu.com/sugrec?prod=pc&from=pc_web&wd=';
const SUG_DST = '/api/search-suggest?wd=';
const mainFiles = readdirSync(join(dist, 'assets')).filter((f) => f.startsWith('main-') && f.endsWith('.js'));
let patched = 0;
for (const f of mainFiles) {
  const p = join(dist, 'assets', f);
  const content = readFileSync(p, 'utf8');
  if (content.includes(SUG_SRC)) {
    writeFileSync(p, content.split(SUG_SRC).join(SUG_DST));
    patched++;
  }
}
if (patched === 0) console.warn('[prepare] 未命中百度联想 URL，请检查前端产物');

// 品牌替换：作者标识（doxwant/dengxiwang）-> 本仓库地址与 GitHub 图标
const REPO_URL = 'https://github.com/jeio258/cloudflare-tab';
const GH_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style="vertical-align:middle" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
const BRAND_MAP = [
  ['https://github.com/dengxiwang/gotab-personal', REPO_URL],
  ['https://github.com/dengxiwang', REPO_URL],
  ['dengxiwang@aliyun.com', REPO_URL],
  ['>@doxwant</a>', `>${GH_ICON}</a>`],
];
let brandPatched = 0;
for (const f of readdirSync(join(dist, 'assets')).filter((x) => x.endsWith('.js'))) {
  const p = join(dist, 'assets', f);
  let c = readFileSync(p, 'utf8');
  let changed = false;
  for (const [from, to] of BRAND_MAP) {
    if (c.includes(from)) {
      c = c.split(from).join(to);
      changed = true;
    }
  }
  if (changed) {
    writeFileSync(p, c);
    brandPatched++;
  }
}
if (brandPatched === 0) console.warn('[prepare] 未命中作者品牌字符串，请检查前端产物');

// sitemap：替换官方域名，剔除扩展专属页面（/newtab、/popup 已不在部署产物中）
const sitemapPath = join(dist, 'sitemap.xml');
if (existsSync(sitemapPath)) {
  let sitemap = readFileSync(sitemapPath, 'utf8');
  sitemap = sitemap
    .replace(/<url>(?:(?!<\/url>)[\s\S])*?<\/url>/g, (block) =>
      /<loc>[^<]*\/(newtab|popup)<\/loc>/.test(block) ? '' : block
    )
    .split('https://web.gotab.cn')
    .join(SITE_ORIGIN);
  writeFileSync(sitemapPath, sitemap);
}

// 拷贝 Pages Functions
cpSync(join(root, 'functions'), join(dist, 'functions'), { recursive: true });

// SPA 回退：未知路径一律落到 index.html
writeFileSync(join(dist, '_redirects'), '/* /index.html 200\n');

console.log(`prepared -> ${dist}`);
