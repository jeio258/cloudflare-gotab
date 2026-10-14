import { json } from '../../lib/http';
import { UA } from '../../lib/upstream';

// 上游同源代理：/api/wg/* → https://web.gotab.cn/*
// 前端产物经 prepare 替换后不再直连上游（资源库/壁纸库 API 与相对图片路径都落在这里），浏览器只见同源
const WG_BASE = 'https://web.gotab.cn';

interface WgContext {
  request: Request;
  params: Record<string, string | string[]>;
}

async function proxy(context: WgContext) {
  const rest = (Array.isArray(context.params.path) ? context.params.path : []).join('/');
  const url = new URL(context.request.url);
  const body = await context.request.arrayBuffer();
  const init: RequestInit = {
    method: context.request.method,
    redirect: 'follow',
    headers: {
      'user-agent': UA,
      accept: 'application/json,text/plain,*/*',
      'content-type': context.request.headers.get('content-type') || 'application/json',
    },
  };
  if (body.byteLength) init.body = body;
  // 上游超时兜底：无此保护时上游挂起会一直占住请求（Pages 侧超时）；异常统一降级为 502
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  let resp: Response;
  try {
    resp = await fetch(`${WG_BASE}/${rest}${url.search}`, { ...init, signal: ctrl.signal });
  } catch {
    return json(502, { code: 502, msg: '上游服务暂不可用', data: null });
  } finally {
    clearTimeout(timer);
  }
  const headers = {
    'content-type': resp.headers.get('content-type') || 'application/json',
    // 壁纸/资源列表变更不频繁，5 分钟缓存即可（图片路径同样受益）
    'cache-control': 'public, max-age=300',
  };
  // 响应体同源化：上游 API 返回的绝对/根相对资源 URL 改走本代理，浏览器零跨域
  // （prepare 只能替换产物字面量，改不到运行时返回的 URL；二进制图片不重写，直接透传流）
  if (/json|text/i.test(headers['content-type'])) {
    const text = await resp.text();
    const rewritten = text
      .split(WG_BASE)
      .join('/api/wg')
      // 根相对资源目录补代理前缀；已是 /api/wg/... 的不受影响
      .replace(/"\/(uploads|sourceStore)\//g, '"/api/wg/$1/');
    return new Response(rewritten, { status: resp.status, headers });
  }
  return new Response(resp.body, { status: resp.status, headers });
}

export const onRequestGet = proxy;
export const onRequestPost = proxy;
