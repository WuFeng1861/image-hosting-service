import { ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
// helmet 7 的类型声明是 ESM 风格，CJS 构建下直接 require 最稳
// eslint-disable-next-line @typescript-eslint/no-var-requires
const helmet = require('helmet');
import * as express from 'express';
import { extname, isAbsolute, join } from 'path';
import { AppModule } from './app.module';
import { AdminGuard } from './admin/guards/admin.guard';
import { AdminService } from './admin/admin.service';
import { IpSecurityMiddleware } from './ip-security/middleware/ip-security.middleware';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { EXT_TO_MIME } from './images/image-type.util';

/** 极简按 IP 限流：上传接口不需要完整限流组件 */
function simpleRateLimit(options: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > options.max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ code: 429, message: '上传过于频繁，请稍后再试', data: null });
    }
    return next();
  };
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);

  // 单层反代 = 1；双层（老机器 Nginx → 新机器 Nginx）设 TRUST_PROXY=2
  {
    const hops = Number(process.env.TRUST_PROXY ?? 1);
    app.set('trust proxy', Number.isFinite(hops) && hops >= 0 ? hops : 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // 图片要被外站 <img> 引用
    }),
  );

  // IP 收集 + 黑白名单过滤
  const ipSecurity = app.get(IpSecurityMiddleware);
  app.use((req, res, next) => {
    ipSecurity.use(req, res, next).catch(next);
  });

  app.useBodyParser('json', { limit: '256kb' });
  app.useBodyParser('urlencoded', { limit: '256kb', extended: true });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // 全局守卫：默认要求管理员登录，@Public() 只放行健康检查与登录相关接口
  app.useGlobalGuards(new AdminGuard(app.get(Reflector), app.get(AdminService)));
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  app.enableCors({
    origin: (configService.get<string>('CORS_ORIGINS') || '*')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  const uploadDir = configService.get<string>('UPLOAD_DIR') || 'uploadImage';
  const uploadPath = isAbsolute(uploadDir) ? uploadDir : join(process.cwd(), uploadDir);

  // 先按扩展名白名单拦截：不在表内的一律 404，永远不进 static
  app.use('/images', (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!EXT_TO_MIME[extname(req.path).toLowerCase()]) {
      return res.status(404).end();
    }
    return next();
  });

  app.use(
    '/images',
    express.static(uploadPath, {
      maxAge: '1y',
      index: false,
      dotfiles: 'deny',
      fallthrough: false,
      setHeaders: (res, filePath) => {
        const type = EXT_TO_MIME[extname(filePath).toLowerCase()];
        if (!type) {
          res.statusCode = 404;
          return;
        }
        // Content-Type 由扩展名决定，绝不跟着文件内容走
        res.setHeader('Content-Type', type);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    }),
  );

  // 上传单独限流：60 次 / 10 分钟 / IP
  app.use(
    '/api/images/upload',
    simpleRateLimit({ windowMs: 10 * 60 * 1000, max: 60 }),
  );

  const port = Number(configService.get<string>('PORT') || 5888);
  const host = configService.get<string>('HOST') || '127.0.0.1';
  await app.listen(port, host);

  console.log(
    `[image-hosting] http://${host}:${port}/api  upload=${uploadPath} env=${process.env.NODE_ENV || 'development'}`,
  );
}

bootstrap();
