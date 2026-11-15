import { Injectable, Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { IpFilterService } from '../ip-filter.service';
import { RequestLogService } from '../request-log.service';
import { normalizeIp } from '../ip.util';

/**
 * 每个请求做两件事：
 *   1) 收集来源 IP（配合 app.set('trust proxy', 1) 取到真实客户端 IP）
 *   2) 命中黑白名单则直接 403
 *
 * 只对 /api/* 生效；/images/* 静态资源不拦（图床外链要靠它）。
 */
@Injectable()
export class IpSecurityMiddleware {
  private readonly logger = new Logger(IpSecurityMiddleware.name);

  constructor(
    private readonly filter: IpFilterService,
    private readonly logs: RequestLogService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const ip = normalizeIp(req.ip || req.socket?.remoteAddress || '');
    const fullPath = String(req.originalUrl || req.url || '');
    const path = fullPath.split('?')[0];
    const method = req.method;
    const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 255);

    res.locals.ipBlocked = 0;

    // 健康检查探活很频繁，默认不记
    const skipHealth =
      (process.env.REQUEST_LOG_SKIP_HEALTH || 'true') === 'true' && path === '/api/health';

    if (!skipHealth) {
      res.on('finish', () => {
        this.logs.record({
          ip,
          method,
          path,
          status: res.statusCode,
          blocked: Number(res.locals.ipBlocked) || 0,
          userAgent,
        });
      });
    }

    if (!path.startsWith('/api/')) return next();

    try {
      const verdict = await this.filter.evaluate(ip, path.startsWith('/api/admin'));
      if (!verdict.allow) {
        res.locals.ipBlocked = 1;
        this.logger.warn(
          `[AUDIT] 拦截 ${ip} ${method} ${path}（${verdict.reason}${verdict.pattern ? ` ${verdict.pattern}` : ''}）`,
        );
        // 同时给出两套服务的字段习惯：email-server 用 statusCode/message，
        // image-hosting 用 success/statusCode/message，前端按各自的判法都能读到
        res.status(403).json({
          success: false,
          code: 403,
          statusCode: 403,
          message: '来源 IP 已被限制访问',
          error: 'Forbidden',
          data: null,
        });
        return;
      }
    } catch (e) {
      // 过滤逻辑异常不能把服务打死，放行并记日志
      this.logger.error(`IP 过滤异常，已放行：${(e as Error).message}`);
    }

    next();
  }
}
