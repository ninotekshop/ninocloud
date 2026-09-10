import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SyncBatchDto } from './dto/sync-batch.dto';
import { SyncService } from './sync.service';

@Controller('api/v1/cloud/sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /** POST /api/v1/cloud/sync/transactions */
  @Post('transactions')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'CASHIER')
  async transactions(@Body() dto: SyncBatchDto) {
    return this.sync.ingestBatch(dto);
  }
}
