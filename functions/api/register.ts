import { createUser, validateCreateUser } from '../lib/account';
import { defineHandler } from '../lib/handler';
import { enforceRateLimit } from '../lib/ratelimit';

export const onRequestPost = defineHandler({
  body: true,
  msg: '注册成功，请登录',
  run: async ({ env, request, body }) => {
    const input = {
      username: String(body.username || ''),
      password: String(body.password || ''),
      email: String(body.email || ''),
    };
    // 先做形状校验再计费：垃圾请求不消耗限流配额，真实爆破仍被计数
    validateCreateUser(input, { emailRequired: true });
    enforceRateLimit(request, 'register');
    // 公开注册固定为普通用户，忽略客户端传入的 sex/userType
    await createUser(env, input, { emailRequired: true });
    return null;
  },
});
