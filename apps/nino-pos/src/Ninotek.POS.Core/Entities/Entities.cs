// =====================================================================
//  NINOTEK F&B POS — Domain Entities (C# / .NET 8)
// =====================================================================
//  Ánh xạ 1-1 với database/sqlite/migrations/V001__init_schema.sql
//
//  QUY TẮC BẤT DI BẤT DỊCH:
//   1. Khoá chính giao dịch là Guid sinh phía CLIENT (Guid.NewGuid()) —
//      không bao giờ để database tự sinh. Máy POS và tablet tạo dữ liệu
//      độc lập khi offline; UUID v4 là thứ giữ cho chúng không đụng nhau.
//   2. RowVersion + UpdatedAt là cặp Optimistic Locking. Trigger trong DB
//      tự tăng RowVersion; code KHÔNG được gán tay.
//   3. Không xoá cứng — set DeletedAt để đồng bộ hai chiều không mất vết.
// =====================================================================

using Ninotek.POS.Core.Enums;

namespace Ninotek.POS.Core.Entities;

/// <summary>Lớp cơ sở cho mọi bảng có Optimistic Locking.</summary>
public abstract class AuditableEntity
{
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Tăng tự động bởi trigger DB mỗi lần UPDATE. Client gửi lại giá trị đọc
    /// được lúc đầu; nếu lệch thì bản ghi đã bị người khác sửa → 409 Conflict.
    /// </summary>
    public int RowVersion { get; set; } = 1;
}

public abstract class SoftDeletableEntity : AuditableEntity
{
    public DateTime? DeletedAt { get; set; }
    public bool IsDeleted => DeletedAt.HasValue;
}

// --- Cửa hàng & người dùng ------------------------------------------

public class Store : SoftDeletableEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TenantId { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Address { get; set; }
    public string? Phone { get; set; }
    public string Timezone { get; set; } = "Asia/Ho_Chi_Minh";
    public string Currency { get; set; } = "VND";

    /// <summary>Mã BIN ngân hàng theo NAPAS — dùng làm acqId khi sinh VietQR.</summary>
    public string? BankAcqId { get; set; }
    public string? BankAccountNo { get; set; }
    public string? BankAccountName { get; set; }
    public bool IsActive { get; set; } = true;

    public ICollection<Area> Areas { get; set; } = new List<Area>();
    public ICollection<User> Users { get; set; } = new List<User>();
}

public class User : SoftDeletableEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StoreId { get; set; }
    public string Username { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;

    /// <summary>PIN 4-6 số để đăng nhập nhanh trên màn hình cảm ứng POS.</summary>
    public string? PinHash { get; set; }

    public UserRole Role { get; set; } = UserRole.WAITER;
    public string? Phone { get; set; }

    /// <summary>Định mức giảm giá tối đa nhân viên này được phép áp dụng.</summary>
    public decimal MaxDiscountPercent { get; set; }

    public bool IsActive { get; set; } = true;
    public DateTime? LastLoginAt { get; set; }

    public Store? Store { get; set; }
}

public class Device : AuditableEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StoreId { get; set; }
    public string DeviceName { get; set; } = string.Empty;
    public string DeviceType { get; set; } = "TABLET";
    public string? MachineCode { get; set; }
    public string? PushToken { get; set; }
    public string? PairingToken { get; set; }
    public DateTime? LastSeenAt { get; set; }
    public bool IsApproved { get; set; }
}

// --- Khu vực & bàn ---------------------------------------------------

public class Area : SoftDeletableEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StoreId { get; set; }
    public string Name { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;

    public ICollection<Table> Tables { get; set; } = new List<Table>();
}

public class Table : SoftDeletableEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StoreId { get; set; }
    public Guid AreaId { get; set; }
    public string Name { get; set; } = string.Empty;
    public int SeatCapacity { get; set; } = 4;
    public TableStatus Status { get; set; } = TableStatus.EMPTY;
    public Guid? CurrentOrderId { get; set; }

    /// <summary>Toạ độ trên lưới sơ đồ bàn của NinoPOS.</summary>
    public int PosX { get; set; }
    public int PosY { get; set; }
    public int SortOrder { get; set; }

    /// <summary>
    /// Soft-lock chống hai nhân viên cùng thao tác. Tự hết hạn sau
    /// <see cref="LockTtlSeconds"/> để không kẹt khi tablet rớt mạng giữa chừng.
    /// </summary>
    public Guid? LockedByUserId { get; set; }
    public DateTime? LockedAt { get; set; }
    public bool IsActive { get; set; } = true;

    public const int LockTtlSeconds = 30;

    public Area? Area { get; set; }

    /// <summary>Bàn có đang bị nhân viên khác giữ tại thời điểm <paramref name="now"/> không.</summary>
    public bool IsLockedBy(Guid otherUserId, DateTime now)
        => LockedByUserId.HasValue
           && LockedByUserId.Value != otherUserId
           && LockedAt.HasValue
           && (now - LockedAt.Value).TotalSeconds < LockTtlSeconds;
}

// --- Thực đơn & định lượng -------------------------------------------

public class Category : SoftDeletableEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StoreId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string ColorCode { get; set; } = "#007AFF";
    public string? Icon { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;

    public ICollection<Item> Items { get; set; } = new List<Item>();
}

public class Item : SoftDeletableEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StoreId { get; set; }
    public Guid CategoryId { get; set; }
    public string? Sku { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public decimal BasePrice { get; set; }
    public decimal CostPrice { get; set; }
    public string Unit { get; set; } = "Ly";
    public string? ImageUrl { get; set; }

    /// <summary>Ảnh đã tải về ổ đĩa máy POS — hiển thị được cả khi mất mạng.</summary>
    public string? ImageLocalPath { get; set; }

    /// <summary>Quyết định phiếu chế biến in ra máy in nào: BAR / KITCHEN / GRILL.</summary>
    public string PrintStation { get; set; } = "KITCHEN";

    public int PreparationMinutes { get; set; } = 5;

    /// <summary>false = tạm hết món trong ngày (khác với IsActive = ngừng kinh doanh).</summary>
    public bool IsAvailable { get; set; } = true;
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }

    public Category? Category { get; set; }
    public ICollection<RecipeItem> RecipeItems { get; set; } = new List<RecipeItem>();
}

public class Topping : SoftDeletableEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StoreId { get; set; }
    public string Name { get; set; } = string.Empty;
    public decimal ExtraPrice { get; set; }

    /// <summary>TOPPING / SUGAR / ICE / SIZE — quyết định cách nhóm trong popup chọn món.</summary>
    public string GroupName { get; set; } = "TOPPING";
    public bool IsActive { get; set; } = true;
    public int SortOrder { get; set; }
}

public class ItemTopping
{
    public Guid ItemId { get; set; }
    public Guid ToppingId { get; set; }
    public bool IsDefault { get; set; }
}

public class Ingredient : SoftDeletableEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StoreId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Unit { get; set; } = string.Empty;
    public decimal StockQuantity { get; set; }
    public decimal MinStockAlert { get; set; }
    public decimal AvgUnitCost { get; set; }
    public bool IsActive { get; set; } = true;

    public bool IsLowStock => StockQuantity <= MinStockAlert;
}

public class RecipeItem : AuditableEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ItemId { get; set; }
    public Guid IngredientId { get; set; }

    /// <summary>Lượng NVL tiêu hao cho 1 đơn vị món. VD 0.0200 kg cà phê cho 1 ly.</summary>
    public decimal QuantityRequired { get; set; }

    public Item? Item { get; set; }
    public Ingredient? Ingredient { get; set; }
}

// --- Ca làm việc -----------------------------------------------------

public class Shift : AuditableEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StoreId { get; set; }
    public Guid OpenedByUserId { get; set; }
    public Guid? ClosedByUserId { get; set; }
    public ShiftStatus Status { get; set; } = ShiftStatus.OPEN;
    public decimal OpeningCash { get; set; }
    public decimal? ClosingCashCounted { get; set; }
    public decimal? ClosingCashExpected { get; set; }

    /// <summary>Cột GENERATED trong DB — chỉ đọc.</summary>
    public decimal CashDifference { get; private set; }

    public decimal TotalRevenue { get; set; }
    public int TotalOrders { get; set; }
    public DateTime OpenedAt { get; set; } = DateTime.UtcNow;
    public DateTime? ClosedAt { get; set; }
    public string? Note { get; set; }
}

// --- Đơn hàng --------------------------------------------------------

public class Order : SoftDeletableEntity
{
    /// <summary>UUID v4 sinh phía client — cũng là khoá idempotency khi gửi lại qua LAN.</summary>
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid StoreId { get; set; }

    /// <summary>
    /// Mã hoá đơn dạng NINOPOS100234. Chỉ gồm [A-Z0-9] vì nó được đưa vào tag 62
    /// của VietQR làm nội dung chuyển khoản — ký tự khác sẽ bị ngân hàng cắt và
    /// làm hỏng đối soát tự động.
    /// </summary>
    public string OrderCode { get; set; } = string.Empty;

    public Guid? TableId { get; set; }
    public Guid? ShiftId { get; set; }
    public Guid UserId { get; set; }
    public Guid? CashierId { get; set; }
    public Guid? DeviceId { get; set; }
    public OrderType OrderType { get; set; } = OrderType.DINE_IN;
    public OrderStatus Status { get; set; } = OrderStatus.PENDING;
    public int GuestCount { get; set; } = 1;
    public string? CustomerName { get; set; }
    public string? CustomerPhone { get; set; }

    public decimal Subtotal { get; set; }
    public decimal DiscountAmount { get; set; }
    public string? DiscountReason { get; set; }
    public decimal ServiceFee { get; set; }
    public decimal VatAmount { get; set; }
    public decimal FinalTotal { get; set; }
    public decimal PaidAmount { get; set; }

    public string? Note { get; set; }
    public string? CancelReason { get; set; }
    public Guid? CancelledByUserId { get; set; }
    public Guid? MergedIntoOrderId { get; set; }
    public bool IsPrinted { get; set; }
    public DateTime? CompletedAt { get; set; }

    public Table? Table { get; set; }
    public ICollection<OrderDetail> Details { get; set; } = new List<OrderDetail>();
    public ICollection<Payment> Payments { get; set; } = new List<Payment>();

    public decimal RemainingAmount => Math.Max(FinalTotal - PaidAmount, 0m);
    public bool IsFullyPaid => PaidAmount >= FinalTotal;
}

public class OrderDetail : AuditableEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrderId { get; set; }
    public Guid ItemId { get; set; }

    /// <summary>Chốt tên món tại thời điểm order — đổi tên món sau đó không làm sai hoá đơn cũ.</summary>
    public string ItemNameSnapshot { get; set; } = string.Empty;

    public decimal Quantity { get; set; }

    /// <summary>Đơn giá tại thời điểm order — tăng giá sau đó không làm sai hoá đơn cũ.</summary>
    public decimal Price { get; set; }

    public decimal ToppingTotal { get; set; }
    public decimal DiscountAmount { get; set; }

    /// <summary>Cột GENERATED trong DB: Quantity * (Price + ToppingTotal) - DiscountAmount.</summary>
    public decimal LineTotal { get; private set; }

    public string? Note { get; set; }
    public KitchenStatus KitchenStatus { get; set; } = KitchenStatus.WAITING;
    public DateTime? PrintedAt { get; set; }
    public DateTime? ServedAt { get; set; }
    public Guid? CancelledByUserId { get; set; }
    public string? CancelReason { get; set; }

    public Order? Order { get; set; }
    public ICollection<OrderDetailTopping> Toppings { get; set; } = new List<OrderDetailTopping>();
}

public class OrderDetailTopping
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OrderDetailId { get; set; }
    public Guid ToppingId { get; set; }
    public string ToppingNameSnapshot { get; set; } = string.Empty;
    public decimal ExtraPrice { get; set; }
    public int Quantity { get; set; } = 1;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// --- Thanh toán ------------------------------------------------------

public class Payment : AuditableEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StoreId { get; set; }
    public Guid OrderId { get; set; }
    public Guid? ShiftId { get; set; }
    public PaymentMethod PaymentMethod { get; set; }
    public PaymentStatus Status { get; set; } = PaymentStatus.PENDING;
    public decimal Amount { get; set; }
    public decimal? ReceivedAmount { get; set; }
    public decimal ChangeAmount { get; set; }

    /// <summary>Mã giao dịch ngân hàng — khoá idempotency khi webhook bắn lại.</summary>
    public string? TransactionRef { get; set; }

    public string? Gateway { get; set; }
    public DateTime? PaidAt { get; set; }
    public Guid? CreatedByUserId { get; set; }
}

public class PaymentQrSession : AuditableEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StoreId { get; set; }
    public Guid OrderId { get; set; }
    public Guid? PaymentId { get; set; }
    public string AccountNo { get; set; } = string.Empty;
    public string AccountName { get; set; } = string.Empty;
    public string AcqId { get; set; } = string.Empty;
    public decimal Amount { get; set; }

    /// <summary>Bằng đúng Order.OrderCode — nội dung chuyển khoản để đối soát.</summary>
    public string AddInfo { get; set; } = string.Empty;

    public string? QrCodeRaw { get; set; }
    public string? QrDataUrl { get; set; }
    public PaymentStatus Status { get; set; } = PaymentStatus.PENDING;
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddMinutes(15);
    public DateTime? ConfirmedAt { get; set; }

    public bool IsExpired(DateTime now) => now >= ExpiresAt;
}

// --- Kho & nhật ký ---------------------------------------------------

public class StockTransaction
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StoreId { get; set; }
    public Guid IngredientId { get; set; }
    public StockTxnType TxnType { get; set; }

    /// <summary>Âm = tiêu hao, dương = nhập.</summary>
    public decimal QuantityChange { get; set; }
    public decimal QuantityAfter { get; set; }
    public decimal UnitCost { get; set; }
    public Guid? OrderId { get; set; }
    public Guid? UserId { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class AuditLog
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StoreId { get; set; }
    public Guid? UserId { get; set; }
    public Guid? ShiftId { get; set; }

    /// <summary>CANCEL_ITEM / APPLY_DISCOUNT / OPEN_DRAWER / VOID_BILL.</summary>
    public string Action { get; set; } = string.Empty;

    public string EntityType { get; set; } = string.Empty;
    public Guid? EntityId { get; set; }
    public string? OldValue { get; set; }
    public string? NewValue { get; set; }
    public string? IpAddress { get; set; }
    public Guid? DeviceId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// --- Đồng bộ & in ấn -------------------------------------------------

public class SyncQueueEntry
{
    /// <summary>Số nguyên tăng dần — quyết định thứ tự FIFO tuyệt đối khi đẩy lên Cloud.</summary>
    public long Id { get; set; }

    public Guid StoreId { get; set; }
    public string EntityType { get; set; } = string.Empty;
    public Guid EntityId { get; set; }
    public SyncOperation Operation { get; set; }
    public string Payload { get; set; } = string.Empty;
    public SyncStatus Status { get; set; } = SyncStatus.PENDING;
    public int RetryCount { get; set; }
    public string? LastError { get; set; }
    public Guid? SourceDeviceId { get; set; }
    public int? SourceRowVersion { get; set; }
    public DateTime? SourceUpdatedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? SyncedAt { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Backoff luỹ thừa có trần: 2^n giây, tối đa 5 phút.</summary>
    public TimeSpan NextRetryDelay() =>
        TimeSpan.FromSeconds(Math.Min(Math.Pow(2, Math.Min(RetryCount, 20)), 300));
}

public class PrintJob
{
    public long Id { get; set; }
    public Guid StoreId { get; set; }
    public string JobType { get; set; } = "BILL";
    public string PrinterName { get; set; } = string.Empty;
    public Guid? OrderId { get; set; }

    /// <summary>Chuỗi lệnh ESC/POS đã dựng sẵn, mã hoá base64.</summary>
    public string Payload { get; set; } = string.Empty;

    public string Status { get; set; } = "PENDING";
    public int RetryCount { get; set; }
    public string? LastError { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? PrintedAt { get; set; }
}

// --- Cấu hình cục bộ & bản quyền -------------------------------------

public class AppSetting
{
    public string Key { get; set; } = string.Empty;
    public string? Value { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class LicenseLocal
{
    public int Id { get; set; } = 1;
    public string? LicenseKey { get; set; }
    public string MachineId { get; set; } = string.Empty;
    public string? PackageType { get; set; }
    public int MaxDevices { get; set; } = 3;
    public DateTime? ExpiryDate { get; set; }
    public DateTime? ActivatedAt { get; set; }

    /// <summary>
    /// Mốc thời gian server xác nhận gần nhất. Nếu đồng hồ Windows lùi về
    /// TRƯỚC mốc này thì khách đang cố kéo dài license đã hết hạn.
    /// </summary>
    public DateTime? LastVerifiedAt { get; set; }

    public bool IsValid { get; set; }
}

public class OrderSequence
{
    public Guid StoreId { get; set; }
    public string Prefix { get; set; } = "NINOPOS";
    public long LastNumber { get; set; } = 100000;
}
