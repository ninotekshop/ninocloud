// =====================================================================
//  NINOTEK F&B POS — Tạo đơn hàng từ tablet NinoOrder
// =====================================================================
//  ĐƯỜNG ĐI NÓNG NHẤT CỦA HỆ THỐNG — mục tiêu độ trễ dưới 0,5 giây.
//
//  BỐN QUY TẮC QUYẾT ĐỊNH THIẾT KẾ:
//
//  1. IDEMPOTENT THEO orderId DO CLIENT SINH.
//     Tablet sinh UUID v4 TRƯỚC khi gửi. Mất Wi-Fi giữa chừng, nó gửi lại
//     cùng UUID đó. Nếu không khử trùng lặp, một lần mất sóng = hai đơn
//     giống hệt nhau, bếp làm hai lần, khách trả tiền hai lần.
//
//  2. CHỐT GIÁ VÀ TÊN MÓN TẠI THỜI ĐIỂM ORDER.
//     Chủ quán đổi giá lúc 15h không được làm sai hoá đơn đã tạo lúc 14h.
//
//  3. KHÔNG IN ĐỒNG BỘ.
//     Máy in bếp hết giấy không được làm nhân viên đứng chờ trước mặt khách.
//     Đơn ghi nhận xong là trả lời ngay; việc in đưa vào hàng đợi.
//
//  4. KIỂM TRA KHOÁ BÀN TRƯỚC KHI GHI.
//     Hai nhân viên cùng bấm vào một bàn là chuyện xảy ra hàng ngày ở quán
//     đông. Người đến sau phải bị từ chối rõ ràng, không được ghi đè.
// =====================================================================

using Ninotek.POS.Core.Abstractions;
using Ninotek.POS.Core.Contracts;
using Ninotek.POS.Core.Entities;
using Ninotek.POS.Core.Enums;

namespace Ninotek.POS.Core.UseCases;

public sealed record CreateOrderOutcome(Order Order, IReadOnlyList<OrderDetail> Details, bool WasDuplicate);

public sealed class CreateOrderUseCase
{
    private readonly IOrderRepository _orders;
    private readonly IOrderDetailRepository _details;
    private readonly ITableRepository _tables;
    private readonly IMenuRepository _menu;
    private readonly IPrintJobQueue _printQueue;
    private readonly ILanEventPublisher _events;
    private readonly IClock _clock;

    public CreateOrderUseCase(
        IOrderRepository orders,
        IOrderDetailRepository details,
        ITableRepository tables,
        IMenuRepository menu,
        IPrintJobQueue printQueue,
        ILanEventPublisher events,
        IClock clock)
    {
        _orders = orders;
        _details = details;
        _tables = tables;
        _menu = menu;
        _printQueue = printQueue;
        _events = events;
        _clock = clock;
    }

    public async Task<LanResult<CreateOrderOutcome>> ExecuteAsync(
        Guid storeId, CreateOrderInput input, CancellationToken ct = default)
    {
        if (input.Items.Count == 0)
        {
            return LanResult<CreateOrderOutcome>.Fail(
                LanFailure.Unprocessable, "Đơn hàng phải có ít nhất một món");
        }

        // --- 1. Khử trùng lặp -------------------------------------------
        // Tablet gửi lại sau khi mất kết nối. Trả về đơn cũ, KHÔNG tạo đơn thứ hai.
        var existing = await _orders.GetByIdAsync(input.OrderId, ct);
        if (existing is not null)
        {
            var existingDetails = await _details.ListByOrderAsync(existing.Id, ct);
            return LanResult<CreateOrderOutcome>.Ok(
                new CreateOrderOutcome(existing, existingDetails, WasDuplicate: true));
        }

        // --- 2. Kiểm tra bàn và khoá mềm --------------------------------
        Table? table = null;
        if (input.TableId.HasValue)
        {
            table = await _tables.GetByIdAsync(input.TableId.Value, ct);
            if (table is null)
            {
                return LanResult<CreateOrderOutcome>.Fail(
                    LanFailure.NotFound, $"Không tìm thấy bàn {input.TableId}");
            }
            if (table.IsLockedBy(input.UserId, _clock.UtcNow))
            {
                return LanResult<CreateOrderOutcome>.Fail(
                    LanFailure.Conflict,
                    "Bàn đang được nhân viên khác thao tác. Vui lòng thử lại sau vài giây.",
                    table.RowVersion);
            }
        }

        // --- 3. Dựng chi tiết đơn, chốt giá tại thời điểm này ------------
        var toppingMap = await _menu.ListToppingsAsync(storeId, ct);
        var toppingsById = toppingMap.ToDictionary(t => t.Id);

        var details = new List<OrderDetail>(input.Items.Count);
        foreach (var line in input.Items)
        {
            if (line.Quantity <= 0)
            {
                return LanResult<CreateOrderOutcome>.Fail(
                    LanFailure.Unprocessable, "Số lượng món phải lớn hơn 0");
            }

            var item = await _menu.GetItemAsync(line.ItemId, ct);
            if (item is null || !item.IsActive || item.IsDeleted)
            {
                return LanResult<CreateOrderOutcome>.Fail(
                    LanFailure.Unprocessable, $"Món {line.ItemId} không còn kinh doanh");
            }
            if (!item.IsAvailable)
            {
                return LanResult<CreateOrderOutcome>.Fail(
                    LanFailure.Unprocessable, $"Món \"{item.Name}\" đã hết trong hôm nay");
            }

            var detail = new OrderDetail
            {
                Id = line.OrderDetailId,       // UUID do client sinh — khử trùng lặp ở mức dòng
                OrderId = input.OrderId,
                ItemId = item.Id,
                ItemNameSnapshot = item.Name,  // chốt tên
                Quantity = line.Quantity,
                Price = item.BasePrice,        // chốt giá
                Note = line.Note,
                KitchenStatus = KitchenStatus.WAITING,
                CreatedAt = _clock.UtcNow,
                UpdatedAt = _clock.UtcNow,
            };

            decimal toppingTotal = 0m;
            foreach (var t in line.Toppings ?? Array.Empty<CreateOrderItemToppingInput>())
            {
                if (!toppingsById.TryGetValue(t.ToppingId, out var topping) || !topping.IsActive)
                {
                    return LanResult<CreateOrderOutcome>.Fail(
                        LanFailure.Unprocessable, $"Topping {t.ToppingId} không hợp lệ");
                }
                toppingTotal += topping.ExtraPrice * t.Quantity;
                detail.Toppings.Add(new OrderDetailTopping
                {
                    OrderDetailId = detail.Id,
                    ToppingId = topping.Id,
                    ToppingNameSnapshot = topping.Name,
                    ExtraPrice = topping.ExtraPrice,
                    Quantity = t.Quantity,
                    CreatedAt = _clock.UtcNow,
                });
            }
            detail.ToppingTotal = toppingTotal;
            details.Add(detail);
        }

        // --- 4. Ghi đơn -------------------------------------------------
        var subtotal = details.Sum(d => d.Quantity * (d.Price + d.ToppingTotal));

        var order = new Order
        {
            Id = input.OrderId,
            StoreId = storeId,
            OrderCode = await _orders.NextOrderCodeAsync(storeId, ct),
            TableId = input.TableId,
            UserId = input.UserId,
            DeviceId = input.DeviceId,
            OrderType = input.OrderType,
            Status = OrderStatus.PENDING,
            GuestCount = Math.Max(1, input.GuestCount),
            Subtotal = subtotal,
            FinalTotal = subtotal,
            Note = input.Note,
            // Giữ thời điểm trên tablet để nhiều đơn đệm offline gửi lên cùng lúc
            // vẫn xếp đúng thứ tự khách gọi món.
            CreatedAt = input.ClientCreatedAt ?? _clock.UtcNow,
            UpdatedAt = _clock.UtcNow,
        };

        await _orders.AddAsync(order, ct);
        await _details.AddRangeAsync(details, ct);

        if (table is not null)
        {
            table.Status = TableStatus.OCCUPIED;
            table.CurrentOrderId = order.Id;
            table.LockedByUserId = null;   // nhả khoá, đơn đã ghi xong
            table.LockedAt = null;
            table.UpdatedAt = _clock.UtcNow;
            await _tables.UpdateAsync(table, table.RowVersion, ct);
        }

        // --- 5. Xếp hàng đợi in, KHÔNG chờ máy in ------------------------
        await _printQueue.EnqueueKitchenTicketAsync(order, details, ct);
        await _events.PublishOrderCreatedAsync(order, details, table?.Name, ct);
        if (table is not null)
        {
            await _events.PublishTableStatusAsync(table, order, ct);
        }

        return LanResult<CreateOrderOutcome>.Ok(
            new CreateOrderOutcome(order, details, WasDuplicate: false));
    }
}
