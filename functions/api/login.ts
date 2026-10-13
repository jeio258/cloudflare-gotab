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
    // 形状校验通过才计费：垃圾请求不消耗配额，真实爆破尝试仍被计数
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

// 204 不得携带 body（此前 json(204,null) 违反协议，浏览器会丢弃）
export const onRequestOptions = () => new Response(null, { status: 204 });
