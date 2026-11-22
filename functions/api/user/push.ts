import { getUserData, upsertUserData } from '../../lib/db';
import { defineHandler } from '../../lib/handler';
import { ApiError } from '../../lib/http';
import { serializeSnapshot } from '../../lib/snapshot';

export const onRequestPost = defineHandler({
  auth: 'user',
  body: true,
  run: async ({ env, user, body }) => {
    const { data } = body;
    const timestamp = Number(body.timestamp);
    const baseTimestamp = typeof body.baseTimestamp === 'number' ? body.baseTimestamp : undefined;
    if (data === undefined || data === null || !Number.isFinite(timestamp)) throw new ApiError(400, '参数错误');

    const payload = serializeSnapshot(data);

    const row = await getUserData(env, user!.id);
    const stored = row ? Number(row.timestamp) : 0;
    // 冲突：客户端基于更旧版本推送
    if (row && baseTimestamp !== undefined && baseTimestamp < stored) {
      throw new ApiError(409, '云端数据已更新', 409);
    }
    // 单调递增：新时间戳必须严格大于已存值
    const newTs = Math.max(timestamp, stored + 1);
    await upsertUserData(env, user!.id, payload, newTs);
    return { timestamp: newTs };
  },
});
