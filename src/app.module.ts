import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { ImagesModule } from './images/images.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import {SystemModule} from './system/system.module';
import {ProjectReportingModule} from './project-reporting/project-reporting.module';

@Module({
  imports: [
    // 配置模块
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    
    // TypeORM数据库连接配置
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 3306),
        username: configService.get<string>('DB_USERNAME', 'root'),
        password: configService.get<string>('DB_PASSWORD', 'root'),
        database: configService.get<string>('DB_DATABASE', 'image_hosting'),
        entities: [join(__dirname, '**', '*.entity.{ts,js}')],
        synchronize: configService.get<string>('NODE_ENV') !== 'production',
        charset: 'utf8mb4',
      }),
    }),
    
    // 图片模块
    ImagesModule,
    SystemModule,
    ProjectReportingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
