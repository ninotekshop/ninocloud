// =====================================================================
//  NINOTEK F&B POS — Định tuyến LAN API
//  Khớp packages/api-contracts/openapi.yaml, phần LAN API.
// =====================================================================

using System.Security.Cryptography;
using Ninotek.POS.Core.Abstractions;
using Ninotek.POS.Core.Authorization;
using Ninotek.POS.Core.Contracts;
using Ninotek.POS.Core.Entities;
using Ninotek.POS.Core.Enums;
using Ninotek.POS.Core.UseCases;
using Ninotek.POS.Data;
using Ninotek.POS.LanServer.Hubs;
using Ninotek.POS.LanServer;

namespace Ninotek.POS.LanServer.Endpoints;

// --- DTO nhận từ tablet ----------------------------------------------
public sealed record PairDeviceRequest(string DeviceName, string DeviceType, string PairingCode);
public sealed record TransferRequest(Guid TargetTableId, bool MergeIfOccupied, int RowVersion);
public sealed record KitchenStatusRequest(KitchenStatus KitchenStatus, int RowVersion);
public sealed record CreateOrderToppingRequest(Guid ToppingId, int Quantity = 1);
public sealed record CreateOrderLineRequest(
    Guid OrderDetailId, Guid ItemId, decimal Quantity,
    string? Note, List<CreateOrderToppingRequest>? Toppings);
public sealed record CreateOrderRequest(
    Guid OrderId, Guid UserId, Guid? TableId, string? OrderType,
    int GuestCount, string? Note, DateTime? ClientCreatedAt,
    List<CreateOrderLineRequest> Items);

public static class LanEndpoints
{
    public static void MapLanEndpoints(this WebApplication app)
    {
        var lan = app.MapGroup("/api/v1/lan");

        // ------------------------------------------------------------------
        // Dò tìm máy POS — endpoint DUY NHẤT không cần xác thực.
        // NinoOrder gọi sau khi dò mDNS để xác nhận đúng máy trước khi ghép nối.
        // ------------------------------------------------------------------
        lan.MapGet("/discovery", (LanServerOptions opt) =>
        {
            if (!opt.PairingEnabled)
            {
                return Results.Problem(
                    title: "Máy POS đang tắt chế độ cho phép ghép nối thiết bị mới",
                    statusCode: StatusCodes.Status403Forbidden,
                    type: "https://ninotek.vn/errors/pairing-disabled");
            }
            return Results.Ok(new
            {
                storeName = opt.StoreName,
                storeCode = opt.StoreCode,
                posVersion = opt.PosVersion,
                protocolVersion = opt.ProtocolVersion,
                requiresPairing = true,
            });
        });

        // ------------------------------------------------------------------
        // Ghép nối tablet
        // ------------------------------------------------------------------
        lan.MapPost("/devices/pair", async (
            PairDeviceRequest req, LanServerOptions opt,
            IDeviceRepository devices, IClock clock, CancellationToken ct) =>
        {
            // So sánh mã ghép nối chống tấn công đo thời gian. Mã chỉ 6 chữ số,
            // dò từng ký tự qua thời gian phản hồi là hoàn toàn khả thi trong LAN.
            var provided = System.Text.Encoding.UTF8.GetBytes(req.PairingCode ?? "");
            var expected = System.Text.Encoding.UTF8.GetBytes(opt.PairingCode);
            if (provided.Length != expected.Length ||
                !CryptographicOperations.FixedTimeEquals(provided, expected))
            {
                return Results.Problem(
                    title: "Mã ghép nối không đúng",
                    statusCode: StatusCodes.Status403Forbidden,
                    type: "https://ninotek.vn/errors/invalid-pairing-code");
            }

                    if (req.DeviceType is not ("TABLET" or "KDS"))
                    {
                    return Problem(
                        LanFailure.Unprocessable,
                        "deviceType phải là TABLET hoặc KDS");
                    }

            var approved = await devices.CountApprovedAsync(opt.StoreId, ct);
            if (approved >= opt.MaxDevices)
            {
                return Results.Problem(
                    title: $"Đã đạt giới hạn {opt.MaxDevices} thiết bị của gói bản quyền hiện tại",
                    detail: "Nâng cấp gói cước hoặc gỡ bớt thiết bị cũ trong Cài đặt.",
                    statusCode: StatusCodes.Status403Forbidden,
                    type: "https://ninotek.vn/errors/device-limit-reached");
            }

            var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            var device = new Device
            {
                StoreId = opt.StoreId,
                DeviceName = req.DeviceName,
                DeviceType = req.DeviceType,
                PairingToken = token,
                IsApproved = true,
                LastSeenAt = clock.UtcNow,
            };
            await devices.AddAsync(device, ct);

            return Results.Ok(new
            {
                deviceId = device.Id,
                deviceToken = token,
                role = RolePolicy.RoleName(LanAuthorization.RoleForDevice(device)),
            });
        });

        // ------------------------------------------------------------------
        // Sơ đồ bàn
        // ------------------------------------------------------------------
        lan.MapGet("/tables/status", async (
            Guid? areaId, LanServerOptions opt, ITableRepository tables,
            IOrderRepository orders, IClock clock, CancellationToken ct) =>
        {
            var list = await tables.ListAsync(opt.StoreId, areaId, ct);
            var now = clock.UtcNow;
            var result = new List<object>(list.Count);

            foreach (var t in list)
            {
                Order? order = t.CurrentOrderId.HasValue
                    ? await orders.GetByIdAsync(t.CurrentOrderId.Value, ct)
                    : null;

                // Khoá đã hết hạn thì coi như không còn — tablet không được
                // hiển thị bàn bị khoá vĩnh viễn vì một máy đã rớt mạng.
                var lockActive = t.LockedAt.HasValue &&
                                 (now - t.LockedAt.Value).TotalSeconds < Table.LockTtlSeconds;

                result.Add(new
                {
                    id = t.Id,
                    name = t.Name,
                    areaId = t.AreaId,
                    seatCapacity = t.SeatCapacity,
                    status = t.Status.ToString(),
                    currentOrderId = t.CurrentOrderId,
                    guestCount = order?.GuestCount,
                    runningTotal = order?.FinalTotal,
                    seatedMinutes = order is null
                        ? (int?)null
                        : (int)(now - order.CreatedAt).TotalMinutes,
                    lockedByUserId = lockActive ? t.LockedByUserId : null,
                    lockedUntil = lockActive
                        ? t.LockedAt!.Value.AddSeconds(Table.LockTtlSeconds).ToString("O")
                        : null,
                    posX = t.PosX,
                    posY = t.PosY,
                    rowVersion = t.RowVersion,
                });
            }
            return Results.Ok(result);
        });

        lan.MapPost("/tables/{tableId:guid}/lock", async (
            Guid tableId, HttpContext http, LockTableUseCase useCase, CancellationToken ct) =>
        {
            var (userId, userName) = ReadUser(http);
            var r = await useCase.ExecuteAsync(tableId, userId, userName, ct);
            return r.Success
                ? Results.Ok(new { lockedUntil = r.Value!.LockedUntil.ToString("O") })
                : Problem(r.Failure, r.Message!, r.CurrentRowVersion);
        });

        // ------------------------------------------------------------------
        // TẠO ĐƠN — đường đi nóng nhất, mục tiêu dưới 0,5 giây
        // ------------------------------------------------------------------
        lan.MapPost("/order/create", async (
            CreateOrderRequest req, HttpContext http, LanServerOptions opt,
            CreateOrderUseCase useCase, LocalPosDatabase localDatabase, CancellationToken ct) =>
        {
            if (req.Items is null || req.Items.Count == 0)
            {
                return Problem(LanFailure.Unprocessable, "Đơn hàng phải có ít nhất một món");
            }
            if (!Enum.TryParse<OrderType>(req.OrderType ?? "DINE_IN", out var orderType))
            {
                return Problem(LanFailure.Unprocessable, $"orderType không hợp lệ: {req.OrderType}");
            }

            if (!LanAuthorization.TryGetIdentity(http, out var identity))
            {
                return LanAuthorization.Unauthorized();
            }

            var input = new CreateOrderInput(
                req.OrderId, identity.DeviceId, req.TableId, orderType,
                req.GuestCount, req.Note, req.ClientCreatedAt,
                req.Items.Select(i => new CreateOrderItemInput(
                    i.OrderDetailId, i.ItemId, i.Quantity, i.Note,
                    i.Toppings?.Select(t => new CreateOrderItemToppingInput(t.ToppingId, t.Quantity))
                              .ToList())).ToList());

            var r = await useCase.ExecuteAsync(opt.StoreId, input, ct);
            if (!r.Success) return Problem(r.Failure, r.Message!, r.CurrentRowVersion);

            if (!r.Value!.WasDuplicate && !await localDatabase.HasOrderAsync(req.OrderId, ct))
            {
                await localDatabase.CreateOrderAsync(
                    identity.DeviceId,
                    req.TableId,
                    req.Items.Select(item => new LocalOrderLine(item.ItemId, item.Quantity, item.Note)).ToList(),
                    req.OrderId,
                    ct);
            }

            var body = Serialize(r.Value.Order, r.Value.Details);

            // 200 khi tablet gửi lại đơn cũ, 201 khi thực sự tạo mới.
            // Tablet dựa vào đây để biết đơn đã được ghi nhận từ trước.
            return r.Value.WasDuplicate ? Results.Ok(body) : Results.Created($"/api/v1/lan/orders/{r.Value.Order.Id}", body);
        });

        lan.MapGet("/orders/{orderId:guid}", async (
            Guid orderId, IOrderRepository orders, IOrderDetailRepository details,
            CancellationToken ct) =>
        {
            var order = await orders.GetByIdAsync(orderId, ct);
            if (order is null) return Problem(LanFailure.NotFound, "Không tìm thấy đơn hàng");
            return Results.Ok(Serialize(order, await details.ListByOrderAsync(orderId, ct)));
        });

        lan.MapPost("/orders/{orderId:guid}/transfer", async (
            Guid orderId, TransferRequest req, TransferTableUseCase useCase,
            IOrderDetailRepository details, CancellationToken ct) =>
        {
            var r = await useCase.ExecuteAsync(orderId, req.TargetTableId,
                                               req.MergeIfOccupied, req.RowVersion, ct);
            return r.Success
                ? Results.Ok(Serialize(r.Value!, await details.ListByOrderAsync(r.Value!.Id, ct)))
                : Problem(r.Failure, r.Message!, r.CurrentRowVersion);
        });

        lan.MapPatch("/order-details/{id:guid}/kitchen-status", async (
            Guid id, KitchenStatusRequest req, UpdateKitchenStatusUseCase useCase,
            CancellationToken ct) =>
        {
            var r = await useCase.ExecuteAsync(id, req.KitchenStatus, req.RowVersion, ct);
            return r.Success
                ? Results.Ok(SerializeDetail(r.Value!))
                : Problem(r.Failure, r.Message!, r.CurrentRowVersion);
        });

        // ------------------------------------------------------------------
        // Thực đơn — có ETag vì Wi-Fi quán thường yếu
        // ------------------------------------------------------------------
        lan.MapGet("/menu", async (
            HttpContext http, LanServerOptions opt, IMenuRepository menu, CancellationToken ct) =>
        {
            var etag = await menu.GetMenuEtagAsync(opt.StoreId, ct);
            if (http.Request.Headers.IfNoneMatch.ToString() == etag)
            {
                return Results.StatusCode(StatusCodes.Status304NotModified);
            }

            var toppingMap = await menu.ListItemToppingMapAsync(opt.StoreId, ct);
            var items = await menu.ListItemsAsync(opt.StoreId, ct);
            http.Response.Headers.ETag = etag;

            return Results.Ok(new
            {
                etag,
                categories = (await menu.ListCategoriesAsync(opt.StoreId, ct)).Select(c => new
                {
                    id = c.Id, name = c.Name, colorCode = c.ColorCode, sortOrder = c.SortOrder,
                }),
                items = items.Select(i => new
                {
                    id = i.Id, categoryId = i.CategoryId, sku = i.Sku, name = i.Name,
                    basePrice = i.BasePrice, unit = i.Unit, imageUrl = i.ImageUrl,
                    printStation = i.PrintStation, isAvailable = i.IsAvailable,
                    allowedToppingIds = toppingMap.TryGetValue(i.Id, out var t) ? t : Array.Empty<Guid>(),
                }),
                toppings = (await menu.ListToppingsAsync(opt.StoreId, ct)).Select(t => new
                {
                    id = t.Id, name = t.Name, extraPrice = t.ExtraPrice, groupName = t.GroupName,
                }),
            });
        });

        // ------------------------------------------------------------------
        // Báo cáo doanh thu real-time cho NinoDash
        // ------------------------------------------------------------------
        lan.MapGet("/reports/dashboard", async (
            LanServerOptions opt, ITableRepository tables,
            IOrderRepository orders, IClock clock, CancellationToken ct) =>
        {
            var activeTables = await tables.ListAsync(opt.StoreId, null, ct);
            var now = clock.UtcNow;

            decimal totalNetRevenue = 0m;
            decimal totalGrossRevenue = 0m;
            decimal totalDiscount = 0m;
            int totalOrdersCount = 0;
            int totalGuestsCount = 0;
            int occupiedTablesCount = 0;

            foreach (var t in activeTables)
            {
                if (t.CurrentOrderId.HasValue)
                {
                    var order = await orders.GetByIdAsync(t.CurrentOrderId.Value, ct);
                    if (order is not null)
                    {
                        occupiedTablesCount++;
                        totalNetRevenue += order.FinalTotal;
                        totalGrossRevenue += order.Subtotal;
                        totalDiscount += order.DiscountAmount;
                        totalOrdersCount++;
                        totalGuestsCount += order.GuestCount;
                    }
                }
            }

            var avgOrderValue = totalOrdersCount > 0 ? totalNetRevenue / totalOrdersCount : 0m;
            var tableOccupancy = activeTables.Count > 0 ? (double)occupiedTablesCount / activeTables.Count * 100 : 0;

            return Results.Ok(new
            {
                netRevenue = totalNetRevenue,
                grossRevenue = totalGrossRevenue,
                totalDiscount = totalDiscount,
                totalOrders = totalOrdersCount,
                totalGuests = totalGuestsCount,
                avgOrderValue = avgOrderValue,
                revenueChangePercent = 0.0,
                tableOccupancyPercent = tableOccupancy,
                revenueByHour = new[]
                {
                    new { hour = now.Hour, revenue = (double)totalNetRevenue, orderCount = totalOrdersCount }
                },
                topSellingItems = Array.Empty<object>(),
                paymentBreakdown = new[]
                {
                    new { method = "CASH", amount = (double)totalNetRevenue, count = totalOrdersCount }
                },
                lowStockAlerts = Array.Empty<object>(),
                suspiciousActivities = Array.Empty<object>(),
            });
        });

        // ------------------------------------------------------------------
        // WebSocket
        // ------------------------------------------------------------------
        app.Map("/ws/lan/{channel}", async (string channel, HttpContext http, LanEventHub hub) =>
        {
            if (!http.WebSockets.IsWebSocketRequest)
            {
                http.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }
            if (channel is not (LanEventHub.ChannelKitchen or LanEventHub.ChannelTables))
            {
                http.Response.StatusCode = StatusCodes.Status404NotFound;
                return;
            }
            using var socket = await http.WebSockets.AcceptWebSocketAsync();
            await hub.HandleAsync(channel, socket, http.RequestAborted);
        });

        app.MapGet("/health", (LanEventHub hub) => Results.Ok(new
        {
            status = "ok",
            kitchenClients = hub.ConnectionCount(LanEventHub.ChannelKitchen),
            tableClients = hub.ConnectionCount(LanEventHub.ChannelTables),
            uptimeSeconds = (int)(Environment.TickCount64 / 1000),
        }));
    }

    // --- Tiện ích -----------------------------------------------------

    private static (Guid UserId, string UserName) ReadUser(HttpContext http)
    {
        if (LanAuthorization.TryGetIdentity(http, out var identity))
        {
            return (identity.DeviceId, identity.DeviceName);
        }

        return (Guid.Empty, "Nhân viên");
    }

    /// <summary>Lỗi theo chuẩn RFC 9457, đúng như khai trong openapi.yaml.</summary>
    private static IResult Problem(LanFailure failure, string message, int? rowVersion = null)
    {
        var status = failure switch
        {
            LanFailure.NotFound => StatusCodes.Status404NotFound,
            LanFailure.Conflict => StatusCodes.Status409Conflict,
            LanFailure.Forbidden => StatusCodes.Status403Forbidden,
            LanFailure.Unprocessable => StatusCodes.Status422UnprocessableEntity,
            _ => StatusCodes.Status400BadRequest,
        };
        var extensions = new Dictionary<string, object?>();
        if (rowVersion.HasValue) extensions["currentRowVersion"] = rowVersion.Value;

        return Results.Problem(
            title: message,
            statusCode: status,
            type: $"https://ninotek.vn/errors/{status}",
            extensions: extensions);
    }

    private static object Serialize(Order o, IReadOnlyList<OrderDetail> details) => new
    {
        id = o.Id,
        orderCode = o.OrderCode,
        tableId = o.TableId,
        userId = o.UserId,
        orderType = o.OrderType.ToString(),
        status = o.Status.ToString(),
        guestCount = o.GuestCount,
        subtotal = o.Subtotal,
        discountAmount = o.DiscountAmount,
        serviceFee = o.ServiceFee,
        vatAmount = o.VatAmount,
        finalTotal = o.FinalTotal,
        paidAmount = o.PaidAmount,
        note = o.Note,
        details = details.Select(SerializeDetail).ToArray(),
        createdAt = o.CreatedAt.ToString("O"),
        completedAt = o.CompletedAt?.ToString("O"),
        updatedAt = o.UpdatedAt.ToString("O"),
        rowVersion = o.RowVersion,
    };

    private static object SerializeDetail(OrderDetail d) => new
    {
        id = d.Id,
        itemId = d.ItemId,
        itemName = d.ItemNameSnapshot,
        quantity = d.Quantity,
        price = d.Price,
        toppingTotal = d.ToppingTotal,
        discountAmount = d.DiscountAmount,
        lineTotal = d.Quantity * (d.Price + d.ToppingTotal) - d.DiscountAmount,
        note = d.Note,
        kitchenStatus = d.KitchenStatus.ToString(),
        printedAt = d.PrintedAt?.ToString("O"),
        servedAt = d.ServedAt?.ToString("O"),
        toppings = d.Toppings.Select(t => new
        {
            toppingId = t.ToppingId,
            toppingName = t.ToppingNameSnapshot,
            extraPrice = t.ExtraPrice,
            quantity = t.Quantity,
        }).ToArray(),
        rowVersion = d.RowVersion,
    };
}
