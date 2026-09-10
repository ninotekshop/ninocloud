// =====================================================================
//  NINOTEK F&B POS — Cổng ra tầng dữ liệu (Ports)
// =====================================================================
//  Tầng Core KHÔNG biết gì về EF Core, SQLite hay HTTP. Nhờ vậy toàn bộ
//  logic nghiệp vụ chạy được trong unit test mà không cần database.
//
//  Bản hiện thực thật nằm ở Ninotek.POS.Data (EF Core + SQLite).
//  Bản in-memory dùng cho test nằm ở tests/.
// =====================================================================

using Ninotek.POS.Core.Entities;
using Ninotek.POS.Core.Enums;

namespace Ninotek.POS.Core.Abstractions;

public interface IOrderRepository
{
    Task<Order?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<Order?> GetByCodeAsync(string orderCode, CancellationToken ct = default);
    Task<Order?> GetOpenOrderForTableAsync(Guid tableId, CancellationToken ct = default);
    Task AddAsync(Order order, CancellationToken ct = default);

    /// <summary>
    /// Cập nhật có kiểm tra Optimistic Locking.
    /// Trả về false khi <paramref name="expectedRowVersion"/> không khớp —
    /// nghĩa là người khác đã sửa bản ghi này trước.
    /// </summary>
    Task<bool> UpdateAsync(Order order, int expectedRowVersion, CancellationToken ct = default);

    Task<string> NextOrderCodeAsync(Guid storeId, CancellationToken ct = default);
}

public interface IOrderDetailRepository
{
    Task<OrderDetail?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task AddRangeAsync(IEnumerable<OrderDetail> details, CancellationToken ct = default);
    Task<bool> UpdateAsync(OrderDetail detail, int expectedRowVersion, CancellationToken ct = default);
    Task<IReadOnlyList<OrderDetail>> ListByOrderAsync(Guid orderId, CancellationToken ct = default);
}

public interface ITableRepository
{
    Task<Table?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyList<Table>> ListAsync(Guid storeId, Guid? areaId, CancellationToken ct = default);
    Task<bool> UpdateAsync(Table table, int expectedRowVersion, CancellationToken ct = default);
}

public interface IMenuRepository
{
    Task<Item?> GetItemAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyList<Item>> ListItemsAsync(Guid storeId, CancellationToken ct = default);
    Task<IReadOnlyList<Category>> ListCategoriesAsync(Guid storeId, CancellationToken ct = default);
    Task<IReadOnlyList<Topping>> ListToppingsAsync(Guid storeId, CancellationToken ct = default);
    Task<IReadOnlyDictionary<Guid, IReadOnlyList<Guid>>> ListItemToppingMapAsync(
        Guid storeId, CancellationToken ct = default);

    /// <summary>Đổi khi thực đơn thay đổi — dùng cho ETag để tablet không tải lại thừa.</summary>
    Task<string> GetMenuEtagAsync(Guid storeId, CancellationToken ct = default);
}

public interface IDeviceRepository
{
    Task<Device?> GetByTokenAsync(string token, CancellationToken ct = default);
    Task<int> CountApprovedAsync(Guid storeId, CancellationToken ct = default);
    Task AddAsync(Device device, CancellationToken ct = default);
    Task TouchLastSeenAsync(Guid deviceId, DateTime at, CancellationToken ct = default);
}

public interface IPrintJobQueue
{
    /// <summary>
    /// Xếp lệnh in phiếu bếp vào hàng đợi.
    ///
    /// KHÔNG in đồng bộ ngay tại đây. Máy in bếp ở quán hay hết giấy, kẹt
    /// giấy hoặc rớt mạng; nếu chờ nó in xong mới trả lời tablet thì nhân
    /// viên sẽ đứng chôn chân trước mặt khách. Đơn phải được ghi nhận trước,
    /// việc in do worker nền lo và tự thử lại.
    /// </summary>
    Task EnqueueKitchenTicketAsync(Order order, IReadOnlyList<OrderDetail> details,
                                   CancellationToken ct = default);
}

/// <summary>Đồng hồ hệ thống, tách ra để test kiểm soát được thời gian.</summary>
public interface IClock
{
    DateTime UtcNow { get; }
}

public sealed class SystemClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}

/// <summary>Phát sự kiện real-time xuống các tablet và màn hình bếp.</summary>
public interface ILanEventPublisher
{
    Task PublishOrderCreatedAsync(Order order, IReadOnlyList<OrderDetail> details,
                                  string? tableName, CancellationToken ct = default);
    Task PublishKitchenStatusAsync(OrderDetail detail, CancellationToken ct = default);
    Task PublishTableStatusAsync(Table table, Order? currentOrder, CancellationToken ct = default);
    Task PublishTableLockedAsync(Table table, string lockedByName, DateTime lockedUntil,
                                 CancellationToken ct = default);
}
