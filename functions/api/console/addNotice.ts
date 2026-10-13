import { newId } from '../../lib/auth';
import { defineHandler } from '../../lib/handler';
import { ApiError } from '../../lib/http';

export const onRequestPost = defineHandler({
  auth: 'admin',
  body: true,
  msg: '公告已创建，请确认发布',
  run: async ({ env, admin, body }) => {
    const title = String(body.title || '').trim();
    const content = String(body.content || '');
    if (!title) throw new ApiError(400, '标题不能为空');

    await env.DB.prepare(
      'insert into notices (id, title, content, status, time_code, created_by, created_at) values (?, ?, ?, 0, ?, ?, ?)'
    )
      .bind(newId(), title, content, String(Date.now()), admin!.username, new Date().toISOString())
      .run();
    return null;
  },
});
