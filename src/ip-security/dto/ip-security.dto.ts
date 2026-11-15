import { IsEnum, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { IpRuleMode } from '../entities/ip-rule.entity';

const IP_PATTERN = /^[0-9a-fA-F:.]{3,64}(\/\d{1,2})?$/;

export class CreateIpRuleDto {
  @IsString()
  @Length(3, 64, { message: 'IP 或网段长度不合法' })
  @Matches(IP_PATTERN, { message: '格式应为 1.2.3.4 或 10.0.0.0/8' })
  pattern: string;

  @IsEnum(IpRuleMode, { message: 'mode 只能是 black 或 white' })
  mode: IpRuleMode;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  note?: string;
}

export class UpdateIpRuleDto {
  /** 改 mode 就是「黑名单转白名单」的操作 */
  @IsOptional()
  @IsEnum(IpRuleMode, { message: 'mode 只能是 black 或 white' })
  mode?: IpRuleMode;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  note?: string;
}

export class UpdateIpFilterSettingsDto {
  @IsOptional()
  @IsIn([0, 1, true, false], { message: '只能是 true/false' })
  blacklistEnabled?: boolean | number;

  @IsOptional()
  @IsIn([0, 1, true, false], { message: '只能是 true/false' })
  whitelistEnabled?: boolean | number;
}

export class ListIpRuleQueryDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 50;

  @IsOptional()
  @IsEnum(IpRuleMode)
  mode?: IpRuleMode;

  @IsOptional()
  @IsString()
  q?: string;
}

export class ListRequestQueryDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  ip?: string;

  /** '1' 只看被拦截的请求 */
  @IsOptional()
  @IsString()
  onlyBlocked?: string;
}

export class RequestStatsQueryDto {
  @IsOptional()
  @Type(() => Number)
  days?: number = 7;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 50;
}
