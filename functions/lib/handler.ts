import { authUser, requireAdmin } from './auth';
import type { UserRow } from './db';
import { ApiError, fail, json, ok } from './http';
import type { Env } from './http';
import type { JsonObject } from './types';

export interface RouteContext {
  env: Env;
  request: Request;
  /** auth:'user'|'admin' 时已解析的当前用户，否则 null */
  user: UserRow | null;
  /** auth:'admin' 时的当前管理员（与 user 同一对象），否则 null */
  admin: UserRow | null;
  /** body:true|'optional' 时已解析的请求体，否则空对象 */
  body: JsonObject;
}

export interface HandlerOptions {
  /** 鉴权级别：admin=管理员，user=任意登录用户 */
  auth?: 'user' | 'admin';
  /** true=严格解析（非 JSON/非对象 → 400）；'optional'=尽力解析（失败视为空体） */
  body?: true | 'optional';
  /** 成功响应 msg（默认 'ok'） */
  msg?: string;
  /** 业务逻辑：返回 data 载荷；可 throw ApiError；返回 Response 则原样透传 */
  run: (ctx: RouteContext) => unknown;
}

type PagesContext = { request: Request; env: Env };

// 统一请求体上限：防超大 JSON 滥用（各端点另有更严业务限额，如 push/setDefaultData 262144）
const MAX_BODY_BYTES = 1_000_000;

// 统一入口：鉴权 → body 解析 → run → ok 包装；业务错误经 ApiError 按既有契约映射
export function defineHandler(opts: HandlerOptions) {
  return async function handler(context: PagesContext): Promise<Response> {
    try {
      const { env, request } = context;
      let user: UserRow | null = null;
      if (opts.auth) {
        user = opts.auth === 'admin' ? await requireAdmin(env, request) : await authUser(env, request);
        if (!user) {
          return opts.auth === 'admin' ? fail(403, '无权限') : fail(401, '登录已失效');
        }
      }

      let body: JsonObject = {};
      if (opts.body) {
        // 请求体门禁：content-length 缺失（chunked）时由各端点自身限额兜底
        const len = Number(request.headers.get('content-length') || 0);
        if (len > MAX_BODY_BYTES) return fail(400, '请求体过大');
        try {
          const parsed: unknown = await request.json();
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body 非对象');
          body = parsed as JsonObject;
        } catch {
          if (opts.body === true) return fail(400, '参数错误');
        }
      }

      const result = await opts.run({ env, request, user, admin: opts.auth === 'admin' ? user : null, body });
      if (result instanceof Response) return result;
      return ok(result, opts.msg ?? 'ok');
    } catch (e) {
      if (e instanceof ApiError) {
        return e.httpStatus && e.httpStatus !== 200
          ? json(e.httpStatus, { code: e.code, msg: e.message, data: null })
          : fail(e.code, e.message);
      }
      console.error('[handler] unhandled error:', e);
      return fail(500, '服务器内部错误');
    }
  };
}
