// =====================================================================
//  NINOTEK CLOUD — Bộ lọc lỗi theo chuẩn RFC 9457 (Problem Details)
// =====================================================================
//  Mọi lỗi trả về client đều có cùng một hình dạng, đúng như khai trong
//  openapi.yaml. Client C# và Dart sinh code từ contract đó nên hình dạng
//  lệch sẽ làm chúng không parse được lỗi.
//
//  Ở production, KHÔNG rò rỉ chi tiết lỗi nội bộ (câu SQL, stack trace) ra
//  ngoài — chúng nói cho kẻ tấn công biết cấu trúc hệ thống.
// =====================================================================

import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const traceId = randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Lỗi hệ thống';
    let detail: string | undefined;
    let extras: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        title = body;
      } else if (body && typeof body === 'object') {
        const obj = body as Record<string, unknown>;
        // Lỗi validate của class-validator trả `message` là mảng chuỗi
        const message = obj.message;
        title = Array.isArray(message)
          ? 'Dữ liệu gửi lên không hợp lệ'
          : String(message ?? obj.error ?? title);
        if (Array.isArray(message)) extras = { errors: message };
      }
    } else if (exception instanceof Error) {
      detail = this.isProduction ? undefined : exception.message;
      this.logger.error(
        `[${traceId}] ${request.method} ${request.url} — ${exception.message}`,
        exception.stack,
      );
    }

    response
      .status(status)
      .type('application/problem+json')
      .json({
        type: `https://ninotek.vn/errors/${status}`,
        title,
        status,
        ...(detail ? { detail } : {}),
        instance: request.url,
        traceId,
        ...extras,
      });
  }
}
