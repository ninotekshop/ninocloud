// =====================================================================
//  NINOTEK F&B POS — Kênh WebSocket LAN
// =====================================================================
//  Chạy NGAY TRONG máy thu ngân, không qua Internet. Đây là lý do
//  NinoOrder vẫn gọi món được khi quán mất mạng.
//
//  Khớp với packages/api-contracts/asyncapi.yaml:
//    /ws/lan/kitchen  — ORDER_CREATED, KITCHEN_STATUS_CHANGED, ORDER_ITEM_CANCELLED
//    /ws/lan/tables   — TABLE_STATUS_CHANGED, TABLE_LOCKED
//
//  Mỗi message có eventId để client khử trùng lặp khi kết nối lại.
// =====================================================================

using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Ninotek.POS.Core.Abstractions;
using Ninotek.POS.Core.Entities;

namespace Ninotek.POS.LanServer.Hubs;

public sealed record EventEnvelope(string Event, string EventId, string SentAt, object Data);

public sealed class LanEventHub : ILanEventPublisher
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>Số sự kiện gần nhất giữ lại cho mỗi kênh, phát lại khi client nối lại.</summary>
    private const int ReplayBufferSize = 20;

    private readonly ConcurrentDictionary<string, ConcurrentDictionary<Guid, WebSocket>> _channels = new();
    private readonly ConcurrentDictionary<string, List<EventEnvelope>> _recent = new();
    private readonly ILogger<LanEventHub> _logger;

    public LanEventHub(ILogger<LanEventHub> logger) => _logger = logger;

    public const string ChannelKitchen = "kitchen";
    public const string ChannelTables = "tables";

    public async Task HandleAsync(string channel, WebSocket socket, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        var sockets = _channels.GetOrAdd(channel, _ => new ConcurrentDictionary<Guid, WebSocket>());
        sockets[id] = socket;
        _logger.LogInformation("Thiết bị đã vào kênh {Channel} ({Count} đang kết nối)",
            channel, sockets.Count);

        // Phát lại các sự kiện gần nhất — client lọc theo eventId nên an toàn.
        if (_recent.TryGetValue(channel, out var buffered))
        {
            EventEnvelope[] snapshot;
            lock (buffered) snapshot = buffered.ToArray();
            foreach (var e in snapshot) await SendAsync(socket, e, ct);
        }

        try
        {
            // Giữ kết nối mở. Tablet chỉ nhận, không gửi qua kênh này —
            // mọi thao tác ghi đều đi qua REST để có mã lỗi rõ ràng.
            var buffer = new byte[1024];
            while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var result = await socket.ReceiveAsync(buffer, ct);
                if (result.MessageType == WebSocketMessageType.Close) break;
            }
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException ex)
        {
            _logger.LogDebug("Kênh {Channel} ngắt: {Message}", channel, ex.Message);
        }
        finally
        {
            sockets.TryRemove(id, out _);
            _logger.LogInformation("Thiết bị rời kênh {Channel} ({Count} còn lại)",
                channel, sockets.Count);
        }
    }

    private async Task BroadcastAsync(string channel, string eventName, object data,
                                      CancellationToken ct)
    {
        var envelope = new EventEnvelope(
            eventName, Guid.NewGuid().ToString(),
            DateTime.UtcNow.ToString("O"), data);

        var buffer = _recent.GetOrAdd(channel, _ => new List<EventEnvelope>());
        lock (buffer)
        {
            buffer.Add(envelope);
            if (buffer.Count > ReplayBufferSize) buffer.RemoveAt(0);
        }

        if (!_channels.TryGetValue(channel, out var sockets)) return;

        foreach (var (id, socket) in sockets)
        {
            if (socket.State != WebSocketState.Open) { sockets.TryRemove(id, out _); continue; }
            try { await SendAsync(socket, envelope, ct); }
            catch (Exception ex)
            {
                // Một tablet chết không được làm hỏng việc phát tới các tablet khác.
                _logger.LogWarning("Không gửi được tới một thiết bị: {Message}", ex.Message);
                sockets.TryRemove(id, out _);
            }
        }
        _logger.LogInformation("Đã phát {Event} lên kênh {Channel}", eventName, channel);
    }

    private static async Task SendAsync(WebSocket socket, EventEnvelope envelope, CancellationToken ct)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(envelope, JsonOptions);
        await socket.SendAsync(json, WebSocketMessageType.Text, true, ct);
    }

    // --- ILanEventPublisher -------------------------------------------

    public Task PublishOrderCreatedAsync(Order order, IReadOnlyList<OrderDetail> details,
                                         string? tableName, CancellationToken ct = default)
        => BroadcastAsync(ChannelKitchen, "ORDER_CREATED", new
        {
            orderId = order.Id,
            orderCode = order.OrderCode,
            tableId = order.TableId,
            tableName,
            items = details.Select(d => new
            {
                orderDetailId = d.Id,
                itemName = d.ItemNameSnapshot,
                quantity = d.Quantity,
                note = d.Note,
                toppings = d.Toppings.Select(t => t.ToppingNameSnapshot).ToArray(),
            }).ToArray(),
        }, ct);

    public Task PublishKitchenStatusAsync(OrderDetail detail, CancellationToken ct = default)
        => BroadcastAsync(ChannelKitchen, "KITCHEN_STATUS_CHANGED", new
        {
            orderId = detail.OrderId,
            orderDetailId = detail.Id,
            itemName = detail.ItemNameSnapshot,
            kitchenStatus = detail.KitchenStatus.ToString(),
            rowVersion = detail.RowVersion,
        }, ct);

    public Task PublishTableStatusAsync(Table table, Order? currentOrder,
                                        CancellationToken ct = default)
        => BroadcastAsync(ChannelTables, "TABLE_STATUS_CHANGED", new
        {
            tableId = table.Id,
            tableName = table.Name,
            status = table.Status.ToString(),
            currentOrderId = table.CurrentOrderId,
            guestCount = currentOrder?.GuestCount,
            runningTotal = currentOrder?.FinalTotal,
            rowVersion = table.RowVersion,
        }, ct);

    public Task PublishTableLockedAsync(Table table, string lockedByName, DateTime lockedUntil,
                                        CancellationToken ct = default)
        => BroadcastAsync(ChannelTables, "TABLE_LOCKED", new
        {
            tableId = table.Id,
            lockedByUserId = table.LockedByUserId,
            lockedByUserName = lockedByName,
            lockedUntil = lockedUntil.ToString("O"),
        }, ct);

    public int ConnectionCount(string channel)
        => _channels.TryGetValue(channel, out var s) ? s.Count : 0;
}
