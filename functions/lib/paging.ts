import type { Env } from './http';

export interface Paging {
  page: number;
  pageSize: number;
  keyword: string;
}

// console 通用表格可能以 GET query 或 POST JSON body 传分页参数
export const readPaging = async (req: Request): Promise<Paging> => {
  const url = new URL(req.url);
  const q = url.searchParams;
  let body: Record<string, unknown> = {};
  if (req.method === 'POST') {
    try {
      body = (await req.clone().json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      const v = q.get(k) ?? body?.[k];
      if (v !== null && v !== undefined && v !== '') return v;
    }
    return undefined;
  };
  const page = Math.max(Number(pick('page', 'current') || 1) || 1, 1);
  // 钳制单页上限，防 limit 传超大值拖垮 D1 查询
  const pageSize = Math.min(Math.max(Number(pick('pageSize', 'size', 'page_size', 'limit') || 10) || 1, 1), 100);
  const keyword = String(pick('username', 'keyword', 'search') || '').trim();
  return { page, pageSize, keyword };
};
