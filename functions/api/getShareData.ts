import { getUserData } from '../lib/db';
import type { UserRow } from '../lib/db';
import { defineHandler } from '../lib/handler';
import type { Env } from '../lib/http';

// 分享页契约：data=对象{shareData} 正常；data=数字2 已停止分享；data=数字3 无权限；data=null 视为无效
async function resolve(env: Env, path: string) {
  if (!path) return null;
  // 同一 path 同时命中他人 share_id 与本用户名时优先按 share_id 解析（确定性）
  const user = await env.DB.prepare(
    'select * from users where share_id = ? or username = ? order by (share_id = ?) desc limit 1'
  )
    .bind(path, path, path)
    .first<UserRow>();
  if (!user) return null;
  if (Number(user.status) === 0) return 3;
  if (Number(user.share_enabled) !== 1) return 2;
  const row = await getUserData(env, user.id);
  if (!row) return null;
  try {
    return { shareData: JSON.parse(row.data) };
  } catch {
    return null;
  }
}

const get = defineHandler({
  run: async ({ env, request }) => {
    const url = new URL(request.url);
    return resolve(env, (url.searchParams.get('path') || '').trim());
  },
});

const post = defineHandler({
  body: 'optional',
  run: async ({ env, body }) => resolve(env, String(body?.path || '').trim()),
});

export const onRequestGet = get;
export const onRequestPost = post;
