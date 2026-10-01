import { EMAIL_RE, validPassword } from '../lib/account';
import { hashPassword, verifyPassword } from '../lib/auth';
import { getUserByUsername, updatePassword } from '../lib/db';
import { defineHandler } from '../lib/handler';
import { ApiError } from '../lib/http';
import { enforceRateLimit } from '../lib/ratelimit';

export const onRequestPost = defineHandler({
  body: true,
  msg: '密码已重置，请登录',
  run: async ({ env, request, body }) => {
    await enforceRateLimit(env, request, 'findPassword');
    const username = String(body.username || '').trim();
    const email = String(body.email || '').trim();
    const oldPassword = String(body.oldPassword || '');
    const newPassword = String(body.newPassword || '');
    const confirmPassword = String(body.confirmPassword || '');
    if (!username) throw new ApiError(400, '请输入用户名');
    if (!EMAIL_RE.test(email)) throw new ApiError(400, '邮箱格式不正确');
    if (!oldPassword) throw new ApiError(400, '请输入原密码');
    if (!validPassword(newPassword)) throw new ApiError(400, '新密码长度需在 6-32 位之间');
    if (newPassword !== confirmPassword) throw new ApiError(400, '两次输入的新密码不一致');

    const user = await getUserByUsername(env, username);
    if (!user || user.email !== email) throw new ApiError(400, '用户名与邮箱不匹配');
    if (!(await verifyPassword(oldPassword, user.password))) throw new ApiError(400, '原密码错误');

    await updatePassword(env, user.id, await hashPassword(newPassword));
    return null;
  },
});
