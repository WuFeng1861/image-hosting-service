import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

/**
 * 请求访问日志。写入走内存队列批量落库（SQLite 单写者，
 * 每请求一次写会直接 SQLITE_BUSY）。
 */
@Entity('request_logs')
@Index('idx_request_logs_ip_time', ['ip', 'createdAt'])
@Index('idx_request_logs_time', ['createdAt'])
export class RequestLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 64 })
  ip: string;

  @Column({ length: 10 })
  method: string;

  @Column({ length: 255 })
  path: string;

  @Column({ type: 'int', default: 0 })
  status: number;

  /** 被 IP 规则拦下的请求会标 1 */
  @Column({ type: 'int', default: 0 })
  blocked: number;

  @Column({ name: 'user_agent', length: 255, nullable: true })
  userAgent: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
