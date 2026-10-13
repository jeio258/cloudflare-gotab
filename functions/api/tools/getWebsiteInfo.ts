import { defineHandler } from '../../lib/handler';
import { fetchJson } from '../../lib/upstream';

export const onRequestPost = defineHandler({
  body: 'optional',
  run: async ({ body }) => {
    const raw = String(body.url || '').trim();
    if (!raw) return { title: '', icon: '', description: '' };

    try {
      const j = (await fetchJson(
        `https://uapis.cn/api/v1/webparse/metadata?url=${encodeURIComponent(raw)}`
      )) as { title?: string; description?: string; favicon_url?: string };
      const icon = String(j.favicon_url || '').trim();
      return {
        title: String(j.title || '').trim(),
        // uapis 无图标时返回 data:, 占位；透传会让前端走内联 SVG 分支破图，归一为空串回落 /icons/bookmark.svg
        icon: icon === 'data:,' ? '' : icon,
        description: String(j.description || '').trim(),
      };
    } catch {
      return { title: '', icon: '', description: '' };
    }
  },
});
