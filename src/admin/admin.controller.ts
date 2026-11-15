import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { AdminService } from './admin.service';
import { ChangeCredentialsDto, LoginDto, SetupAdminDto } from './dto/admin.dto';
import { extractToken } from './guards/admin.guard';

/**
 * 管理端账号体系。前端流程建议：
 *   1) GET  /api/admin/status          → initialized=false 时进「首次设置」页
 *   2) POST /api/admin/setup           → 创建账号并直接拿到 token
 *   3) POST /api/admin/login           → 之后每次登录拿 token
 *   4) 其余管理接口带 Authorization: Bearer <token>
 *   5) POST /api/admin/change-credentials 改账号/密码（会让其它会话失效）
 */
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /** 公开：前端据此决定显示「首次设置」还是「登录」 */
  @Public()
  @Get('status')
  async status() {
    return { initialized: await this.adminService.isInitialized() };
  }

  /** 公开：仅在未初始化时可用，第二次调用返回 409 */
  @Public()
  @Post('setup')
  @HttpCode(201)
  async setup(@Body() dto: SetupAdminDto, @Ip() ip: string) {
    return this.adminService.setup(dto, ip);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.adminService.login(dto, ip);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request): Promise<void> {
    await this.adminService.logout(extractToken(req) ?? '');
  }

  @Post('change-credentials')
  @HttpCode(200)
  async changeCredentials(
    @Req() req: Request & { admin?: { id: number } },
    @Body() dto: ChangeCredentialsDto,
    @Ip() ip: string,
  ) {
    return this.adminService.changeCredentials(req.admin.id, dto, ip);
  }

  @Get('me')
  me(@Req() req: Request & { admin?: { id: number; username: string } }) {
    return { id: req.admin.id, username: req.admin.username };
  }
}
