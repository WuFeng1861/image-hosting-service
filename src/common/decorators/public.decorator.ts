import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** 打上这个装饰器的路由跳过 ApiKeyGuard（只给健康检查用） */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
