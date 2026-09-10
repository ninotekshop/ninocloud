import { Controller, Get, HttpCode } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  /**
   * GET /health — dùng cho load balancer và docker healthcheck.
   * Trả 503 khi mất database để LB rút node này ra khỏi vòng phục vụ.
   */
  @Get()
  async check() {
    const dbUp = await this.db.ping();
    return {
      status: dbUp ? 'ok' : 'degraded',
      database: dbUp ? 'up' : 'down',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  @HttpCode(200)
  async ready() {
    const dbUp = await this.db.ping();
    if (!dbUp) {
      // Ném để Nest trả 503 — node chưa sẵn sàng nhận traffic.
      throw new Error('Database chưa sẵn sàng');
    }
    return { ready: true };
  }
}
