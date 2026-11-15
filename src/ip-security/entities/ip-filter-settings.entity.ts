import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 过滤开关（单行，id 固定 1）。
 * 放数据库是为了前端能直接开关；环境变量只负责 scope / 回环例外 / 日志保留天数。
 */
@Entity('ip_filter_settings')
export class IpFilterSettings {
  @PrimaryColumn({ default: 1 })
  id: number;

  /** 黑名单总开关：命中黑名单即拒绝 */
  @Column({ name: 'blacklist_enabled', type: 'int', default: 1 })
  blacklistEnabled: number;

  /** 白名单开关：开启后只放行白名单（+回环），其余一律拒绝 */
  @Column({ name: 'whitelist_enabled', type: 'int', default: 0 })
  whitelistEnabled: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
