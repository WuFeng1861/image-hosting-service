import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * 原来只 @Catch(HttpException)：未被捕获的 Error 会走 Nest 默认处理，
 * 生产环境把堆栈和内部错误原文返回给调用方。这里补一个全捕获分支。
 * 响应体保持 { success, statusCode, message, ... }，避免前端解析出错。
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      let message: string;
      let error: string;

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        error = exception.name;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const body = exceptionResponse as { message?: unknown; error?: unknown };
        message = Array.isArray(body.message)
          ? String(body.message[0])
          : String(body.message ?? exception.message);
        error = String(body.error ?? exception.name);
      } else {
        message = exception.message;
        error = exception.name;
      }

      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(`HTTP异常: ${status} - ${message}`, exception.stack);
      } else {
        this.logger.warn(`HTTP异常: ${status} - ${message} ${request.method} ${request.url}`);
      }

      return response.status(status).json({
        success: false,
        statusCode: status,
        message,
        error,
        path: request.url,
        timestamp: new Date().toISOString(),
      });
    }

    const err = exception as Error;
    this.logger.error(
      `未捕获异常: ${request.method} ${request.url} - ${err?.message}`,
      err?.stack,
    );

    // 不把内部错误原文透出去
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: '服务器内部错误',
      error: 'Internal Server Error',
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
