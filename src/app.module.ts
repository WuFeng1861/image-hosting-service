import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { mkdirSync } from 'fs';
import { dirname, join, isAbsolute } from 'path';
import { ImagesModule } from './images/images.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SystemModule } from './system/system.module';
import { ProjectReportingModule } from './project-reporting/project-reporting.module';
import { AdminModule } from './admin/admin.module';
import { IpSecurityModule } from './ip-security/ip-security.module';
import { HealthController } from './health.controller';

function resolveDbFile(configService: ConfigService): string {
  const raw = configService.get<string>('DB_FILE') || 'data/image-hosting.db';
  return isAbsolute(raw) ? raw : join(process.cwd(), raw);
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
    }),

    AdminModule,
    IpSecurityModule,
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const database = resolveDbFile(configService);
        mkdirSync(dirname(database), { recursive: true });

        return {
          type: 'better-sqlite3' as const,
          database,
          entities: [join(__dirname, '**', '*.entity.{ts,js}')],
          // 原来靠 NODE_ENV !== 'production' 兜底，env 写 development 就会同步表结构
          synchronize: configService.get<string>('DB_SYNCHRONIZE') === 'true',
          // 上传是并发写，WAL 必须开
          prepareDatabase: (db: {
            pragma: (sql: string) => unknown;
          }) => {
            db.pragma('journal_mode = WAL');
            db.pragma('busy_timeout = 5000');
            db.pragma('synchronous = NORMAL');
            db.pragma('foreign_keys = ON');
          },
        };
      },
    }),

    ImagesModule,
    SystemModule,
    ProjectReportingModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
