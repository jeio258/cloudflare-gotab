import { getUserData, upsertUserData } from '../../lib/db';
import { defineHandler } from '../../lib/handler';
import { ApiError } from '../../lib/http';

// 每账号云快照上限（UTF-8 字节），防超大 JSON 滥用存储
const MAX_DATA_BYTES = 262144;

export const onRequestPost = defineHandler({
  auth: 'user',
  body: true,
  run: async ({ env, user, body }) => {
    const data = body.data;
    const timestamp = Number(body.timestamp);
    const baseTimestamp = typeof body.baseTimestamp === 'number' ? body.baseTimestamp : undefined;
    if (data === undefined || data === null || !Number.isFinite(timestamp)) {
      throw new ApiError(400, '参数错误');
    }
    const payload = JSON.stringify(data);
    // UTF-8 字节数：按 UTF-16 length 会让纯中文载荷虚增 3 倍
    if (new TextEncoder().encode(payload).length > MAX_DATA_BYTES) throw new ApiError(400, '数据过大，无法保存');

    const row = await getUserData(env, user!.id);
    const stored = row ? Number(row.timestamp) : 0;
    // 冲突：客户端基于更旧版本推送
    if (row && typeof baseTimestamp === 'number' && baseTimestamp < stored) {
      throw new ApiError(409, '云端数据已更新', 409);
    }
    // 单调递增：新时间戳必须严格大于已存值
    const newTs = Math.max(timestamp, stored + 1);
    await upsertUserData(env, user!.id, payload, newTs);
    return { timestamp: newTs };
  },
});
