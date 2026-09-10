import { Body, Controller, HttpCode, Logger, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { GenerateVietQrDto } from './dto/generate-vietqr.dto';
import { VietQrWebhookDto } from './dto/webhook.dto';
import { PaymentsService } from './payments.service';
import { WebhookHmacGuard } from './hmac.guard';

@Controller('api/v1/cloud/payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly payments: PaymentsService) {}

  /** POST /api/v1/cloud/payments/vietqr/generate */
  @Post('vietqr/generate')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'CASHIER')
  async generate(@Body() dto: GenerateVietQrDto) {
    return this.payments.generateVietQr(dto);
  }

  /**
   * POST /api/v1/cloud/payments/vietqr/webhook
   *
   * Public trên Internet — chỉ được bảo vệ bởi chữ ký HMAC.
   * Luôn trả 200 để cổng thanh toán không retry vô hạn.
   */
  @Post('vietqr/webhook')
  @HttpCode(200)
  @UseGuards(WebhookHmacGuard)
  async webhook(@Body() dto: VietQrWebhookDto, @Req() req: Request) {
    // Guard đã chạy xong nên tới đây chữ ký chắc chắn hợp lệ.
    return this.payments.handleWebhook(dto, req.body, true);
  }
}
