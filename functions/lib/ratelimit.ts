import type { Env } from './http';
import { ApiError } from './http';

interface RatelimitBinding {
  limit(o: { key: string }): Promise<{ success: boolean }>;
}

// Cloudflare 原生 Ratelimit binding：按 路由+IP 限流（阈值见 wrangler.toml [[ratelimits]]）
// binding 缺失（如部分 dev 环境）或服务异常时放行，不阻塞正常请求
export async function enforceRateLimit(env: Env, request: Request, route: string) {
  const limiter = env.RATE_LIMITER as RatelimitBinding | undefined;
  if (!limiter?.limit) return;
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  try {
    const { success } = await limiter.limit({ key: `${route}:${ip}` });
    // 契约：HTTP 200 + 业务码 429，前端按业务错误提示
    if (!success) throw new ApiError(429, '操作过于频繁，请稍后再试');
  } catch (e) {
    if (e instanceof ApiError) throw e;
  }
}
