import { newId } from '../../lib/auth';
import { defineHandler } from '../../lib/handler';
import { ApiError } from '../../lib/http';
import { currentUpsert, disableAll, serializeSnapshot } from '../../lib/snapshot';

export const onRequestPost = defineHandler({
  auth: 'admin',
  body: true,
  msg: '已保存为默认主页',
  run: async ({ env, admin, body }) => {
    if (body.data === undefined || body.data === null) throw new ApiError(400, '参数错误');
    const json = serializeSnapshot(body.data);
    const now = new Date().toISOString();
    const db = env.DB;
    // 原子提交：当前默认主页 + 历史快照（仅最新一条启用）
    await db.batch([
      currentUpsert(db, json, now),
      disableAll(db, 'default_data_history', 'enabled'),
      db
        .prepare('insert into default_data_history (id, data, enabled, created_by, created_at) values (?, ?, 1, ?, ?)')
        .bind(newId(), json, admin!.username, now),
    ]);
    return null;
  },
});
