import { createUser } from '../../lib/account';
import { defineHandler } from '../../lib/handler';

export const onRequestPost = defineHandler({
  auth: 'admin',
  body: true,
  msg: '用户已创建',
  run: async ({ env, body }) => {
    await createUser(env, {
      username: String(body.username || ''),
      password: String(body.password || ''),
      nickname: String(body.nickname || ''),
      email: String(body.email || ''),
      phone: String(body.phone || ''),
      sex: Number(body.sex ?? 0),
      userType: Number(body.userType ?? body.user_type ?? 0),
    });
    return null;
  },
});
