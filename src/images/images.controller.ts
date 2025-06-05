import {
  Controller,
  Get,
  Post,
  Param,
  UseInterceptors,
  UploadedFiles,
  Body,
  Query,
  UnauthorizedException,
  BadRequestException,
  ParseUUIDPipe,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ImagesService } from './images.service';
import { Image } from './entities/image.entity';
import { UploadImageDto } from './dto/upload-image.dto';
import { PaginatedResult, PaginationDto } from '../common/dto/pagination.dto';
import { ConfigService } from '@nestjs/config';

@Controller('images')
export class ImagesController {
  constructor(
    private readonly imagesService: ImagesService,
    private readonly configService: ConfigService,
  ) {}

  @Post('upload')
  @UseInterceptors(FilesInterceptor('files'))
  async uploadImages(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() uploadImageDto: UploadImageDto,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('没有选择文件上传');
    }

    const maxFileSize = parseInt(this.configService.get<string>('MAX_FILE_SIZE') || '2097152');
    const serverPassword = this.configService.get<string>('SERVER_PASSWORD');

    // 检查是否有超过大小限制的文件
    const bigFiles = files.filter(file => file.size > maxFileSize);
    
    // 如果有大文件，检查管理员密码
    if (bigFiles.length > 0) {
      if (!uploadImageDto.adminPassword || uploadImageDto.adminPassword !== serverPassword) {
        throw new UnauthorizedException('文件过大且管理员密码不正确');
      }
    }

    // 上传图片
    const uploadedImages = await this.imagesService.saveImages(files);
    
    return {
      success: true,
      message: '上传成功',
      data: uploadedImages,
    };
  }

  @Get()
  async findAll(@Query() paginationDto: PaginationDto): Promise<PaginatedResult<Image>> {
    return this.imagesService.findAll(paginationDto);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Image> {
    const image = await this.imagesService.findOne(id);
    if (!image) {
      throw new HttpException('图片不存在', HttpStatus.NOT_FOUND);
    }
    return image;
  }
}