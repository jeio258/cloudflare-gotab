import { EMAIL_RE, USERNAME_RE, validPassword } from '../lib/account';
import { hashPassword, newId } from '../lib/auth';
import { getUserByUsername, insertUser } from '../lib/db';
import { defineHandler } from '../lib/handler';
import { ApiError } from '../lib/http';
import { enforceRateLimit } from '../lib/ratelimit';

export const onRequestPost = defineHandler({
  body: true,
  msg: '注册成功，请登录',
  run: async ({ env, request, body }) => {
    await enforceRateLimit(env, request, 'register');
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const email = String(body.email || '').trim();
    if (!USERNAME_RE.test(username)) throw new ApiError(400, '用户名需字母开头、3-20 位字母数字_-');
    if (!validPassword(password)) throw new ApiError(400, '密码长度需在 6-32 位之间');
    if (!EMAIL_RE.test(email)) throw new ApiError(400, '邮箱格式不正确');

    if (await getUserByUsername(env, username)) throw new ApiError(400, '用户名已存在');

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
    return null;
  },
});
