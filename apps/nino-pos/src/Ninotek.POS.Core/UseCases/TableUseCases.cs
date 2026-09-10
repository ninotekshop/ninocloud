// =====================================================================
//  NINOTEK F&B POS — Nghiệp vụ bàn: khoá mềm, chuyển bàn, gộp bàn
// =====================================================================

using Ninotek.POS.Core.Abstractions;
using Ninotek.POS.Core.Contracts;
using Ninotek.POS.Core.Entities;
using Ninotek.POS.Core.Enums;

namespace Ninotek.POS.Core.UseCases;

public sealed record TableLockResult(Guid TableId, DateTime LockedUntil);

/// <summary>
/// Chiếm quyền thao tác một bàn trong 30 giây.
///
/// Vì sao khoá MỀM có hạn chứ không phải khoá cứng: tablet ở quán rớt Wi-Fi
/// giữa chừng là chuyện thường. Khoá cứng sẽ để bàn kẹt vĩnh viễn và phải
/// nhờ quản lý mở, ngay giữa giờ cao điểm. Khoá tự hết hạn thì tệ nhất chỉ
/// là chờ 30 giây.
///
/// Gọi lại để gia hạn khi nhân viên vẫn đang mở màn hình chọn món.
/// </summary>
public sealed class LockTableUseCase
{
    private readonly ITableRepository _tables;
    private readonly ILanEventPublisher _events;
    private readonly IClock _clock;

    public LockTableUseCase(ITableRepository tables, ILanEventPublisher events, IClock clock)
    {
        _tables = tables; _events = events; _clock = clock;
    }

    public async Task<LanResult<TableLockResult>> ExecuteAsync(
        Guid tableId, Guid userId, string userName, CancellationToken ct = default)
    {
        var table = await _tables.GetByIdAsync(tableId, ct);
        if (table is null)
        {
            return LanResult<TableLockResult>.Fail(LanFailure.NotFound, "Không tìm thấy bàn");
        }

        var now = _clock.UtcNow;
        if (table.IsLockedBy(userId, now))
        {
            var heldUntil = table.LockedAt!.Value.AddSeconds(Table.LockTtlSeconds);
            return LanResult<TableLockResult>.Fail(
                LanFailure.Conflict,
                $"Bàn đang được nhân viên khác thao tác (còn {Math.Ceiling((heldUntil - now).TotalSeconds)} giây)",
                table.RowVersion);
        }

        var expected = table.RowVersion;
        table.LockedByUserId = userId;
        table.LockedAt = now;
        table.UpdatedAt = now;

        if (!await _tables.UpdateAsync(table, expected, ct))
        {
            return LanResult<TableLockResult>.Fail(
                LanFailure.Conflict, "Bàn vừa bị người khác thay đổi, vui lòng thử lại", expected);
        }

        var until = now.AddSeconds(Table.LockTtlSeconds);
        await _events.PublishTableLockedAsync(table, userName, until, ct);
        return LanResult<TableLockResult>.Ok(new TableLockResult(tableId, until));
    }
}

/// <summary>
/// Chuyển bàn hoặc gộp bàn.
///
/// Gộp bàn KHÔNG được xoá đơn nguồn — nó được đánh dấu
/// <see cref="Order.MergedIntoOrderId"/> để vẫn còn vết đối soát. Chủ quán
/// cần trả lời được câu hỏi "đơn bàn 5 đi đâu mất" vào cuối ngày.
/// </summary>
public sealed class TransferTableUseCase
{
    private readonly IOrderRepository _orders;
    private readonly IOrderDetailRepository _details;
    private readonly ITableRepository _tables;
    private readonly ILanEventPublisher _events;
    private readonly IClock _clock;

    public TransferTableUseCase(IOrderRepository orders, IOrderDetailRepository details,
                                ITableRepository tables, ILanEventPublisher events, IClock clock)
    {
        _orders = orders; _details = details; _tables = tables; _events = events; _clock = clock;
    }

    public async Task<LanResult<Order>> ExecuteAsync(
        Guid orderId, Guid targetTableId, bool mergeIfOccupied, int expectedRowVersion,
        CancellationToken ct = default)
    {
        var order = await _orders.GetByIdAsync(orderId, ct);
        if (order is null) return LanResult<Order>.Fail(LanFailure.NotFound, "Không tìm thấy đơn hàng");

        if (order.Status is OrderStatus.COMPLETED or OrderStatus.CANCELLED)
        {
            return LanResult<Order>.Fail(
                LanFailure.Unprocessable, $"Đơn đã ở trạng thái {order.Status}, không chuyển bàn được");
        }
        if (order.RowVersion != expectedRowVersion)
        {
            return LanResult<Order>.Fail(
                LanFailure.Conflict, "Đơn vừa bị người khác thay đổi", order.RowVersion);
        }

        var target = await _tables.GetByIdAsync(targetTableId, ct);
        if (target is null) return LanResult<Order>.Fail(LanFailure.NotFound, "Không tìm thấy bàn đích");

        var now = _clock.UtcNow;
        var openAtTarget = await _orders.GetOpenOrderForTableAsync(targetTableId, ct);

        if (openAtTarget is not null && openAtTarget.Id != order.Id)
        {
            if (!mergeIfOccupied)
            {
                return LanResult<Order>.Fail(
                    LanFailure.Conflict,
                    $"Bàn {target.Name} đang có khách. Chọn gộp bàn nếu muốn dồn hai đơn làm một.");
            }

            // Dồn món sang đơn đích, giữ nguyên đơn nguồn làm vết đối soát.
            var moving = await _details.ListByOrderAsync(order.Id, ct);
            foreach (var d in moving)
            {
                d.OrderId = openAtTarget.Id;
                d.UpdatedAt = now;
                await _details.UpdateAsync(d, d.RowVersion, ct);
            }

            openAtTarget.Subtotal += order.Subtotal;
            openAtTarget.FinalTotal += order.FinalTotal;
            openAtTarget.GuestCount += order.GuestCount;
            openAtTarget.UpdatedAt = now;
            await _orders.UpdateAsync(openAtTarget, openAtTarget.RowVersion, ct);

            order.Status = OrderStatus.CANCELLED;
            order.MergedIntoOrderId = openAtTarget.Id;
            order.CancelReason = $"Đã gộp vào đơn {openAtTarget.OrderCode}";
            order.UpdatedAt = now;
            await _orders.UpdateAsync(order, expectedRowVersion, ct);

            await ReleaseSourceTableAsync(order.TableId, now, ct);
            return LanResult<Order>.Ok(openAtTarget);
        }

        // Chuyển bàn thường
        var sourceTableId = order.TableId;
        order.TableId = targetTableId;
        order.UpdatedAt = now;
        if (!await _orders.UpdateAsync(order, expectedRowVersion, ct))
        {
            return LanResult<Order>.Fail(
                LanFailure.Conflict, "Đơn vừa bị người khác thay đổi", order.RowVersion);
        }

        target.Status = TableStatus.OCCUPIED;
        target.CurrentOrderId = order.Id;
        target.UpdatedAt = now;
        await _tables.UpdateAsync(target, target.RowVersion, ct);
        await _events.PublishTableStatusAsync(target, order, ct);

        await ReleaseSourceTableAsync(sourceTableId, now, ct);
        return LanResult<Order>.Ok(order);
    }

    private async Task ReleaseSourceTableAsync(Guid? tableId, DateTime now, CancellationToken ct)
    {
        if (!tableId.HasValue) return;
        var source = await _tables.GetByIdAsync(tableId.Value, ct);
        if (source is null) return;

        source.Status = TableStatus.EMPTY;
        source.CurrentOrderId = null;
        source.LockedByUserId = null;
        source.LockedAt = null;
        source.UpdatedAt = now;
        await _tables.UpdateAsync(source, source.RowVersion, ct);
        await _events.PublishTableStatusAsync(source, null, ct);
    }
}

/// <summary>Bếp cập nhật trạng thái chế biến món (màn hình KDS).</summary>
public sealed class UpdateKitchenStatusUseCase
{
    private readonly IOrderDetailRepository _details;
    private readonly ILanEventPublisher _events;
    private readonly IClock _clock;

    public UpdateKitchenStatusUseCase(IOrderDetailRepository details,
                                      ILanEventPublisher events, IClock clock)
    {
        _details = details; _events = events; _clock = clock;
    }

    public async Task<LanResult<OrderDetail>> ExecuteAsync(
        Guid orderDetailId, KitchenStatus next, int expectedRowVersion,
        CancellationToken ct = default)
    {
        var detail = await _details.GetByIdAsync(orderDetailId, ct);
        if (detail is null) return LanResult<OrderDetail>.Fail(LanFailure.NotFound, "Không tìm thấy món");

        if (detail.RowVersion != expectedRowVersion)
        {
            return LanResult<OrderDetail>.Fail(
                LanFailure.Conflict, "Món vừa bị người khác cập nhật", detail.RowVersion);
        }
        if (!IsValidTransition(detail.KitchenStatus, next))
        {
            return LanResult<OrderDetail>.Fail(
                LanFailure.Unprocessable,
                $"Không thể chuyển món từ {detail.KitchenStatus} sang {next}");
        }

        var now = _clock.UtcNow;
        detail.KitchenStatus = next;
        detail.UpdatedAt = now;
        if (next == KitchenStatus.SERVED) detail.ServedAt = now;

        if (!await _details.UpdateAsync(detail, expectedRowVersion, ct))
        {
            return LanResult<OrderDetail>.Fail(
                LanFailure.Conflict, "Món vừa bị người khác cập nhật", detail.RowVersion);
        }

        await _events.PublishKitchenStatusAsync(detail, ct);
        return LanResult<OrderDetail>.Ok(detail);
    }

    /// <summary>
    /// Chỉ cho phép món tiến tới, không lùi.
    ///
    /// Không có ràng buộc này, một cú chạm nhầm trên màn hình bếp sẽ đưa món
    /// "đã lên bàn" về "chờ làm" và bếp làm lại lần nữa — mất nguyên liệu thật.
    /// Riêng huỷ món thì cho phép từ bất kỳ trạng thái nào chưa phục vụ.
    /// </summary>
    public static bool IsValidTransition(KitchenStatus from, KitchenStatus to)
    {
        if (from == to) return true;
        if (to == KitchenStatus.CANCELLED) return from != KitchenStatus.SERVED;

        return (from, to) switch
        {
            (KitchenStatus.WAITING, KitchenStatus.COOKING) => true,
            (KitchenStatus.WAITING, KitchenStatus.READY) => true,   // món có sẵn, lấy là xong
            (KitchenStatus.COOKING, KitchenStatus.READY) => true,
            (KitchenStatus.READY, KitchenStatus.SERVED) => true,
            _ => false,
        };
    }
}
