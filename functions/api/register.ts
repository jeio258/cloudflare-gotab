import { EMAIL_RE, USERNAME_RE, validPassword } from '../lib/account';
import { hashPassword, newId } from '../lib/auth';
import { getUserByUsername, insertUser, isUniqueViolation } from '../lib/db';
import { defineHandler } from '../lib/handler';
import { ApiError } from '../lib/http';
import { enforceRateLimit } from '../lib/ratelimit';

export const onRequestPost = defineHandler({
  body: true,
  msg: '注册成功，请登录',
  run: async ({ env, request, body }) => {
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const email = String(body.email || '').trim();
    if (!USERNAME_RE.test(username)) throw new ApiError(400, '用户名需字母开头、3-20 位字母数字_-');
    if (!validPassword(password)) throw new ApiError(400, '密码长度需在 6-32 位之间');
    if (!EMAIL_RE.test(email)) throw new ApiError(400, '邮箱格式不正确');
    // 形状校验通过才计费（同 login 约定）
    enforceRateLimit(request, 'register');
    if (await getUserByUsername(env, username)) throw new ApiError(400, '用户名已存在');

    try {
      await insertUser(env, {
        id: newId(),
        username,
        password: await hashPassword(password),
        nickname: username,
        email,
        phone: '',
        avatar: '',
        sex: 0,
        birthday: '',
        user_type: 0,
        status: 1,
        share_id: newId(),
        share_enabled: 0,
      });
    } catch (e) {
      // 并发同名注册绕过预检会命中 UNIQUE 约束，归为业务错误而非 500
      if (isUniqueViolation(e)) throw new ApiError(400, '用户名已存在');
      throw e;
    }
    return null;
  },
});
