import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IpFilterSettings } from './entities/ip-filter-settings.entity';
import { IpRule, IpRuleMode } from './entities/ip-rule.entity';
import { CreateIpRuleDto, UpdateIpRuleDto, UpdateIpFilterSettingsDto } from './dto/ip-security.dto';
import { isLoopback, isValidPattern, matchPattern, normalizeIp } from './ip.util';

export interface IpVerdict {
  allow: boolean;
  reason: 'ok' | 'blacklist' | 'whitelist' | 'loopback' | 'admin-scope' | 'disabled';
  ruleId?: number;
  pattern?: string;
}

/**
 * 规则判定 + 规则/开关的增删改。
 * 规则表很小（几十条），整体缓存在内存里，每 30 秒或写操作后刷新，
 * 避免每个请求查一次库。
 */
@Injectable()
export class IpFilterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IpFilterService.name);

  private rules: IpRule[] = [];
  private settings: IpFilterSettings = Object.assign(new IpFilterSettings(), {
    id: 1,
    blacklistEnabled: 1,
    whitelistEnabled: 0,
  });
  private loadedAt = 0;
  private readonly TTL_MS = 30_000;

  /** 命中计数先攒内存，定时批量写回，避免每请求一次写 */
  private hitBuffer = new Map<number, number>();
  private hitTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(IpRule)
    private readonly ruleRepo: Repository<IpRule>,
    @InjectRepository(IpFilterSettings)
    private readonly settingsRepo: Repository<IpFilterSettings>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSettings();
    await this.refresh();

    this.hitTimer = setInterval(() => void this.flushHits(), 30_000);
    this.hitTimer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.hitTimer) clearInterval(this.hitTimer);
    await this.flushHits();
  }

  private async ensureSettings(): Promise<void> {
    const existing = await this.settingsRepo.findOne({ where: { id: 1 } });
    if (!existing) {
      await this.settingsRepo.save(
        this.settingsRepo.create({ id: 1, blacklistEnabled: 1, whitelistEnabled: 0 }),
      );
      this.logger.log('初始化 IP 过滤开关（黑名单开、白名单关）');
    }
  }

  async refresh(): Promise<void> {
    this.rules = await this.ruleRepo.find();
    const s = await this.settingsRepo.findOne({ where: { id: 1 } });
    if (s) this.settings = s;
    this.loadedAt = Date.now();
  }

  private async maybeReload(): Promise<void> {
    if (Date.now() - this.loadedAt > this.TTL_MS) await this.refresh();
  }

  /* ------------------------- 判定 ------------------------- */

  /**
   * @param ip       已规范化的客户端 IP
   * @param isAdmin  是否管理端接口（scope=business 时放行）
   */
  async evaluate(ip: string, isAdmin: boolean): Promise<IpVerdict> {
    if (process.env.IP_FILTER_DISABLED === 'true') {
      return { allow: true, reason: 'disabled' };
    }

    await this.maybeReload();
    const clientIp = normalizeIp(ip);

    // 管理端默认不受过滤，避免把自己锁在外面；要全站过滤设 IP_FILTER_SCOPE=all
    const scope = (process.env.IP_FILTER_SCOPE || 'business').toLowerCase();
    if (scope !== 'all' && isAdmin) {
      return { allow: true, reason: 'admin-scope' };
    }

    // 回环例外：Nginx / pm2 / 健康检查都从 127.0.0.1 来
    if ((process.env.IP_ALLOW_LOOPBACK || 'true') === 'true' && isLoopback(clientIp)) {
      return { allow: true, reason: 'loopback' };
    }

    // 黑名单优先：命中即拒
    if (Number(this.settings.blacklistEnabled) === 1) {
      const hit = this.rules.find(
        (r) => r.mode === IpRuleMode.BLACK && matchPattern(clientIp, r.pattern),
      );
      if (hit) {
        this.countHit(hit.id);
        return { allow: false, reason: 'blacklist', ruleId: hit.id, pattern: hit.pattern };
      }
    }

    // 白名单：开启且非空时，只放行命中项
    if (Number(this.settings.whitelistEnabled) === 1) {
      const whiteRules = this.rules.filter((r) => r.mode === IpRuleMode.WHITE);
      if (whiteRules.length > 0) {
        const hit = whiteRules.find((r) => matchPattern(clientIp, r.pattern));
        if (!hit) {
          return { allow: false, reason: 'whitelist' };
        }
        this.countHit(hit.id);
      }
    }

    return { allow: true, reason: 'ok' };
  }

  private countHit(ruleId: number): void {
    this.hitBuffer.set(ruleId, (this.hitBuffer.get(ruleId) ?? 0) + 1);
  }

  private async flushHits(): Promise<void> {
    if (!this.hitBuffer.size) return;
    const entries = [...this.hitBuffer.entries()];
    this.hitBuffer.clear();

    const now = new Date();
    for (const [id, n] of entries) {
      await this.ruleRepo
        .createQueryBuilder()
        .update(IpRule)
        .set({ hitCount: () => `hit_count + ${n}`, lastHitAt: now })
        .where('id = :id', { id })
        .execute()
        .catch(() => undefined);
    }
  }

  /* ------------------------- 规则管理 ------------------------- */

  async listRules(query: { page?: number; limit?: number; mode?: IpRuleMode; q?: string }) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

    const qb = this.ruleRepo.createQueryBuilder('r');
    if (query.mode) qb.andWhere('r.mode = :mode', { mode: query.mode });
    if (query.q) qb.andWhere('(r.pattern LIKE :q OR r.note LIKE :q)', { q: `%${query.q}%` });

    const [items, total] = await qb
      .orderBy('r.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items,
      meta: {
        totalItems: total,
        itemCount: items.length,
        itemsPerPage: limit,
        totalPages: Math.ceil(total / limit) || 1,
        currentPage: page,
      },
    };
  }

  async createRule(dto: CreateIpRuleDto): Promise<IpRule> {
    const pattern = normalizeIp(dto.pattern);
    if (!isValidPattern(pattern)) throw new ConflictException('IP / 网段格式不正确');

    const exists = await this.ruleRepo.findOne({ where: { pattern, mode: dto.mode } });
    if (exists) throw new ConflictException('该规则已存在');

    const saved = await this.ruleRepo.save(
      this.ruleRepo.create({ pattern, mode: dto.mode, note: dto.note ?? null }),
    );
    await this.refresh();
    this.logger.warn(`[AUDIT] 新增 IP 规则 ${dto.mode} ${pattern}`);
    return saved;
  }

  /** 传 mode=white 即「黑名单转白名单」 */
  async updateRule(id: number, dto: UpdateIpRuleDto): Promise<IpRule> {
    const rule = await this.ruleRepo.findOne({ where: { id } });
    if (!rule) throw new ConflictException(`规则 ${id} 不存在`);

    if (dto.mode && dto.mode !== rule.mode) {
      const dup = await this.ruleRepo.findOne({ where: { pattern: rule.pattern, mode: dto.mode } });
      if (dup) throw new ConflictException('目标名单里已有相同规则');
      this.logger.warn(`[AUDIT] IP 规则 ${rule.pattern} 从 ${rule.mode} 改为 ${dto.mode}`);
      rule.mode = dto.mode;
    }
    if (dto.note !== undefined) rule.note = dto.note;

    const saved = await this.ruleRepo.save(rule);
    await this.refresh();
    return saved;
  }

  async removeRule(id: number): Promise<void> {
    const rule = await this.ruleRepo.findOne({ where: { id } });
    if (!rule) return;
    await this.ruleRepo.remove(rule);
    await this.refresh();
    this.logger.warn(`[AUDIT] 删除 IP 规则 ${rule.mode} ${rule.pattern}`);
  }

  async getSettings(): Promise<{ blacklistEnabled: boolean; whitelistEnabled: boolean }> {
    await this.maybeReload();
    return {
      blacklistEnabled: Number(this.settings.blacklistEnabled) === 1,
      whitelistEnabled: Number(this.settings.whitelistEnabled) === 1,
    };
  }

  async updateSettings(dto: UpdateIpFilterSettingsDto) {
    const s = (await this.settingsRepo.findOne({ where: { id: 1 } })) ?? this.settings;
    if (dto.blacklistEnabled !== undefined) s.blacklistEnabled = dto.blacklistEnabled ? 1 : 0;
    if (dto.whitelistEnabled !== undefined) s.whitelistEnabled = dto.whitelistEnabled ? 1 : 0;
    await this.settingsRepo.save(s);
    await this.refresh();
    this.logger.warn(
      `[AUDIT] IP 过滤开关：黑名单=${s.blacklistEnabled ? '开' : '关'} 白名单=${s.whitelistEnabled ? '开' : '关'}`,
    );
    return this.getSettings();
  }

  /** 给访问统计用：查某个 IP 当前命中的规则 */
  findRuleFor(ip: string): { id: number; mode: IpRuleMode; pattern: string } | null {
    const hit = this.rules.find((r) => matchPattern(ip, r.pattern));
    return hit ? { id: hit.id, mode: hit.mode, pattern: hit.pattern } : null;
  }
}
