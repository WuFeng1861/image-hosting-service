import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AdminService } from '../admin.service';

/** 从 Authorization: Bearer xxx 或 cookie admin_token 中取凭证 */
export function extractToken(req: {
  headers?: Record<string, unknown>;
}): string | null {
  const auth = String(req.headers?.['authorization'] ?? '');
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();

  const cookie = String(req.headers?.['cookie'] ?? '');
  const hit = cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('admin_token='));
  if (hit) return decodeURIComponent(hit.slice('admin_token='.length));

  return null;
}

/**
 * 管理端守卫：默认拒绝，@Public() 的路由放行。
 *
 * 注意默认拒绝的取舍 —— 新增接口如果忘了标 @Public，会被要求登录（安全侧出错）；
 * 反过来把管理接口误标 @Public 才是事故，所以宁可默认严格。
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly adminService: AdminService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const admin = await this.adminService.validateToken(extractToken(request));
    if (!admin) {
      throw new UnauthorizedException('需要管理员登录');
    }

    request.admin = admin;
    return true;
  }
}
