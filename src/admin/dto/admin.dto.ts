import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

export class SetupAdminDto {
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  @Length(3, 50, { message: '用户名长度 3-50' })
  username: string;

  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  @Length(8, 128, { message: '密码长度 8-128' })
  password: string;
}

export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: '用户名不能为空' })
  username: string;

  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  password: string;
}

export class ChangeCredentialsDto {
  /** 当前密码，必填，防止会话被盗后直接改密码 */
  @IsString()
  @IsNotEmpty({ message: '当前密码不能为空' })
  currentPassword: string;

  @IsOptional()
  @IsString()
  @Length(3, 50, { message: '用户名长度 3-50' })
  newUsername?: string;

  @IsOptional()
  @IsString()
  @Length(8, 128, { message: '密码长度 8-128' })
  newPassword?: string;
}
