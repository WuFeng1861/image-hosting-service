import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * 管理员口令哈希：Node 内置 scrypt，不引原生依赖（bcrypt 要编译，部署面越小越好）。
 * 存储格式：scrypt$N$r$p$saltBase64$hashBase64
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(plain: string, stored: string): boolean {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const [, n, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = scryptSync(plain, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** 口令强度：至少 8 位，且不能是纯数字 */
export function checkPasswordStrength(plain: string): string | null {
  if (typeof plain !== 'string' || plain.length < 8) return '密码至少 8 位';
  if (plain.length > 128) return '密码不能超过 128 位';
  if (/^\d+$/.test(plain)) return '密码不能是纯数字';
  return null;
}
