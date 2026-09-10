// =====================================================================
//  NINOTEK CLOUD — WebSocket Gateway xác nhận thanh toán
// =====================================================================
//  NinoPOS mở kênh này ngay sau khi sinh mã VietQR, kèm ?order_id=<ORDER_CODE>.
//  Khi webhook ngân hàng báo về, gateway phát PAYMENT_SUCCESS và máy POS tự
//  chốt bill → mở két → in hoá đơn.
//
//  HAI ĐIỀU QUAN TRỌNG:
//
//  1. `eventId` cho phép client khử trùng lặp. Wi-Fi quán chập chờn, client
//     kết nối lại và ta phát lại sự kiện gần nhất — nếu client không lọc theo
//     eventId thì két sẽ mở hai lần và bill in trùng.
//
//  2. Kênh này KHÔNG được là đường xác nhận duy nhất. Mất Internet thì
//     WebSocket không tới. NinoPOS phải luôn giữ nút "Xác nhận đã nhận tiền"
//     thủ công — nếu không, mất mạng đồng nghĩa không chốt được bill nào.
// =====================================================================

import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { randomUUID } from 'crypto';
import { Server, Socket } from 'socket.io';

export interface PaymentSuccessData {
  orderId: string | null;
  orderCode: string;
  paymentMethod: 'VIETQR';
  amountPaid: number;
  transactionRef: string;
  gateway: string;
  paidAt: string;
  message: string;
}

/** Số sự kiện gần nhất giữ lại cho mỗi đơn, để phát lại khi client nối lại. */
const REPLAY_BUFFER_SIZE = 5;

@WebSocketGateway({
  path: '/ws/payments',
  cors: { origin: '*' },
})
export class PaymentsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(PaymentsGateway.name);

  @WebSocketServer()
  private server!: Server;

  /** orderCode → các sự kiện gần nhất, dùng để phát lại sau khi mất kết nối. */
  private readonly recentEvents = new Map<
    string,
    Array<{ event: string; eventId: string; sentAt: string; data: unknown }>
  >();

  handleConnection(@ConnectedSocket() client: Socket): void {
    const orderCode = this.readOrderCode(client);

    if (!orderCode) {
      this.logger.warn(
        `Từ chối kết nối WebSocket không có order_id (socket ${client.id})`,
      );
      client.disconnect(true);
      return;
    }

    void client.join(this.room(orderCode));
    this.logger.log(`NinoPOS đã lắng nghe thanh toán cho ${orderCode}`);

    // Phát lại sự kiện đã bỏ lỡ. Client lọc theo eventId nên phát lại an toàn.
    for (const buffered of this.recentEvents.get(orderCode) ?? []) {
      client.emit(buffered.event, buffered);
    }
  }

  handleDisconnect(@ConnectedSocket() client: Socket): void {
    const orderCode = this.readOrderCode(client);
    if (orderCode) {
      this.logger.log(`Ngắt kết nối kênh thanh toán ${orderCode}`);
    }
  }

  emitPaymentSuccess(orderCode: string, data: PaymentSuccessData): void {
    this.emit(orderCode, 'PAYMENT_SUCCESS', data);
  }

  emitPaymentExpired(orderCode: string, orderId: string | null): void {
    this.emit(orderCode, 'PAYMENT_EXPIRED', {
      orderId,
      orderCode,
      expiredAt: new Date().toISOString(),
    });
  }

  private emit(orderCode: string, event: string, data: unknown): void {
    const envelope = {
      event,
      eventId: randomUUID(),
      sentAt: new Date().toISOString(),
      data,
    };

    const buffer = this.recentEvents.get(orderCode) ?? [];
    buffer.push(envelope);
    if (buffer.length > REPLAY_BUFFER_SIZE) buffer.shift();
    this.recentEvents.set(orderCode, buffer);

    this.server?.to(this.room(orderCode)).emit(event, envelope);
    this.logger.log(`Đã phát ${event} cho ${orderCode} (${envelope.eventId})`);
  }

  private room(orderCode: string): string {
    return `payments:${orderCode}`;
  }

  private readOrderCode(client: Socket): string | null {
    const raw = client.handshake.query.order_id;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value ? String(value) : null;
  }

  /** Dùng cho test — số sự kiện đang đệm của một đơn. */
  bufferedEventCount(orderCode: string): number {
    return this.recentEvents.get(orderCode)?.length ?? 0;
  }
}
