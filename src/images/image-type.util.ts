/**
 * 只信任文件头，不信任 Content-Type / 扩展名。
 * 审计发现的存储型 XSS 根因：扩展名取自 originalname，
 * 于是 f.html 被存成 <uuid>.html，express.static 按扩展名回 text/html。
 * 这里做两件事：
 *   1) 扩展名只由 MIME 白名单推导（见 images.module.ts）
 *   2) 落盘后再按字节二次确认，伪造成 image/png 的 HTML 会在这里被识别出来
 */

export type ImageExt = 'png' | 'jpg' | 'gif' | 'webp';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87 = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
const GIF89 = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const RIFF = Buffer.from([0x52, 0x49, 0x46, 0x46]);
const WEBP = Buffer.from([0x57, 0x45, 0x42, 0x50]);

/** head 至少 12 字节 */
export function detectImageType(head: Buffer): ImageExt | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG)) return 'png';
  if (head.length >= 3 && head.subarray(0, 3).equals(JPEG)) return 'jpg';
  if (head.length >= 6 && (head.subarray(0, 6).equals(GIF87) || head.subarray(0, 6).equals(GIF89))) {
    return 'gif';
  }
  if (
    head.length >= 12 &&
    head.subarray(0, 4).equals(RIFF) &&
    head.subarray(8, 12).equals(WEBP)
  ) {
    return 'webp';
  }
  return null;
}

/** 浏览器展示用，扩展名 → Content-Type，禁止 sniff */
export const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
