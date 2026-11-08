import type { UserRow } from './db';
import { syncCurrent } from './defaultData';
import { defineHandler } from './handler';
import { ApiError } from './http';

// 后台不得对自身账号执行删除/停用/改权限（否则自锁或失去唯一管理员）
export const assertNotSelf = (admin: UserRow | null, userId: string, msg: string) => {
  if (admin && userId === admin.id) throw new ApiError(400, msg);
};

// 用户启停：仅 status 与提示语不同
export const userStatusHandler = (status: 0 | 1, msg: string) =>
  defineHandler({
    auth: 'admin',
    body: true,
    msg,
    run: async ({ env, admin, body }) => {
      const userId = String(body.userId || body.id || '');
      if (!userId) throw new ApiError(400, '参数错误');
      assertNotSelf(admin, userId, '不能操作自己的账号');
      await env.DB.prepare('update users set status = ? where id = ?').bind(status, userId).run();
      return null;
    },
  });

// 默认主页快照的单行变更（停用/删除）后重算当前默认主页
export const snapshotWrite = (sql: string, msg: string) =>
  defineHandler({
    auth: 'admin',
    body: true,
    msg,
    run: async ({ env, body }) => {
      const id = String(body.id || '');
      if (!id) throw new ApiError(400, '参数错误');
      await env.DB.prepare(sql).bind(id).run();
      await syncCurrent(env);
      return null;
    },
  });
