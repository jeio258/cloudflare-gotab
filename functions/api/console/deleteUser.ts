import { assertNotSelf } from '../../lib/console';
import { defineHandler } from '../../lib/handler';
import { ApiError } from '../../lib/http';

export const onRequestPost = defineHandler({
  auth: 'admin',
  body: true,
  msg: '用户已删除',
  run: async ({ env, admin, body }) => {
    const userId = String(body.userId || body.id || '');
    if (!userId) throw new ApiError(400, '参数错误');
    assertNotSelf(admin, userId, '不能删除自己的账号');
    // 原子级联清理该用户的云数据与账号
    const db = env.DB;
    await db.batch([
      db.prepare('delete from user_data where user_id = ?').bind(userId),
      db.prepare('delete from users where id = ?').bind(userId),
    ]);
    return null;
  },
});
