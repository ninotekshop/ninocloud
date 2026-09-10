import { Module } from '@nestjs/common';
import { PaymentsGateway } from './payments.gateway';

@Module({
  providers: [PaymentsGateway],
  exports: [PaymentsGateway],
})
export class RealtimeModule {}
