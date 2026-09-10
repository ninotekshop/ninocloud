import { Body, Controller, Get, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

@Controller('licenses')
export class LicensingController {
  constructor(private readonly config: ConfigService) {}

  @Get('revocations.json')
  async getManifest(): Promise<Record<string, unknown>> {
    try {
      return JSON.parse(await readFile(this.config.getOrThrow<string>('licensing.manifestPath'), 'utf8'));
    } catch {
      return { payload: { revoked: [], updated_at: new Date().toISOString().slice(0, 10) }, signature: '' };
    }
  }

  @Post('revocations.json')
  @HttpCode(204)
  async publishManifest(@Headers('authorization') authorization: string, @Body() manifest: Record<string, unknown>): Promise<void> {
    const validAuthorization = `Bearer ${this.config.getOrThrow<string>('licensing.revocationToken')}`;
    if (authorization !== validAuthorization) throw new UnauthorizedException('License revocation token không hợp lệ.');
    const expected = `Bearer ${this.config.getOrThrow<string>('licensing.revocationToken')}`;
    if (authorization !== expected) throw new UnauthorizedException('License revocation token không hợp lệ.');
    if (!manifest || typeof manifest.payload !== 'object' || typeof manifest.signature !== 'string' || !manifest.signature) {
      throw new Error('Manifest thu hồi không hợp lệ.');
    }
    const filePath = this.config.getOrThrow<string>('licensing.manifestPath');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf8');
  }
}
