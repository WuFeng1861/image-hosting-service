import { Controller, HttpCode, Ip, Logger, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { SystemService } from './system.service';

@Controller('system')
export class SystemController {
  private readonly logger = new Logger(SystemController.name);

  constructor(private readonly systemService: SystemService) {}

  /** 重启：由全局 AdminGuard 保护（需要管理员登录），不再用独立口令 */
  @Post('restart')
  @HttpCode(202)
  async restart(
    @Req() req: Request & { admin?: { username: string } },
    @Ip() ip: string,
  ): Promise<{ message: string }> {
    this.logger.warn(`[AUDIT] 重启请求：${req.admin?.username ?? 'admin'} 来源 ${ip}`);
    setTimeout(() => this.systemService.restart(), 200);
    return { message: 'restart requested' };
  }
}
