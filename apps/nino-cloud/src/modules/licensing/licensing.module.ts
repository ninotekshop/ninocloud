import { Module } from '@nestjs/common';
import { LicensingController } from './licensing.controller';

@Module({ controllers: [LicensingController] })
export class LicensingModule {}
