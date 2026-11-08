import { defineHandler } from '../../lib/handler';
import type { RouteContext } from '../../lib/handler';
import { pagedQuery } from '../../lib/paging';

// 用户管理列表（端点沿用官方命名，返回全部用户；支持 GET/POST）
const list = (ctx: RouteContext) =>
  pagedQuery(ctx.env, ctx.request, (keyword) => {
    const where = keyword ? 'where username like ? or nickname like ?' : '';
    const binds = keyword ? [`%${keyword}%`, `%${keyword}%`] : [];
    return {
      countSql: `select count(*) as n from users ${where}`,
      rowsSql: `select id, username, user_type as userType, status, nickname, sex, email, phone, avatar, birthday,
                       '' as appellation, 0 as appellationStatus,
                       created_at as registerTime, created_at as updatedAt
                from users ${where}
                order by created_at desc limit ? offset ?`,
      binds,
    };
  });

const handler = defineHandler({ auth: 'admin', run: list });

export const onRequestGet = handler;
export const onRequestPost = handler;
