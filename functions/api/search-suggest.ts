import { defineHandler } from '../lib/handler';
import { enforceRateLimit } from '../lib/ratelimit';
import { fetchJson, UA } from '../lib/upstream';

// JSONP 同源代理：搜索联想转百度 sugrec，返回 cb({g:[{q}]})
export const onRequestGet = defineHandler({
  run: async ({ request }) => {
    const url = new URL(request.url);
    const wd = (url.searchParams.get('wd') || '').trim();
    const cb = (url.searchParams.get('cb') || 'cb').replace(/[^A-Za-z0-9_$.]/g, '');

    // 无鉴权代理易被当作百度转发器滥用：阈值放宽到 120/60s/IP（联想随键入高频触发，不能按默认 20 误伤正常输入）。
    // 超限必须优雅降级为空联想——JSONP 契约要求始终 200，抛出会被 handler 变成 JSON 错误体、破坏前端 cb 解析
    let limited = false;
    try {
      enforceRateLimit(request, 'search-suggest', 120);
    } catch {
      limited = true;
    }

    let g: Array<{ q: string }> = [];
    if (wd && !limited) {
      try {
        const j = (await fetchJson(`https://www.baidu.com/sugrec?prod=pc&from=pc_web&wd=${encodeURIComponent(wd)}`, {
          headers: { 'user-agent': UA, referer: 'https://www.baidu.com/' },
        })) as { g?: Array<{ q?: string }> };
        if (Array.isArray(j?.g)) {
          g = j.g.map((x) => ({ q: String(x?.q || '') })).filter((x) => x.q);
        }
      } catch {
        /* 联想失败返回空 */
      }
    }
    return new Response(`${cb}(${JSON.stringify({ g })})`, {
      headers: {
        'content-type': 'application/javascript;charset=utf-8',
        'cache-control': 'no-store',
        // 降解可观测（便于排查/验证；前端不依赖）
        ...(limited ? { 'x-suggest-limited': '1' } : {}),
      },
    });
  },
});
