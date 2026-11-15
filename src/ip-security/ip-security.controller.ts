import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { IpFilterService } from './ip-filter.service';
import { RequestLogService } from './request-log.service';
import {
  CreateIpRuleDto,
  ListIpRuleQueryDto,
  ListRequestQueryDto,
  RequestStatsQueryDto,
  UpdateIpFilterSettingsDto,
  UpdateIpRuleDto,
} from './dto/ip-security.dto';
import { isLoopback, normalizeIp } from './ip.util';

/**
 * IP 黑白名单 + 访问记录管理。整组都在 /api/admin 下，由全局 AdminGuard 保护。
 *
 * 前端典型流程：
 *   GET  /api/admin/requests/stats       看可疑 IP（按请求数排序）
 *   POST /api/admin/ip-rules             把某个 IP 加进黑名单
 *   GET  /api/admin/ip-rules             规则列表
 *   POST /api/admin/ip-rules/:id/promote 把黑名单里的 IP 转成白名单
 *   PATCH /api/admin/ip-filter/settings  开/关黑白名单
 */
@Controller('admin')
export class IpSecurityController {
  constructor(
    private readonly filter: IpFilterService,
    private readonly logs: RequestLogService,
  ) {}

  /* ------------------------ 规则 ------------------------ */

  @Get('ip-rules')
  listRules(@Query() query: ListIpRuleQueryDto) {
    return this.filter.listRules(query);
  }

  @Post('ip-rules')
  createRule(@Body() dto: CreateIpRuleDto) {
    return this.filter.createRule(dto);
  }

  /** 改 mode 即为「黑转白 / 白转黑」 */
  @Patch('ip-rules/:id')
  updateRule(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateIpRuleDto) {
    return this.filter.updateRule(id, dto);
  }

  /** 快捷：黑名单条目一键转白名单 */
  @Post('ip-rules/:id/promote')
  @HttpCode(200)
  promote(@Param('id', ParseIntPipe) id: number) {
    return this.filter.updateRule(id, { mode: 'white' as never });
  }

  @Delete('ip-rules/:id')
  @HttpCode(204)
  async removeRule(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.filter.removeRule(id);
  }

  /* ------------------------ 开关 ------------------------ */

  @Get('ip-filter/settings')
  getSettings() {
    return this.filter.getSettings();
  }

  @Patch('ip-filter/settings')
  updateSettings(@Body() dto: UpdateIpFilterSettingsDto) {
    return this.filter.updateSettings(dto);
  }

  /* ------------------------ 访问记录 ------------------------ */

  @Get('requests')
  listRequests(@Query() query: ListRequestQueryDto) {
    return this.logs.list(query);
  }

  /** 按 IP 聚合：suspects 列表 */
  @Get('requests/stats')
  requestStats(@Query() query: RequestStatsQueryDto) {
    return this.logs.stats(query);
  }

  /** 调试用：这个 IP 现在会被怎么处理（模拟业务接口，不含管理端豁免） */
  @Get('ip-lookup')
  async lookup(@Query('ip') rawIp: string, @Req() req: Request) {
    const ip = normalizeIp(rawIp || req.ip || '');
    const rule = this.filter.findRuleFor(ip);
    const verdict = await this.filter.evaluate(ip, false);
    return {
      ip,
      isLoopback: isLoopback(ip),
      rule,
      allow: verdict.allow,
      reason: verdict.reason,
    };
  }
}
