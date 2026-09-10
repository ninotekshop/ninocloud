import { IsDateString, IsUUID } from 'class-validator';

export class DashboardQueryDto {
  @IsUUID()
  storeId!: string;

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
