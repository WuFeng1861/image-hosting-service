import { BadRequestException, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { isAbsolute, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ImagesController } from './images.controller';
import { ImagesService } from './images.service';
import { Image } from './entities/image.entity';

/**
 * 唯一可信的映射表：MIME → 落盘扩展名。
 * 不含 image/svg+xml（SVG 本身就能执行脚本），也不看 originalname。
 */
const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

@Module({
  imports: [
    TypeOrmModule.forFeature([Image]),
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const uploadDir = configService.get<string>('UPLOAD_DIR') || 'uploadImage';
        // 绝对路径直接用：join(cwd, 'C:////x') 会拼成坏路径
        const uploadPath = isAbsolute(uploadDir) ? uploadDir : join(process.cwd(), uploadDir);
        if (!existsSync(uploadPath)) {
          mkdirSync(uploadPath, { recursive: true });
        }

        // 管理员可放行的绝对上限；普通用户上限在 controller 里按 MAX_FILE_SIZE 判
        const hardLimit =
          Number(configService.get<string>('MAX_UPLOAD_BYTES')) || 20 * 1024 * 1024;

        return {
          storage: diskStorage({
            destination: uploadPath,
            filename: (_req, file, callback) => {
              // 只做展示用，不参与磁盘命名
              file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
              callback(null, `${uuidv4()}${MIME_TO_EXT[file.mimetype] ?? '.bin'}`);
            },
          }),
          fileFilter: (_req, file, callback) => {
            if (!MIME_TO_EXT[file.mimetype]) {
              return callback(
                new BadRequestException('只支持 png / jpg / gif / webp 图片') as unknown as Error,
                false,
              );
            }
            callback(null, true);
          },
          // 关键：limits 在接收流里就掐断，不会先落盘再报错
          limits: {
            fileSize: hardLimit,
            files: 10,
            fields: 5,
            parts: 20,
            headerPairs: 200,
          },
        };
      },
    }),
  ],
  controllers: [ImagesController],
  providers: [ImagesService],
})
export class ImagesModule {}

export { MIME_TO_EXT };
