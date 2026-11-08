import { cachedJson, fetchJson } from './upstream';

interface HotItem {
  title: string;
  url: string;
  hot?: string;
}

interface UHotItem {
  title?: string;
  url?: string;
  hot_value?: string | number;
}

// uapis 支持的热榜类型
const SUPPORTED = new Set(['weibo', 'bilibili', 'baidu', 'douyin']);

async function fetchBoard(type: string): Promise<HotItem[]> {
  const j = (await fetchJson(`https://uapis.cn/api/v1/misc/hotboard?type=${type}`)) as {
    list?: UHotItem[];
  };
  const list = j?.list;
  if (!Array.isArray(list)) return [];
  return list
    .map((it) => ({
      title: String(it.title || ''),
      url: String(it.url || ''),
      hot: it.hot_value != null ? String(it.hot_value) : '',
    }))
    .filter((x) => x.title && x.url);
}

export async function hotEvents(type: string): Promise<HotItem[]> {
  if (!SUPPORTED.has(type)) return [];
  try {
    return await cachedJson(`hot:${type}`, 5 * 60_000, () => fetchBoard(type));
  } catch {
    return [];
  }
}
