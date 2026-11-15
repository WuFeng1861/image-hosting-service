import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequestLog } from './entities/request-log.entity';

interface LogEntry {
  ip: string;
  method: string;
  path: string;
  status: number;
  blocked: number;
  userAgent: string;
}

/**
 * 访问记录：内存队列 + 批量插入。
 * SQLite 是单写者，每个请求 insert 一次会和发信队列抢锁，
 * 所以攒批（最多 100 条或 2 秒）再落库。
 */
@Injectable()
export class RequestLogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RequestLogService.name);

  private buffer: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  private readonly MAX_BUFFER = 100;
  private readonly FLUSH_MS = 2000;
  private readonly CLEANUP_MS = 30 * 60 * 1000;

  readonly enabled = process.env.REQUEST_LOG_ENABLED !== 'false';
  private readonly retentionDays = Math.max(
    Number(process.env.REQUEST_LOG_RETENTION_DAYS) || 7,
    1,
  );

  constructor(
    @InjectRepository(RequestLog)
    private readonly repo: Repository<RequestLog>,
  ) {}

  onModuleInit(): void {
    this.flushTimer = setInterval(() => void this.flush(), this.FLUSH_MS);
    this.flushTimer.unref?.();

    this.cleanupTimer = setInterval(() => void this.cleanup(), this.CLEANUP_MS);
    this.cleanupTimer.unref?.();

    void this.cleanup();
    this.logger.log(
      `访问记录：${this.enabled ? '开启' : '关闭'}，保留 ${this.retentionDays} 天`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await this.flush();
  }

  record(entry: LogEntry): void {
    if (!this.enabled) return;
    this.buffer.push(entry);
    if (this.buffer.length >= this.MAX_BUFFER) void this.flush();
  }

  async flush(): Promise<void> {
    if (!this.buffer.length) return;
    const rows = this.buffer.splice(0, this.buffer.length);
    try {
      await this.repo.insert(rows);
    } catch (e) {
      // 写失败不要影响业务，丢掉这一批并记一条
      this.logger.warn(`访问记录批量写入失败（丢弃 ${rows.length} 条）：${(e as Error).message}`);
    }
  }

  async cleanup(): Promise<void> {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
    try {
      const r = await this.repo
        .createQueryBuilder()
        .delete()
        .where('created_at < :cutoff', { cutoff })
        .execute();
      if (r.affected) this.logger.log(`清理过期访问记录 ${r.affected} 条`);
    } catch (e) {
      this.logger.warn(`清理访问记录失败：${(e as Error).message}`);
    }
  }

  /* ------------------------- 查询 ------------------------- */

  async list(query: { page?: number; limit?: number; ip?: string; onlyBlocked?: string }) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 200);

    const qb = this.repo.createQueryBuilder('l');
    if (query.ip) qb.andWhere('l.ip = :ip', { ip: query.ip.trim() });
    if (query.onlyBlocked === '1' || query.onlyBlocked === 'true') {
      qb.andWhere('l.blocked = 1');
    }

    const [items, total] = await qb
      .orderBy('l.created_at', 'DESC')
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

  /** 按 IP 聚合：前端「可疑 IP」列表直接用这个 */
  async stats(query: { days?: number; limit?: number }) {
    const days = Math.min(Math.max(Number(query.days) || 7, 1), 90);
    const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const sinceStr =
      `${since.getFullYear()}-${pad(since.getMonth() + 1)}-${pad(since.getDate())} ` +
      `${pad(since.getHours())}:${pad(since.getMinutes())}:${pad(since.getSeconds())}`;

    const rows: Array<{
      ip: string;
      total: number;
      blocked: number;
      lastSeen: string;
      lastPath: string;
    }> = await this.repo.query(
      `SELECT ip,
              COUNT(*) AS total,
              SUM(blocked) AS blocked,
              MAX(created_at) AS lastSeen,
              (SELECT path FROM request_logs l2 WHERE l2.ip = l1.ip ORDER BY created_at DESC LIMIT 1) AS lastPath
         FROM request_logs l1
        WHERE created_at >= ?
        GROUP BY ip
        ORDER BY total DESC
        LIMIT ?`,
      [sinceStr, limit],
    );

    return {
      days,
      total: rows.reduce((s, r) => s + Number(r.total), 0),
      items: rows.map((r) => ({
        ip: r.ip,
        total: Number(r.total),
        blocked: Number(r.blocked ?? 0),
        lastSeen: r.lastSeen,
        lastPath: r.lastPath,
      })),
    };
  }
}
