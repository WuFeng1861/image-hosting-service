import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import type { Dirent } from 'fs';
import { extname, isAbsolute, join } from 'path';
import { pipeline } from 'stream/promises';
import { Image } from './entities/image.entity';
import { ConfigService } from '@nestjs/config';
import { PaginatedResult, PaginationDto } from '../common/dto/pagination.dto';
import { detectImageType, EXT_TO_MIME, ImageExt } from './image-type.util';

const EXT_BY_TYPE: Record<ImageExt, string> = {
  png: '.png',
  jpg: '.jpg',
  gif: '.gif',
  webp: '.webp',
};

@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  constructor(
    @InjectRepository(Image)
    private readonly imageRepository: Repository<Image>,
    private readonly configService: ConfigService,
  ) {}

  private get maxFileBytes(): number {
    // Number('2M') 是 NaN，用 || 兜底，别让限制静默失效
    const configured = Number(this.configService.get<string>('MAX_FILE_SIZE'));
    return Number.isFinite(configured) && configured > 0 ? configured : 5 * 1024 * 1024;
  }

  /** 流式哈希，避免 fs.readFile 把大文件整个读进内存 */
  private async calculateFileHash(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(createReadStream(filePath), hash);
    return hash.digest('hex');
  }

  /**
   * 读前 16 字节判断真实类型；与 MIME 推导出的扩展名不一致时直接改名。
   * 不是图片 → 删文件并抛 400。
   */
  private async normalizeFile(file: Express.Multer.File): Promise<void> {
    const handle = await fs.open(file.path, 'r');
    let head: Buffer;
    try {
      head = Buffer.alloc(16);
      const { bytesRead } = await handle.read(head, 0, 16, 0);
      head = head.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }

    const detected = detectImageType(head);
    if (!detected) {
      await fs.unlink(file.path).catch(() => undefined);
      throw new BadRequestException('文件内容不是受支持的图片');
    }

    const expectedExt = EXT_BY_TYPE[detected];
    const currentExt = extname(file.filename).toLowerCase();
    if (currentExt !== expectedExt) {
      // 声明 png 实际是 jpg：以真实字节为准
      const newName = file.filename.replace(/\.[^.]+$/, '') + expectedExt;
      const newPath = file.path.replace(file.filename, newName);
      await fs.rename(file.path, newPath);
      file.filename = newName;
      file.path = newPath;
    }

    // 单个文件大小兜底（multer 只保证不超过管理员硬上限）
    if (file.size > this.maxFileBytes) {
      await fs.unlink(file.path).catch(() => undefined);
      throw new BadRequestException(
        `文件超过 ${(this.maxFileBytes / 1024 / 1024).toFixed(1)}MB 限制`,
      );
    }
  }

  async saveImages(files: Express.Multer.File[]): Promise<ReturnType<ImagesService['toDto']>[]> {
    try {
      // 先校验，全部不合格的直接落不了库
      for (const file of files) {
        await this.normalizeFile(file);
      }

      const fileHashes = await Promise.all(files.map((f) => this.calculateFileHash(f.path)));
      const existingImages = await this.imageRepository.find({
        where: { fileHash: In(fileHashes) },
      });

      const byHash = new Map(existingImages.map((img) => [img.fileHash, img]));
      const results: Image[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileHash = fileHashes[i];

        const existing = byHash.get(fileHash);
        if (existing) {
          await fs.unlink(file.path).catch(() => undefined);
          results.push(existing);
          continue;
        }

        const image = new Image();
        image.filename = file.filename;
        image.originalName = file.originalname;
        image.mimeType = file.mimetype;
        image.size = file.size;
        // 列是 NOT NULL，落库存一份绝对地址；对外返回时统一由 toDto 动态生成
        image.url = this.buildUrl(file.filename);
        image.fileHash = fileHash;

        results.push(await this.imageRepository.save(image));
      }

      return results.map((image) => this.toDto(image));
    } catch (error) {
      this.logger.error(`保存图片失败: ${(error as Error).message}`);
      throw error;
    }
  }

  private buildUrl(filename: string): string {
    const domain = this.configService.get<string>('DOMAIN') || '127.0.0.1';
    const scheme = this.configService.get<string>('PUBLIC_SCHEME') || 'https';
    const base = domain.startsWith('http') ? domain : `${scheme}://${domain}`;
    return `${base}/images/${filename}`;
  }

  /** 域名换了不用改库：URL 永远由 filename 现算 */
  toDto(image: Image) {
    return {
      id: image.id,
      filename: image.filename,
      originalName: image.originalName,
      mimeType: image.mimeType,
      size: image.size,
      url: this.buildUrl(image.filename),
      createdAt: image.createdAt,
    };
  }

  async findAll(paginationDto: PaginationDto): Promise<PaginatedResult<ReturnType<ImagesService['toDto']>>> {
    const page = Math.max(paginationDto.page || 1, 1);
    const limit = Math.min(Math.max(paginationDto.limit || 20, 1), 100);
    const skip = (page - 1) * limit;

    const [items, totalItems] = await this.imageRepository.findAndCount({
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      items: items.map((i) => this.toDto(i)),
      meta: {
        totalItems,
        itemCount: items.length,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit) || 1,
        currentPage: page,
      },
    };
  }

  async findOne(id: string) {
    const image = await this.imageRepository.findOne({ where: { id } });
    return image ? this.toDto(image) : null;
  }

  /**
   * 判断一个文件该不该留在图片目录里，四道关由浅入深：
   *   1) 文件头必须是 png / jpg / gif / webp 之一
   *      —— probe.png 这种「只有签名、后面是垃圾」的过不了
   *   2) PNG 必须以 IHDR 开头，所有 chunk 长度不越界，且以 IEND 收尾
   *      —— 被截断、chunk 被篡改的过不了（浏览器会解码失败）
   *   3) 宽高 ≤ 2 且体积 < 1KB 视为占位图
   *      —— 1×1 全透明像素，页面上就是一块空白，不是可以展示的图片
   *   4) 其余视为有效图片
   */
  private async inspectImage(filePath: string): Promise<{ ok: boolean; reason?: string }> {
    let buf: Buffer;
    try {
      buf = await fs.readFile(filePath);
    } catch {
      return { ok: false, reason: '读取失败' };
    }
    if (buf.length < 12) return { ok: false, reason: '文件过小，不是图片' };

    const kind = detectImageType(buf.subarray(0, 32));
    if (!kind) return { ok: false, reason: '文件头不是图片' };

    if (kind === 'png') {
      if (
        buf.length < 16 ||
        buf.readUInt32BE(8) !== 13 ||
        buf.subarray(12, 16).toString('ascii') !== 'IHDR'
      ) {
        return { ok: false, reason: 'PNG 缺少 IHDR' };
      }

      let off = 8;
      let sawIEND = false;
      while (off + 8 <= buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.subarray(off + 4, off + 8).toString('ascii');
        // 长度越界 = 文件被截断，或 chunk 被别人改过
        if (off + 12 + len > buf.length) {
          return { ok: false, reason: 'chunk 长度越界（文件损坏）' };
        }
        if (type === 'IEND') {
          sawIEND = true;
          break;
        }
        off += 12 + len;
      }
      if (!sawIEND) return { ok: false, reason: 'PNG 缺少 IEND（文件截断）' };

      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      if (width <= 2 && height <= 2 && buf.length < 1024) {
        return { ok: false, reason: `${width}×${height} 透明占位图` };
      }
    }

    return { ok: true };
  }

  /**
   * 清理 uploadImage 目录与数据库的不一致：
   *  - invalidFiles：扩展名不在白名单（历史漏洞落盘的 .php / .html 等）→ 删文件 + 删记录
   *  - missingRecords：库里有记录、磁盘没文件 → 删记录（否则列表里全是坏图）
   *  - orphanFiles：磁盘有文件、库里没记录 → 只报告不删（可能是迁移遗留）
   * dryRun 默认 true，只出报告，不动磁盘。
   */
  async cleanupUploadDir(options: { dryRun: boolean; removeOrphanRecords: boolean }) {
    const uploadDir = this.configService.get<string>('UPLOAD_DIR') || 'uploadImage';
    const uploadPath = isAbsolute(uploadDir) ? uploadDir : join(process.cwd(), uploadDir);

    let entries: Dirent[];
    try {
      entries = await fs.readdir(uploadPath, { withFileTypes: true });
    } catch (e) {
      throw new BadRequestException(`无法读取上传目录 ${uploadPath}：${(e as Error).message}`);
    }

    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    const fileSet = new Set(files);
    const rows = await this.imageRepository.find();
    const rowByName = new Map(rows.map((r) => [r.filename, r]));

    const invalidFiles: string[] = [];
    const invalidDetails: { filename: string; reason: string }[] = [];
    const orphanFiles: string[] = [];

    for (const name of files) {
      const ext = extname(name).toLowerCase();

      // 1) 扩展名不在白名单：既不能对外提供，也不该留在目录里
      if (!EXT_TO_MIME[ext]) {
        invalidFiles.push(name);
        invalidDetails.push({ filename: name, reason: `扩展名 ${ext || '(无)'} 不在白名单` });
        continue;
      }

      // 2) 内容不是有效图片 / 结构损坏 / 1×1 占位图
      const verdict = await this.inspectImage(join(uploadPath, name));
      if (!verdict.ok) {
        invalidFiles.push(name);
        invalidDetails.push({ filename: name, reason: verdict.reason ?? '内容不是有效图片' });
        continue;
      }

      if (!rowByName.has(name)) orphanFiles.push(name);
    }

    const missingRecords = rows
      .filter((r) => !fileSet.has(r.filename))
      .map((r) => ({ id: r.id, filename: r.filename, originalName: r.originalName }));

    const recordIds = new Set<string>();
    const recordsToDelete: Image[] = [];
    const pushRecord = (row?: Image) => {
      if (row && !recordIds.has(row.id)) {
        recordIds.add(row.id);
        recordsToDelete.push(row);
      }
    };
    invalidFiles.forEach((name) => pushRecord(rowByName.get(name)));
    if (options.removeOrphanRecords) {
      missingRecords.forEach((m) => pushRecord(rowByName.get(m.filename)));
    }

    const report = {
      uploadDir: uploadPath,
      dryRun: options.dryRun,
      summary: {
        totalFiles: files.length,
        totalRecords: rows.length,
        invalidFiles: invalidFiles.length,
        orphanFiles: orphanFiles.length,
        missingRecords: missingRecords.length,
        recordsToDelete: recordsToDelete.length,
      },
      invalidFiles,
      invalidDetails,
      orphanFiles,
      missingRecords,
      deleted: { files: 0, records: 0 },
    };

    if (options.dryRun) return report;

    for (const name of invalidFiles) {
      try {
        await fs.unlink(join(uploadPath, name));
        report.deleted.files += 1;
      } catch (e) {
        this.logger.warn(`[cleanup] 删除文件失败 ${name}：${(e as Error).message}`);
      }
    }

    if (recordsToDelete.length > 0) {
      const res = await this.imageRepository.delete({ id: In(recordsToDelete.map((r) => r.id)) });
      report.deleted.records = res.affected ?? 0;
    }

    this.logger.warn(
      `[cleanup] ${uploadPath}：删除非图片文件 ${report.deleted.files} 个、记录 ${report.deleted.records} 条`,
    );
    return report;
  }
}
