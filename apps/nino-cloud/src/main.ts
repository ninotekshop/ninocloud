// =====================================================================
//  NINOTEK CLOUD — Điểm khởi động
// =====================================================================

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as dns from 'dns';

dns.setDefaultResultOrder('ipv4first');

import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // BẮT BUỘC cho webhook: chữ ký HMAC phải tính trên byte gốc.
    // JSON.stringify(req.body) KHÔNG tái lập được byte gốc — thứ tự khoá,
    // khoảng trắng và cách escape unicode đều có thể khác, làm chữ ký trượt.
    rawBody: true,
    logger: ['error', 'warn', 'log'],
  });

  const config = app.get(ConfigService);
  const isProduction = config.get<string>('nodeEnv') === 'production';

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,           // loại bỏ field lạ thay vì âm thầm nhận
      forbidNonWhitelisted: true, // báo lỗi rõ ràng khi client gửi field lạ
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new ProblemDetailsFilter(isProduction));

  app.enableCors({
    origin: isProduction ? config.get<string>('corsOrigin') : true,
    credentials: true,
  });

  // Tắt máy êm: xử lý nốt request đang chạy rồi mới đóng pool DB.
  app.enableShutdownHooks();

  const port = config.get<number>('port', 3000);
  await app.listen(port, '0.0.0.0');

  logger.log(`NinoCloud đang chạy tại http://0.0.0.0:${port}`);
  logger.log(`WebSocket thanh toán: ws://0.0.0.0:${port}/ws/payments`);
  logger.log(`Môi trường: ${config.get<string>('nodeEnv')}`);
}

void bootstrap();
