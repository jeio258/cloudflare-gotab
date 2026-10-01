export type Env = { DB: D1Database; JWT_SECRET?: string; RATE_LIMITER?: unknown };

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json;charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export const ok = (data: unknown, msg = 'ok') => json(200, { code: 200, msg, data });
export const fail = (code: number, msg: string) => json(200, { code, msg, data: null });

// 业务错误：默认映射为 HTTP 200 + {code,msg}（前端契约）；httpStatus 显式指定时使用真实状态码（如 409 冲突）
export class ApiError extends Error {
  constructor(
    readonly code: number,
    msg: string,
    readonly httpStatus?: number
  ) {
    super(msg);
    this.name = 'ApiError';
  }
}
