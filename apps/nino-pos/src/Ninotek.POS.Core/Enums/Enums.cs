// =====================================================================
//  NINOTEK F&B POS — Enums
//  Giá trị PHẢI khớp tuyệt đối với CHECK constraint trong SQLite và
//  kiểu ENUM trong PostgreSQL. Lệch một chữ là sync lên Cloud sẽ hỏng.
// =====================================================================
namespace Ninotek.POS.Core.Enums;

public enum TableStatus { EMPTY, OCCUPIED, RESERVED, BILLING, LOCKED }

public enum OrderType { DINE_IN, TAKE_AWAY, DELIVERY }

public enum OrderStatus { DRAFT, PENDING, SERVING, COMPLETED, CANCELLED }

public enum KitchenStatus { WAITING, COOKING, READY, SERVED, CANCELLED }

public enum PaymentMethod { CASH, VIETQR, CARD, EWALLET, DEBT, VOUCHER }

public enum PaymentStatus { PENDING, SUCCESS, FAILED, REFUNDED, EXPIRED }

public enum SyncStatus { PENDING, PROCESSING, SYNCED, FAILED, CONFLICT }

public enum SyncOperation { INSERT, UPDATE, DELETE }

public enum UserRole { OWNER, ADMIN, CASHIER, WAITER, KITCHEN }

public enum ShiftStatus { OPEN, CLOSED }

public enum StockTxnType { IMPORT, CONSUME, WASTE, ADJUST, RETURN }

public enum LicensePackage { TRIAL, BASIC, PRO, ENTERPRISE, LIFETIME }
