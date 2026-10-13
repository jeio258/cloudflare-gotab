import { createToken, verifyPassword } from '../lib/auth';
import { toUserInfo } from '../lib/contract';
import { getUserByUsername } from '../lib/db';
import { defineHandler } from '../lib/handler';
import { ApiError } from '../lib/http';
import { enforceRateLimit } from '../lib/ratelimit';

export const onRequestPost = defineHandler({
  body: true,
  run: async ({ env, request, body }) => {
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) throw new ApiError(400, '用户名和密码不能为空');
    // 计数在形状校验后（调用点约定见 lib/ratelimit.ts）
    enforceRateLimit(request, 'login');
    const user = await getUserByUsername(env, username);
    if (!user || !(await verifyPassword(password, user.password))) {
      throw new ApiError(400, '用户名或密码错误');
    }
    if (Number(user.status) === 0) throw new ApiError(403, '账号已被禁用');
    const token = await createToken(env, user.id);
    return { token, userInfo: toUserInfo(user) };
  },
});

// 204 不得携带 body，勿改回带 body 写法（违反 HTTP 协议）
export const onRequestOptions = () => new Response(null, { status: 204 });
