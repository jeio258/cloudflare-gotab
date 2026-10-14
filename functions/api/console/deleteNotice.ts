import { defineHandler } from '../../lib/handler';
import { ApiError } from '../../lib/http';

// 公告删除工厂：rejectNotice 语义相同（驳回即删除），复用此实现避免重复，路由名与各自 msg 保持不变
export const noticeDelete = (msg: string) =>
  defineHandler({
    auth: 'admin',
    body: true,
    msg,
    run: async ({ env, body }) => {
      const id = String(body.id || '');
      if (!id) throw new ApiError(400, '参数错误');
      await env.DB.prepare('delete from notices where id = ?').bind(id).run();
      return null;
    },
  });

export const onRequestPost = noticeDelete('公告已删除');
