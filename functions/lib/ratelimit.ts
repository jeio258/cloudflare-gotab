import { ApiError } from './http';

// isolate 内存固定窗口限流：按 路由+IP 计数，超限走业务契约 429（HTTP 200 + code 429）
// 调用点约定：参数形状校验通过之后、昂贵操作（DB/密码校验）之前调用；垃圾请求不消耗配额，真实爆破仍被计数
// CF 多 isolate 时阈值近似放大、冷重启清零——用于防爆破，非精确计量；生产精确兜底见 README §9 WAF 建议
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;

const hits = new Map<string, { count: number; resetAt: number }>();

export function enforceRateLimit(request: Request, route: string) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const key = `${route}:${ip}`;
  const now = Date.now();
  const slot = hits.get(key);
  if (!slot || slot.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else if (++slot.count > MAX_REQUESTS) {
    throw new ApiError(429, '操作过于频繁，请稍后再试');
  }
  // 防 Map 无限增长：超阈值时顺手清理过期项
  if (hits.size > 1000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
}
