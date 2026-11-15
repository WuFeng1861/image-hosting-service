import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { AdminUser } from './entities/admin-user.entity';
import { AdminSession } from './entities/admin-session.entity';
import { ChangeCredentialsDto, LoginDto, SetupAdminDto } from './dto/admin.dto';
import { checkPasswordStrength, hashPassword, verifyPassword } from './password.util';

export interface LoginResult {
  token: string;
  expiresAt: string;
  username: string;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  /** 会话有效期 12 小时 */
  private readonly SESSION_TTL_MS = 12 * 60 * 60 * 1000;
  /** 登录失败限流：同一 IP / 同一用户名，15 分钟 5 次 */
  private readonly MAX_ATTEMPTS = 5;
  private readonly ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    @InjectRepository(AdminUser)
    private readonly users: Repository<AdminUser>,
    @InjectRepository(AdminSession)
    private readonly sessions: Repository<AdminSession>,
  ) {}

  /* ---------------- 初始化 ---------------- */

  async isInitialized(): Promise<boolean> {
    return (await this.users.count()) > 0;
  }

  /**
   * 首次设置账号密码。只允许在「一个管理员都没有」时调用，
   * 之后 409 —— 否则任何人访问都能重置管理员。
   */
  async setup(dto: SetupAdminDto, ip: string): Promise<LoginResult> {
    if (await this.isInitialized()) {
      throw new ConflictException('管理员已初始化，请直接登录');
    }

    const weak = checkPasswordStrength(dto.password);
    if (weak) throw new HttpException(weak, 400);

    const admin = this.users.create({
      username: dto.username.trim(),
      passwordHash: hashPassword(dto.password),
    });
    await this.users.save(admin);

    this.logger.warn(`[AUDIT] 初始化管理员 ${admin.username}，来源 ${ip}`);
    return this.createSession(admin, ip);
  }

  /* ---------------- 登录 / 登出 ---------------- */

  async login(dto: LoginDto, ip: string): Promise<LoginResult> {
    this.assertNotLocked(`ip:${ip}`);
    this.assertNotLocked(`user:${dto.username}`);

    const admin = await this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.username = :username', { username: dto.username })
      .getOne();

    const ok = !!admin && verifyPassword(dto.password, admin.passwordHash);
    if (!ok) {
      this.recordFailure(`ip:${ip}`);
      this.recordFailure(`user:${dto.username}`);
      this.logger.warn(`[AUDIT] 管理员登录失败 ${dto.username} 来源 ${ip}`);
      // 不区分「用户不存在」和「密码错」
      throw new UnauthorizedException('用户名或密码错误');
    }

    this.clearFailure(`ip:${ip}`);
    this.clearFailure(`user:${dto.username}`);
    this.logger.log(`[AUDIT] 管理员登录成功 ${admin.username} 来源 ${ip}`);
    return this.createSession(admin, ip);
  }

  async logout(token: string): Promise<void> {
    if (!token) return;
    await this.sessions.delete({ tokenHash: sha256(token) });
  }

  async changeCredentials(
    adminId: number,
    dto: ChangeCredentialsDto,
    ip: string,
  ): Promise<LoginResult> {
    const admin = await this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.id = :id', { id: adminId })
      .getOne();

    if (!admin) throw new UnauthorizedException('会话失效，请重新登录');
    if (!verifyPassword(dto.currentPassword, admin.passwordHash)) {
      throw new UnauthorizedException('当前密码不正确');
    }

    if (dto.newUsername && dto.newUsername.trim() !== admin.username) {
      const name = dto.newUsername.trim();
      const exists = await this.users.findOne({ where: { username: name } });
      if (exists) throw new ConflictException('该用户名已被占用');
      admin.username = name;
    }

    if (dto.newPassword) {
      const weak = checkPasswordStrength(dto.newPassword);
      if (weak) throw new HttpException(weak, 400);
      admin.passwordHash = hashPassword(dto.newPassword);
    }

    await this.users.save(admin);

    // 改完凭据让所有旧会话失效，再发一个新的给当前浏览器
    await this.sessions.delete({ adminId });
    this.logger.warn(`[AUDIT] 管理员凭据已修改 ${admin.username} 来源 ${ip}`);
    return this.createSession(admin, ip);
  }

  /* ---------------- 会话校验 ---------------- */

  async validateToken(token: string | null | undefined): Promise<AdminUser | null> {
    if (!token) return null;
    const tokenHash = sha256(token);

    const session = await this.sessions.findOne({ where: { tokenHash } });
    if (!session) return null;

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      await this.sessions.delete({ tokenHash }).catch(() => undefined);
      return null;
    }

    const admin = await this.users.findOne({ where: { id: session.adminId } });
    return admin ?? null;
  }

  private async createSession(admin: AdminUser, ip: string): Promise<LoginResult> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.SESSION_TTL_MS);

    await this.sessions.save(
      this.sessions.create({
        tokenHash: sha256(token),
        adminId: admin.id,
        expiresAt,
        createdIp: ip,
      }),
    );

    // 顺手清理过期会话，避免表无限增长
    await this.sessions
      .createQueryBuilder()
      .delete()
      .where('expires_at <= :now', { now: new Date() })
      .execute()
      .catch(() => undefined);

    return { token, expiresAt: expiresAt.toISOString(), username: admin.username };
  }

  /* ---------------- 登录限流 ---------------- */

  private assertNotLocked(key: string): void {
    const entry = this.attempts.get(key);
    if (!entry) return;
    if (entry.resetAt <= Date.now()) {
      this.attempts.delete(key);
      return;
    }
    if (entry.count >= this.MAX_ATTEMPTS) {
      const mins = Math.ceil((entry.resetAt - Date.now()) / 60000);
      throw new HttpException(`登录尝试过于频繁，请 ${mins} 分钟后再试`, 429);
    }
  }

  private recordFailure(key: string): void {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + this.ATTEMPT_WINDOW_MS });
      return;
    }
    entry.count += 1;
  }

  private clearFailure(key: string): void {
    this.attempts.delete(key);
  }
}
