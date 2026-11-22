import { defineHandler } from '../../lib/handler';
import { ApiError } from '../../lib/http';
import { disableAll, enableOne } from '../../lib/snapshot';

// 二次确认发布：仅保留最新一条启用的公告
export const onRequestPost = defineHandler({
  auth: 'admin',
  body: true,
  msg: '公告已发布',
  run: async ({ env, body }) => {
    const id = String(body.id || '');
    if (!id) throw new ApiError(400, '参数错误');
    const row = await env.DB.prepare('select id from notices where id = ?').bind(id).first<{ id: string }>();
    if (!row) throw new ApiError(400, '公告不存在');
    await env.DB.batch([disableAll(env.DB, 'notices', 'status'), enableOne(env.DB, 'notices', 'status', id)]);
    return null;
  },
});
