import { assertNotSelf } from '../../lib/console';
import { defineHandler } from '../../lib/handler';
import { ApiError } from '../../lib/http';

export const onRequestPost = defineHandler({
  auth: 'admin',
  body: true,
  msg: '已更新',
  run: async ({ env, admin, body }) => {
    const userId = String(body.userId || body.id || '');
    const type = Number(body.type ?? -1);
    if (!userId || (type !== 0 && type !== 1)) throw new ApiError(400, '参数错误');
    assertNotSelf(admin, userId, '不能修改自己的管理员身份');
    await env.DB.prepare('update users set user_type = ? where id = ?').bind(type, userId).run();
    return null;
  },
});
