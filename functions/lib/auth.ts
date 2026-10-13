import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Env } from './http';
import { getUserById } from './db';
import type { UserRow } from './db';

const scryptAsync = promisify(scrypt) as (p: string, s: Buffer, l: number) => Promise<Buffer>;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const newId = () => randomUUID();

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = await scryptAsync(pw, salt, 32);
  return `${toHex(salt)}:${toHex(dk)}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [sh, dh] = stored.split(':');
  if (!sh || !dh) return false;
  try {
    const salt = Buffer.from(sh, 'hex');
    const want = Buffer.from(dh, 'hex');
    const got = await scryptAsync(pw, salt, want.length);
    return want.length === got.length && timingSafeEqual(want, got);
  } catch {
    return false;
  }
}

const b64url = (buf: Uint8Array) =>
  btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

let secretWarned = false;
const secretOf = (env: Env) => {
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET 未配置');
  if (!secretWarned && env.JWT_SECRET.length < 32) {
    secretWarned = true;
    console.warn('[auth] JWT_SECRET 不足 32 字符，熵被 padEnd 稀释，建议用 ≥32 位随机串');
  }
  return env.JWT_SECRET.padEnd(32, 'x');
};

async function hmacKey(env: Env) {
  return crypto.subtle.importKey('raw', enc.encode(secretOf(env)), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function createToken(env: Env, uid: string): Promise<string> {
  const h = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const p = b64url(enc.encode(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 })));
  const key = await hmacKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyToken(env: Env, token: string): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  try {
    const key = await hmacKey(env);
    const valid = await crypto.subtle.verify('HMAC', key, b64urlDecode(sig), enc.encode(`${h}.${p}`));
    if (!valid) return null;
    const header = JSON.parse(dec.decode(b64urlDecode(h))) as { alg?: string };
    if (header.alg !== 'HS256') return null;
    const payload = JSON.parse(dec.decode(b64urlDecode(p))) as { uid?: string; exp?: number };
    if (!payload.uid) return null;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return String(payload.uid);
  } catch {
    return null;
  }
}

// 从 Authorization 头取 token，返回当前用户
export async function authUser(env: Env, request: Request) {
  const header = request.headers.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const uid = await verifyToken(env, token);
  if (!uid) return null;
  return getUserById(env, uid);
}

// 校验管理员：返回用户行或 null
export const requireAdmin = async (env: Env, request: Request): Promise<UserRow | null> => {
  const user = await authUser(env, request);
  return user && Number(user.user_type) === 1 ? user : null;
};
