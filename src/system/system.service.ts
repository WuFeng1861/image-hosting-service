import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);

  /**
   * pm2 的 autorestart 会负责拉起。
   * 退出码用 0 而不是 999：999 会被 pm2 计入 unstable_restarts，
   * 多次重启后 pm2 会放弃拉起（errored 状态）。
   */
  async restart(): Promise<void> {
    this.logger.warn('进程即将退出，由 pm2 重新拉起');
    process.exit(0);
  }
}
