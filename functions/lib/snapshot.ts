// 快照写入的统一出口：体积门禁、单例 upsert、唯一启用开关。
// 这些语义此前散落在 defaultData.ts / setDefaultData.ts / confirmNotice.ts / push.ts 各写一遍，改一处必漏其余。

import { ApiError } from './http';

// 云快照与默认主页共用的上限（UTF-8 字节）。按 UTF-16 length 计数会让纯中文载荷虚增 3 倍。
const MAX_SNAPSHOT_BYTES = 262144;

export function serializeSnapshot(data: unknown): string {
  const json = JSON.stringify(data);
  if (new TextEncoder().encode(json).length > MAX_SNAPSHOT_BYTES) {
    throw new ApiError(400, '数据过大，无法保存');
  }
  return json;
}

// 单例表写入：default_data 恒为 id=1 一行
export const currentUpsert = (db: D1Database, data: string, createdAt: string) =>
  db
    .prepare(
      `insert into default_data (id, data, created_at) values (1, ?, ?)
       on conflict(id) do update set data = excluded.data, created_at = excluded.created_at`
    )
    .bind(data, createdAt);

// 「唯一启用」开关：notices.status 与 default_data_history.enabled 是同一语义，只是列名不同
type ExclusiveTable = 'notices' | 'default_data_history';
type ExclusiveColumn = 'status' | 'enabled';

export const disableAll = (db: D1Database, table: ExclusiveTable, column: ExclusiveColumn) =>
  db.prepare(`update ${table} set ${column} = 0`);

export const enableOne = (db: D1Database, table: ExclusiveTable, column: ExclusiveColumn, id: string) =>
  db.prepare(`update ${table} set ${column} = 1 where id = ?`).bind(id);
