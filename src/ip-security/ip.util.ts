/**
 * IP 工具：规范化、回环判断、CIDR 匹配。
 * 只支持 IPv4 的 CIDR；IPv6 走精确匹配（够用，且避免引入 ipaddr.js）。
 */

/** ::ffff:1.2.3.4 → 1.2.3.4；去空白、去 IPv6 zone */
export function normalizeIp(raw: string | undefined | null): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const noZone = s.split('%')[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(noZone);
  if (mapped) return mapped[1];
  return noZone.toLowerCase();
}

export function isLoopback(ip: string): boolean {
  const s = normalizeIp(ip);
  return s === '127.0.0.1' || s === '::1' || s.startsWith('127.');
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

/** 是否是合法 IP（IPv4 或 IPv6 粗校验） */
export function isValidIp(ip: string): boolean {
  const s = normalizeIp(ip);
  if (!s) return false;
  if (ipv4ToInt(s) !== null) return true;
  return /^[0-9a-f:]+$/i.test(s) && s.includes(':');
}

/** 规则里允许写单 IP 或 CIDR */
export function isValidPattern(pattern: string): boolean {
  const s = String(pattern ?? '').trim();
  if (!s) return false;
  if (!s.includes('/')) return isValidIp(s);
  const [base, maskRaw] = s.split('/');
  if (ipv4ToInt(normalizeIp(base)) === null) return false;
  const mask = Number(maskRaw);
  return Number.isInteger(mask) && mask >= 0 && mask <= 32;
}

/** 单 IP 或 CIDR 是否命中 */
export function matchPattern(ip: string, pattern: string): boolean {
  const target = normalizeIp(ip);
  const rule = String(pattern ?? '').trim().toLowerCase();
  if (!target || !rule) return false;

  if (!rule.includes('/')) {
    return normalizeIp(rule) === target;
  }

  const [base, maskRaw] = rule.split('/');
  const mask = Number(maskRaw);
  const ipInt = ipv4ToInt(target);
  const baseInt = ipv4ToInt(normalizeIp(base));
  if (ipInt === null || baseInt === null || !Number.isInteger(mask)) return false;
  if (mask === 0) return true;

  const maskBits = mask === 32 ? 0xffffffff : (0xffffffff << (32 - mask)) >>> 0;
  return (ipInt & maskBits) === (baseInt & maskBits);
}
