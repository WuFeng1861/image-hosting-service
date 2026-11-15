import { Entity, Column, PrimaryColumn, CreateDateColumn, Index } from 'typeorm';

/**
 * 管理端会话：不透明随机 token，库里只存 sha256。
 * 相比 JWT 的好处是「改密码 / 退出」能立刻让旧凭证失效。
 */
@Entity('admin_sessions')
export class AdminSession {
  @PrimaryColumn({ name: 'token_hash', length: 64 })
  tokenHash: string;

  @Index()
  @Column({ name: 'admin_id' })
  adminId: number;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt: Date;

  @Column({ name: 'created_ip', length: 64, nullable: true })
  createdIp: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
