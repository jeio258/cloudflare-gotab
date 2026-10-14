import { newId } from '../../lib/auth';
import { defineHandler } from '../../lib/handler';
import { ApiError } from '../../lib/http';

export const onRequestPost = defineHandler({
  auth: 'admin',
  body: true,
  msg: '已保存为默认主页',
  run: async ({ env, admin, body }) => {
    const data = body.data;
    if (data === undefined || data === null) throw new ApiError(400, '参数错误');

    const now = new Date().toISOString();
    const dataJson = JSON.stringify(data);
    // 与 user/push 同口径：按 UTF-8 字节（按 UTF-16 length 会让纯中文虚增 3 倍，放行超限载荷）
    if (new TextEncoder().encode(dataJson).length > 262144) throw new ApiError(400, '数据过大，无法保存');
    const db = env.DB;
    // 原子提交：当前默认主页 + 历史快照（仅最新一条启用）
    await db.batch([
      db
        .prepare(
          `insert into default_data (id, data, created_at) values (1, ?, ?)
           on conflict(id) do update set data = excluded.data, created_at = excluded.created_at`
        )
        .bind(dataJson, now),
      db.prepare('update default_data_history set enabled = 0'),
      db
        .prepare(
          'insert into default_data_history (id, data, enabled, created_by, created_at) values (?, ?, 1, ?, ?)'
        )
        .bind(newId(), dataJson, admin!.username, now),
    ]);
    return null;
  },
});
