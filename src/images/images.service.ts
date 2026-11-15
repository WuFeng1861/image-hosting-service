import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import { extname } from 'path';
import { pipeline } from 'stream/promises';
import { Image } from './entities/image.entity';
import { ConfigService } from '@nestjs/config';
import { PaginatedResult, PaginationDto } from '../common/dto/pagination.dto';
import { detectImageType, ImageExt } from './image-type.util';

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
}
