import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';

/**
 * 项目心跳上报（给 wufeng98.cn/projectManagerApi 的项目面板用）
 *
 * 为什么默认值改过又改回来：
 *  - 原实现把数据库/重启口令当 projectPassword 每 60 秒往上报一次（email 那份还是硬编码在源码里），
 *    等于定时把凭据外发，所以上一版把它默认关掉了；
 *  - 但项目面板需要心跳，关掉等于面板失真。现在改成：
 *      · 默认开启（只有显式写 REPORT_ENABLED=false 才关）
 *      · 口令从环境变量读（REPORT_PASSWORD，兼容旧的 SERVER_PASSWORD），不再硬编码
 *      · 日志降噪：前 2 次失败打 warn，之后降为 debug；不再打印响应体
 *
 * 上报内容只有：服务名/端口/IP/运行时长/启动时间，不含任何密钥。
 */
@Injectable()
export class ProjectReportingService implements OnModuleInit {
  private readonly logger = new Logger(ProjectReportingService.name);

  private readonly startTime = new Date();
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private failures = 0;
  private firstSuccess = false;

  private readonly enabled = process.env.REPORT_ENABLED !== 'false';
  private readonly endpoint =
    process.env.REPORT_ENDPOINT || 'https://wufeng98.cn/projectManagerApi/projects';
  private readonly intervalMs = Number(process.env.REPORT_INTERVAL_MS) || 60 * 1000;
  private readonly maxBackoffMs = 15 * 60 * 1000;

  /** 面板的鉴权口令：优先 REPORT_PASSWORD，兼容旧变量 SERVER_PASSWORD */
  private readonly password = process.env.REPORT_PASSWORD || process.env.SERVER_PASSWORD || '';

  private get serviceName(): string {
    return process.env.SERVICE_NAME || 'unknown-service';
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('项目上报已关闭（REPORT_ENABLED=false）');
      return;
    }

    this.logger.log(
      `项目上报已开启 → ${this.endpoint}（每 ${Math.round(this.intervalMs / 1000)} 秒，` +
        `serviceName=${this.serviceName}）`,
    );
    if (!this.password) {
      this.logger.warn('未配置 REPORT_PASSWORD，对端可能返回 401/403（不影响本服务运行）');
    }

    this.schedule(0);
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.reportStatus(), delayMs);
    this.timer.unref?.(); // 不阻止进程退出
  }

  private async reportStatus(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;

    try {
      // 面板校验 serviceRuntime 必须 > 0，而首次上报发生在启动瞬间，算出来是 0 → 直接 400。
      // 这是之前一直 400 的真正原因（不是口令、也不是端口类型）。
      const runtimeSeconds = Math.max(
        1,
        Math.floor((Date.now() - this.startTime.getTime()) / 1000),
      );

      // servicePort 默认按字符串发：原版代码就是透传 process.env.PORT（字符串），
      // 面板那边的 DTO 若写了 @IsString()，发数字会直接 400。要数字就设 REPORT_PORT_NUMBER=true
      const portRaw = process.env.PORT || '0';
      const servicePort =
        (process.env.REPORT_PORT_NUMBER || 'false') === 'true' ? Number(portRaw) : String(portRaw);

      const body: Record<string, unknown> = {
        serviceName: this.serviceName,
        serverIp: process.env.SERVER_IP || '127.0.0.1',
        servicePort,
        serviceNotes: process.env.REPORT_NOTES || this.serviceName,
        serviceRuntime: runtimeSeconds,
        serviceDescription: process.env.REPORT_DESCRIPTION || 'NestJS Service with SQLite',
        lastRestartTime: this.startTime.toISOString(),
      };
      // 空值就不发这个字段：面板把 null 当非法值时会整条上报失败
      if (process.env.REPORT_SERVICE_ID) body.serviceId = process.env.REPORT_SERVICE_ID;
      // 老面板靠 projectPassword 鉴权；没配就不发
      if (this.password) body.projectPassword = this.password;

      await axios.post(this.endpoint, body, { timeout: 5000 });

      this.failures = 0;
      if (!this.firstSuccess) {
        this.logger.log('项目心跳上报成功');
        this.firstSuccess = true;
      } else {
        this.logger.debug('项目心跳上报成功');
      }
    } catch (error) {
      this.failures += 1;

      // 只取状态码/错误码，不打完整 message（可能带内网 URL）
      const status = (error as { response?: { status?: number; data?: unknown } })?.response?.status;
      const code = (error as { code?: string })?.code ?? 'unknown';
      const detail = status ? `HTTP ${status}` : code;

      if (this.failures <= 2) {
        // 把面板返回的响应体带出来，否则 400 到底是哪个字段不合法根本没法查
        let bodyText = '';
        const respBody = (error as { response?: { data?: unknown } })?.response?.data;
        if (respBody !== undefined) {
          try {
            bodyText = ` ｜ 面板返回：${JSON.stringify(respBody).slice(0, 300)}`;
          } catch {
            bodyText = '';
          }
        }

        const hint =
          status === 401 || status === 403
            ? '口令可能不对（REPORT_PASSWORD）'
            : status === 400
              ? '请求体被拒，检查 serviceName 是否与面板项目一致、字段类型是否匹配'
              : '稍后自动重试';

        this.logger.warn(`项目心跳上报失败（${detail}，${hint}）${bodyText}`);
      } else {
        this.logger.debug(`项目心跳上报仍失败（第 ${this.failures} 次，${detail}）`);
      }
    } finally {
      this.inFlight = false;
      const backoff = Math.min(
        this.intervalMs * Math.pow(2, Math.min(this.failures, 4)),
        this.maxBackoffMs,
      );
      this.schedule(this.failures === 0 ? this.intervalMs : backoff);
    }
  }
}
