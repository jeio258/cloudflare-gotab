import { defineHandler } from '../lib/handler';
import { safeParse } from '../lib/json';

export const onRequestGet = defineHandler({
  run: async ({ env }) => {
    const row = await env.DB.prepare('select data, created_at from default_data where id = 1').first<{
      data: string;
      created_at: string;
    }>();
    if (!row) return { data: null, created_at: '' };
    return { data: safeParse(row.data), created_at: row.created_at };
  },
});
