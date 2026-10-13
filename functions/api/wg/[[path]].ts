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
  const resp = await fetch(`${WG_BASE}/${rest}${url.search}`, init);
  return new Response(resp.body, {
    status: resp.status,
    headers: {
      'content-type': resp.headers.get('content-type') || 'application/json',
      // 壁纸/资源列表变更不频繁，5 分钟缓存即可（图片路径同样受益）
      'cache-control': 'public, max-age=300',
    },
  });
}

export const onRequestGet = proxy;
export const onRequestPost = proxy;
