import type { Env } from './http';

interface SnapshotRow {
  id: string;
  data: string;
  enabled: number;
  created_by: string;
  created_at: string;
}

const upsertCurrent = (env: Env, data: string, created_at: string) =>
  env.DB.prepare(
    `insert into default_data (id, data, created_at) values (1, ?, ?)
     on conflict(id) do update set data = excluded.data, created_at = excluded.created_at`
  )
    .bind(data, created_at)
    .run();

// 将指定历史快照设为唯一启用并同步为当前默认主页
export const applySnapshot = async (env: Env, id: string): Promise<boolean> => {
  const row = await env.DB.prepare('select * from default_data_history where id = ?').bind(id).first<SnapshotRow>();
  if (!row) return false;
  await env.DB.batch([
    env.DB.prepare('update default_data_history set enabled = 0'),
    env.DB.prepare('update default_data_history set enabled = 1 where id = ?').bind(id),
    env.DB.prepare(
      `insert into default_data (id, data, created_at) values (1, ?, ?)
       on conflict(id) do update set data = excluded.data, created_at = excluded.created_at`
    ).bind(row.data, row.created_at),
  ]);
  return true;
};

// 依据历史中唯一启用项同步当前默认主页；无启用则清除
export const syncCurrent = async (env: Env) => {
  const row = await env.DB.prepare(
    'select data, created_at from default_data_history where enabled = 1 order by created_at desc, id desc limit 1'
  ).first<{ data: string; created_at: string }>();
  if (row) await upsertCurrent(env, row.data, row.created_at);
  else await env.DB.prepare('delete from default_data where id = 1').run();
};
