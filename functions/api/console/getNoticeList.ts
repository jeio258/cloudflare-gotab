import { defineHandler } from '../../lib/handler';
import type { RouteContext } from '../../lib/handler';
import { pagedQuery } from '../../lib/paging';

const list = (ctx: RouteContext) =>
  pagedQuery(ctx.env, ctx.request, () => ({
    countSql: 'select count(*) as n from notices',
    rowsSql: `select id, title, content, status, time_code as timeCode, created_by as username, created_at
              from notices order by created_at desc, id desc limit ? offset ?`,
    binds: [],
  }));

const handler = defineHandler({ auth: 'admin', run: list });

export const onRequestGet = handler;
export const onRequestPost = handler;
