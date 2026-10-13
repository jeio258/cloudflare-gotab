import { PHONE_RE, USERNAME_RE } from '../../lib/account';
import { toUserInfo } from '../../lib/contract';
import { getUserById, getUserByUsername, isUniqueViolation, updateProfile } from '../../lib/db';
import { defineHandler } from '../../lib/handler';
import { ApiError } from '../../lib/http';

export const onRequestPost = defineHandler({
  auth: 'user',
  body: true,
  run: async ({ env, user, body }) => {
    const username = String(body.username ?? user!.username).trim();
    const nickname = String(body.nickname ?? '').trim();
    const phone = String(body.phone ?? '').trim();
    const sex = Number(body.sex ?? 0);
    const birthdayRaw = body.birthday;
    const birthday = birthdayRaw === undefined || birthdayRaw === null ? null : String(birthdayRaw);

    if (!USERNAME_RE.test(username)) throw new ApiError(400, '用户名需字母开头、3-20 位字母数字_-');
    if (nickname.length > 20) throw new ApiError(400, '昵称不能超过 20 个字符');
    if (phone && !PHONE_RE.test(phone)) throw new ApiError(400, '手机号格式不正确');
    if (sex !== 0 && sex !== 1) throw new ApiError(400, '性别参数不正确');

    if (username !== user!.username) {
      const exists = await getUserByUsername(env, username);
      if (exists && exists.id !== user!.id) throw new ApiError(400, '用户名已存在');
    }

    try {
      await updateProfile(env, user!.id, { username, nickname, sex, phone, birthday });
    } catch (e) {
      // 并发改名绕过预检命中 UNIQUE 约束，归为业务错误
      if (isUniqueViolation(e)) throw new ApiError(400, '用户名已存在');
      throw e;
    }
    const fresh = await getUserById(env, user!.id);
    return toUserInfo(fresh || user!);
  },
});
