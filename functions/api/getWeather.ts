import { defineHandler } from '../lib/handler';
import { ApiError } from '../lib/http';
import { weatherOf } from '../lib/weather';

interface CfLocation {
  city?: string;
}

export const onRequestGet = defineHandler({
  run: async ({ request }) => {
    const url = new URL(request.url);
    const city = (url.searchParams.get('city') || '').trim();

    let name = city;
    if (!name) {
      const cf = (request as unknown as { cf?: CfLocation }).cf;
      name = String(cf?.city || '北京');
    }

    try {
      // 契约：前端按 data.data 读取天气对象（外层为统一响应包装，故此处再包一层）
      const payload = await weatherOf(name);
      return { data: payload };
    } catch {
      throw new ApiError(500, '天气服务暂不可用');
    }
  },
});
