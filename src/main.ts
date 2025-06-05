import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import * as express from 'express';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  // 创建NestJS应用实例，使用Express平台
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
  // 获取配置服务
  const configService = app.get(ConfigService);
  
  // 设置全局前缀
  app.setGlobalPrefix('api');
  
  // 配置全局管道用于验证
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  // 全局异常过滤器
  app.useGlobalFilters(new HttpExceptionFilter());
  
  // 全局响应转换拦截器
  app.useGlobalInterceptors(new TransformInterceptor());

  // 启用CORS
  app.enableCors();

  // 配置静态文件服务，用于图片访问
  const uploadDir = configService.get<string>('UPLOAD_DIR') || 'uploadImage';
  const uploadPath = join(process.cwd(), uploadDir);
  
  // 确保设置了正确的缓存控制头，1年缓存
  app.use('/images', express.static(uploadPath, {
    maxAge: 31536000000, // 1年的毫秒数
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.setHeader('Expires', new Date(Date.now() + 31536000000).toUTCString());
    }
  }));

  // 获取应用端口
  const port = configService.get<number>('PORT') || 5888;

  // 启动应用
  await app.listen(port);
  console.log(`应用已启动，访问地址: http://localhost:${port}`);
}

bootstrap();