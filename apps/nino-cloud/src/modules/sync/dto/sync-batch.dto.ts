import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsObject,
  IsOptional, IsString, IsUUID, Min, ValidateNested,
} from 'class-validator';

export class SyncQueueItemDto {
  /** sync_queue.id trên máy POS — quyết định thứ tự FIFO. */
  @IsInt() @Min(1)
  queueId!: number;

  @IsString()
  entityType!: string;

  @IsUUID('4')
  entityId!: string;

  @IsIn(['INSERT', 'UPDATE', 'DELETE'])
  operation!: 'INSERT' | 'UPDATE' | 'DELETE';

  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional() @IsInt()
  sourceRowVersion?: number;

  @IsOptional() @IsString()
  sourceUpdatedAt?: string;
}

export class SyncBatchDto {
  @IsUUID('4')
  storeId!: string;

  /**
   * Trần 100 bản ghi mỗi lô. Lô lớn hơn giữ transaction mở quá lâu và làm
   * mạng yếu ở quán dễ timeout giữa chừng.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SyncQueueItemDto)
  items!: SyncQueueItemDto[];
}
