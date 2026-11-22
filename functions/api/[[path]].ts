import { json } from '../lib/http';

// 未实现接口兜底：HTTP 200 + 业务 code，前端按业务错误静默降级。
// /console/* 与 /user/* 下的未知端点属「明确不支持的官方能力」（上传/SMTP/审核/备份等），
// 与拼错路径区分开，便于按日志排查；其余未知路径按普通 404。
const DISABLED_PREFIX = ['/api/console/', '/api/user/'];

async function fallback(context: { request: Request }) {
  const { pathname } = new URL(context.request.url);
  const disabled = DISABLED_PREFIX.some((p) => pathname.startsWith(p));
  return json(200, { code: 404, msg: disabled ? '该功能未启用' : '接口不存在', data: null });
}

export const onRequestGet = fallback;
export const onRequestPost = fallback;
export const onRequestPut = fallback;
export const onRequestDelete = fallback;
export const onRequestOptions = fallback;
