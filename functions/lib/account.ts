export const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{2,19}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^1[3-9]\d{9}$/;

export const validPassword = (p: string) => p.length >= 6 && p.length <= 32;
