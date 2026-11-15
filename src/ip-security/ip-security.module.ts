import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RequestLog } from './entities/request-log.entity';
import { IpRule } from './entities/ip-rule.entity';
import { IpFilterSettings } from './entities/ip-filter-settings.entity';
import { IpFilterService } from './ip-filter.service';
import { RequestLogService } from './request-log.service';
import { IpSecurityMiddleware } from './middleware/ip-security.middleware';
import { IpSecurityController } from './ip-security.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RequestLog, IpRule, IpFilterSettings])],
  controllers: [IpSecurityController],
  providers: [IpFilterService, RequestLogService, IpSecurityMiddleware],
  exports: [IpFilterService, RequestLogService, IpSecurityMiddleware],
})
export class IpSecurityModule {}
