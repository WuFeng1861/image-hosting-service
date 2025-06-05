import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImagesController } from './images.controller';
import { ImagesService } from './images.service';
import { Image } from './entities/image.entity';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';

@Module({
  imports: [
    TypeOrmModule.forFeature([Image]),
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const uploadDir = configService.get<string>('UPLOAD_DIR') || 'uploadImage';
        const uploadPath = join(process.cwd(), uploadDir);
        
        // 确保上传目录存在
        if (!existsSync(uploadPath)) {
          mkdirSync(uploadPath, { recursive: true });
        }
        
        return {
          storage: diskStorage({
            destination: uploadPath,
            filename: (req, file, callback) => {
              // 解码原始文件名，确保中文正确显示
              const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
              // 生成唯一文件名，保留原始扩展名
              const uniqueSuffix = uuidv4();
              const ext = extname(decodedName);
              // 保存解码后的原始文件名到请求对象中，供后续使用
              file.originalname = decodedName;
              callback(null, `${uniqueSuffix}${ext}`);
            },
          }),
          // 限制文件类型
          fileFilter: (req, file, callback) => {
            if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp|svg\+xml)$/)) {
              return callback(new Error('只支持图片文件上传！'), false);
            }
            callback(null, true);
          },
        };
      },
    }),
  ],
  controllers: [ImagesController],
  providers: [ImagesService],
})
export class ImagesModule {}
