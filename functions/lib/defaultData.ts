import type { Env } from './http';
import { currentUpsert, disableAll, enableOne } from './snapshot';

interface SnapshotRow {
  id: string;
  data: string;
  enabled: number;
  created_by: string;
  created_at: string;
}

const writeCurrent = (env: Env, data: string, createdAt: string) =>
  currentUpsert(env.DB, data, createdAt).run();

// 将指定历史快照设为唯一启用，并同步为当前默认主页
export const applySnapshot = async (env: Env, id: string): Promise<boolean> => {
  const row = await env.DB.prepare('select * from default_data_history where id = ?').bind(id).first<SnapshotRow>();
  if (!row) return false;
  await env.DB.batch([
    disableAll(env.DB, 'default_data_history', 'enabled'),
    enableOne(env.DB, 'default_data_history', 'enabled', id),
    currentUpsert(env.DB, row.data, row.created_at),
  ]);
  return true;
};

// 依据历史中唯一启用项重算当前默认主页；无启用项则清除
export const syncCurrent = async (env: Env) => {
  const row = await env.DB.prepare(
    'select data, created_at from default_data_history where enabled = 1 order by created_at desc, id desc limit 1'
  ).first<{ data: string; created_at: string }>();
  if (row) await writeCurrent(env, row.data, row.created_at);
  else await env.DB.prepare('delete from default_data where id = 1').run();
};
