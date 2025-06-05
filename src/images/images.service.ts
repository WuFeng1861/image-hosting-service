import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Image } from './entities/image.entity';
import { ConfigService } from '@nestjs/config';
import { PaginatedResult, PaginationDto } from '../common/dto/pagination.dto';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';

@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);
  
  constructor(
    @InjectRepository(Image)
    private readonly imageRepository: Repository<Image>,
    private readonly configService: ConfigService,
  ) {}
  
  // 计算文件哈希值
  private async calculateFileHash(filePath: string): Promise<string> {
    const fileBuffer = await fs.readFile(filePath);
    return createHash('sha256').update(fileBuffer).digest('hex');
  }
  
  // 保存上传的图片信息到数据库
  async saveImages(files: Express.Multer.File[]): Promise<Image[]> {
    try {
      const domain = this.configService.get<string>('DOMAIN') || '127.0.0.1';
      const protocol = 'https'; // 根据需要可以配置为https
      
      // 计算所有文件的哈希值
      const fileHashes = await Promise.all(
        files.map(file => this.calculateFileHash(file.path))
      );
      
      // 查找已存在的图片
      const existingImages = await this.imageRepository.find({
        where: { fileHash: In(fileHashes) }
      });
      
      const existingHashes = new Set(existingImages.map(img => img.fileHash));
      const results: Image[] = [...existingImages];
      
      // 处理新图片
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileHash = fileHashes[i];
        
        if (!existingHashes.has(fileHash)) {
          const image = new Image();
          image.filename = file.filename;
          image.originalName = file.originalname;
          image.mimeType = file.mimetype;
          image.size = file.size;
          image.url = `${protocol}://${domain}/images/${file.filename}`;
          image.fileHash = fileHash;
          
          const savedImage = await this.imageRepository.save(image);
          results.push(savedImage);
        } else {
          // 如果图片已存在，删除上传的文件
          await fs.unlink(file.path);
        }
      }
      
      return results;
    } catch (error) {
      this.logger.error(`保存图片信息失败: ${error.message}`, error.stack);
      throw error;
    }
  }
  
  // 分页获取所有图片
  async findAll(paginationDto: PaginationDto): Promise<PaginatedResult<Image>> {
    const { page = 1, limit = 20 } = paginationDto;
    const skip = (page - 1) * limit;
    
    const [items, totalItems] = await this.imageRepository.findAndCount({
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
    
    const totalPages = Math.ceil(totalItems / limit);
    
    return {
      items,
      meta: {
        totalItems,
        itemCount: items.length,
        itemsPerPage: limit,
        totalPages,
        currentPage: page,
      },
    };
  }
  
  // 获取单个图片
  async findOne(id: string): Promise<Image> {
    return this.imageRepository.findOne({ where: { id } });
  }
}
