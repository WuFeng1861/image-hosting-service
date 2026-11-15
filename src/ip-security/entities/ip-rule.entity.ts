import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum IpRuleMode {
  BLACK = 'black',
  WHITE = 'white',
}

/** IP 黑白名单规则：支持单 IP 与 IPv4 CIDR（如 10.0.0.0/8） */
@Entity('ip_rules')
@Index('idx_ip_rules_pattern', ['pattern', 'mode'], { unique: true })
export class IpRule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 64 })
  pattern: string;

  @Column({ type: 'varchar', length: 10 })
  mode: IpRuleMode;

  @Column({ length: 255, nullable: true })
  note: string;

  /** 命中次数，便于判断规则是否还有用 */
  @Column({ name: 'hit_count', type: 'int', default: 0 })
  hitCount: number;

  @Column({ name: 'last_hit_at', type: 'datetime', nullable: true })
  lastHitAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
