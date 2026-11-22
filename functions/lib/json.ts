// 存量数据可能来自历史版本（含非法 JSON），读取一律走这里，避免各端点各写一份 try/catch
export function safeParse<T>(raw: string | null | undefined): T | null {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
