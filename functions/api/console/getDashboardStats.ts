import { defineHandler } from '../../lib/handler';

// 仪表盘统计：前端 dashboard 读取 data.{total_users,new_users_today,total_websites,total_user_shares}
// 缺此端点时前端落到兜底 404，报「接口不存在」且统计恒为 0
export const onRequestGet = defineHandler({
  auth: 'admin',
  run: async ({ env }) => {
    const [u, t, s] = await env.DB.batch<{ n: number }>([
      env.DB.prepare('select count(*) as n from users'),
      // date() 兼容 ISO 与 datetime('now') 两种历史格式
      env.DB.prepare("select count(*) as n from users where date(created_at) = date('now')"),
      env.DB.prepare('select count(*) as n from users where share_enabled = 1'),
    ]);
    const n = (r: D1Result<{ n: number }>) => Number(r.results?.[0]?.n || 0);
    // total_websites：本库无网站源表（资源库在上游），恒 0，勿臆造数据源
    return {
      total_users: n(u),
      new_users_today: n(t),
      total_user_shares: n(s),
      total_websites: 0,
    };
  },
});
