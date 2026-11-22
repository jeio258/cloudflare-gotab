import { getUserData } from '../../lib/db';
import { defineHandler } from '../../lib/handler';
import { safeParse } from '../../lib/json';

export const onRequestGet = defineHandler({
  auth: 'user',
  run: async ({ env, user }) => {
    const row = await getUserData(env, user!.id);
    if (!row) return { timestamp: 0, data: null };
    return { timestamp: Number(row.timestamp), data: safeParse(row.data) };
  },
});
