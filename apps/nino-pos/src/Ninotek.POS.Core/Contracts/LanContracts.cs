// =====================================================================
//  NINOTEK F&B POS — Kiểu dữ liệu vào/ra của LAN API
//  Khớp với packages/api-contracts/openapi.yaml
// =====================================================================

using Ninotek.POS.Core.Enums;

namespace Ninotek.POS.Core.Contracts;

public sealed record CreateOrderItemToppingInput(Guid ToppingId, int Quantity = 1);

public sealed record CreateOrderItemInput(
    Guid OrderDetailId,
    Guid ItemId,
    decimal Quantity,
    string? Note = null,
    IReadOnlyList<CreateOrderItemToppingInput>? Toppings = null);

public sealed record CreateOrderInput(
    Guid OrderId,
    Guid UserId,
    Guid? TableId,
    OrderType OrderType,
    int GuestCount,
    string? Note,
    DateTime? ClientCreatedAt,
    IReadOnlyList<CreateOrderItemInput> Items,
    Guid? DeviceId = null);

/// <summary>Vì sao một thao tác bị từ chối — quyết định mã HTTP trả về.</summary>
public enum LanFailure
{
    None,
    NotFound,
    Conflict,
    Unprocessable,
    Forbidden,
}

/// <summary>
/// Kết quả một thao tác nghiệp vụ.
///
/// Dùng kiểu trả về thay vì ném exception cho các lỗi NGHIỆP VỤ (bàn đang bị
/// khoá, món đã hết): chúng là kết quả bình thường của luồng chạy, không phải
/// sự cố. Exception để dành cho lỗi thật sự bất thường.
/// </summary>
public sealed record LanResult<T>(
    bool Success,
    T? Value,
    LanFailure Failure = LanFailure.None,
    string? Message = null,
    int? CurrentRowVersion = null)
{
    public static LanResult<T> Ok(T value) => new(true, value);

    public static LanResult<T> Fail(LanFailure failure, string message, int? rowVersion = null)
        => new(false, default, failure, message, rowVersion);
}
