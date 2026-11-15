import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { ImagesService } from './images.service';
import { PaginationDto } from '../common/dto/pagination.dto';

/**
 * 图床的管理面（上传 / 列表 / 详情）由全局 AdminGuard 保护，需要管理员登录。
 * 对外可访问的只有 /images/<file> 静态文件 —— 外链要靠它，所以不走鉴权。
 */
@Controller('images')
export class ImagesController {
  constructor(
    private readonly imagesService: ImagesService,
    private readonly configService: ConfigService,
  ) {}

  private get maxFileBytes(): number {
    const configured = Number(this.configService.get<string>('MAX_FILE_SIZE'));
    return Number.isFinite(configured) && configured > 0 ? configured : 5 * 1024 * 1024;
  }

  @Post('upload')
  @UseInterceptors(FilesInterceptor('files'))
  async uploadImages(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('没有选择文件上传');
    }

    const maxFileSize = this.maxFileBytes;
    if (files.some((f) => f.size > maxFileSize)) {
      // 被 multer 接收的文件要清掉，否则会留下孤儿文件
      await Promise.all(files.map((f) => fs.unlink(f.path).catch(() => undefined)));
      throw new BadRequestException(
        `文件超过 ${(maxFileSize / 1024 / 1024).toFixed(1)}MB 限制`,
      );
    }

    const uploadedImages = await this.imagesService.saveImages(files);

    return {
      success: true,
      message: '上传成功',
      data: uploadedImages,
    };
  }

  @Get()
  findAll(@Query() paginationDto: PaginationDto) {
    return this.imagesService.findAll(paginationDto);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const image = await this.imagesService.findOne(id);
    if (!image) {
      throw new HttpException('图片不存在', HttpStatus.NOT_FOUND);
    }
    return image;
  }
}
