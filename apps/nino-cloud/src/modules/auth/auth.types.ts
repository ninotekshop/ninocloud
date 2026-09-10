export type AppRole = 'OWNER' | 'ADMIN' | 'CASHIER' | 'WAITER' | 'KITCHEN';

export interface AccessTokenPayload {
  sub: string;
  storeId: string;
  username: string;
  role: AppRole;
  tokenType?: 'access' | 'refresh';
}
