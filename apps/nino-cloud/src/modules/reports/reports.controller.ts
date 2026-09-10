import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { ReportsService } from './reports.service';

interface AuthenticatedRequest extends Request {
  user: AccessTokenPayload;
}

@Controller('api/v1/cloud/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'ADMIN')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  dashboard(@Query() query: DashboardQueryDto, @Req() request: AuthenticatedRequest) {
    return this.reports.dashboard(query, request.user);
  }

  @Get('tables/active')
  activeTables(@Query('storeId') storeId: string, @Req() request: AuthenticatedRequest) {
    return this.reports.activeTables({ storeId }, request.user);
  }
}
