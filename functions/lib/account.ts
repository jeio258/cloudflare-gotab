import { hashPassword, newId } from './auth';
import { getUserByUsername, insertUser, isUniqueViolation } from './db';
import type { Env } from './http';
import { ApiError } from './http';

export const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{2,19}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^1[3-9]\d{9}$/;

export const validPassword = (p: string) => p.length >= 6 && p.length <= 32;

interface CreateUserInput {
  username: string;
  password: string;
  nickname?: string;
  email?: string;
  phone?: string;
  sex?: number;
  userType?: number;
}

interface CreateUserOptions {
  // 公开注册必须填邮箱；后台建号可不填（填了则校验格式）
  emailRequired?: boolean;
}

// 规则单一来源：注册与后台建号共用，避免两处规则漂移
export function validateCreateUser(input: CreateUserInput, opts: CreateUserOptions = {}) {
  const username = String(input.username || '').trim();
  const email = String(input.email || '').trim();
  const phone = String(input.phone || '').trim();

  if (!USERNAME_RE.test(username)) throw new ApiError(400, '用户名需字母开头、3-20 位字母数字_-');
  if (!validPassword(input.password)) throw new ApiError(400, '密码长度需在 6-32 位之间');
  if (opts.emailRequired ? !EMAIL_RE.test(email) : email && !EMAIL_RE.test(email)) {
    throw new ApiError(400, '邮箱格式不正确');
  }
  if (phone && !PHONE_RE.test(phone)) throw new ApiError(400, '手机号格式不正确');

  return { username, email, phone };
}

export async function createUser(env: Env, input: CreateUserInput, opts: CreateUserOptions = {}) {
  const { username, email, phone } = validateCreateUser(input, opts);
  if (await getUserByUsername(env, username)) throw new ApiError(400, '用户名已存在');

  try {
    await insertUser(env, {
      id: newId(),
      username,
      password: await hashPassword(input.password),
      nickname: String(input.nickname || '').trim() || username,
      email,
      phone,
      avatar: '',
      sex: Number(input.sex ?? 0) || 0,
      birthday: '',
      user_type: Number(input.userType ?? 0) === 1 ? 1 : 0,
      status: 1,
      share_id: newId(),
      share_enabled: 0,
    });
  } catch (e) {
    // 并发同名绕过预检会命中 UNIQUE 约束，归为业务错误而非 500
    if (isUniqueViolation(e)) throw new ApiError(400, '用户名已存在');
    throw e;
  }
}
