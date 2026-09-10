// =====================================================================
//  NINOTEK F&B POS — Repository in-memory
// =====================================================================
//  Dùng cho: unit test, kiểm thử tích hợp, và chế độ demo khi chạy
//  NinoPOS lần đầu chưa có database.
//
//  Bản thật dùng EF Core + SQLite nằm ở Ninotek.POS.Data.
//  Cả hai hiện thực CÙNG một interface trong Core, nên logic nghiệp vụ
//  không biết mình đang chạy trên bản nào.
// =====================================================================

using System.Collections.Concurrent;
using Ninotek.POS.Core.Abstractions;
using Ninotek.POS.Core.Entities;
using Ninotek.POS.Core.Enums;

namespace Ninotek.POS.LanServer.Testing;

public sealed class InMemoryStore
{
    public ConcurrentDictionary<Guid, Order> Orders { get; } = new();
    public ConcurrentDictionary<Guid, OrderDetail> OrderDetails { get; } = new();
    public ConcurrentDictionary<Guid, Table> Tables { get; } = new();
    public ConcurrentDictionary<Guid, Area> Areas { get; } = new();
    public ConcurrentDictionary<Guid, Item> Items { get; } = new();
    public ConcurrentDictionary<Guid, Category> Categories { get; } = new();
    public ConcurrentDictionary<Guid, Topping> Toppings { get; } = new();
    public ConcurrentDictionary<Guid, Device> Devices { get; } = new();
    public List<(Order Order, IReadOnlyList<OrderDetail> Details)> PrintQueue { get; } = new();

    private long _sequence = 100_000;
    public string NextOrderCode() => "NINOPOS" + Interlocked.Increment(ref _sequence);
}

public sealed class InMemoryOrderRepository : IOrderRepository
{
    private readonly InMemoryStore _s;
    public InMemoryOrderRepository(InMemoryStore s) => _s = s;

    public Task<Order?> GetByIdAsync(Guid id, CancellationToken ct = default)
        => Task.FromResult(_s.Orders.TryGetValue(id, out var o) ? o : null);

    public Task<Order?> GetByCodeAsync(string orderCode, CancellationToken ct = default)
        => Task.FromResult(_s.Orders.Values.FirstOrDefault(o => o.OrderCode == orderCode));

    public Task<Order?> GetOpenOrderForTableAsync(Guid tableId, CancellationToken ct = default)
        => Task.FromResult(_s.Orders.Values.FirstOrDefault(o =>
               o.TableId == tableId &&
               o.Status is OrderStatus.PENDING or OrderStatus.SERVING));

    public Task AddAsync(Order order, CancellationToken ct = default)
    {
        _s.Orders[order.Id] = order;
        return Task.CompletedTask;
    }

    public Task<bool> UpdateAsync(Order order, int expectedRowVersion, CancellationToken ct = default)
    {
        if (!_s.Orders.TryGetValue(order.Id, out var current)) return Task.FromResult(false);
        if (current.RowVersion != expectedRowVersion) return Task.FromResult(false);
        order.RowVersion = expectedRowVersion + 1;   // giả lập trigger DB
        _s.Orders[order.Id] = order;
        return Task.FromResult(true);
    }

    public Task<string> NextOrderCodeAsync(Guid storeId, CancellationToken ct = default)
        => Task.FromResult(_s.NextOrderCode());
}

public sealed class InMemoryOrderDetailRepository : IOrderDetailRepository
{
    private readonly InMemoryStore _s;
    public InMemoryOrderDetailRepository(InMemoryStore s) => _s = s;

    public Task<OrderDetail?> GetByIdAsync(Guid id, CancellationToken ct = default)
        => Task.FromResult(_s.OrderDetails.TryGetValue(id, out var d) ? d : null);

    public Task AddRangeAsync(IEnumerable<OrderDetail> details, CancellationToken ct = default)
    {
        foreach (var d in details) _s.OrderDetails[d.Id] = d;
        return Task.CompletedTask;
    }

    public Task<bool> UpdateAsync(OrderDetail detail, int expectedRowVersion, CancellationToken ct = default)
    {
        if (!_s.OrderDetails.TryGetValue(detail.Id, out var current)) return Task.FromResult(false);
        if (current.RowVersion != expectedRowVersion) return Task.FromResult(false);
        detail.RowVersion = expectedRowVersion + 1;
        _s.OrderDetails[detail.Id] = detail;
        return Task.FromResult(true);
    }

    public Task<IReadOnlyList<OrderDetail>> ListByOrderAsync(Guid orderId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<OrderDetail>>(
               _s.OrderDetails.Values.Where(d => d.OrderId == orderId)
                 .OrderBy(d => d.CreatedAt).ToList());
}

public sealed class InMemoryTableRepository : ITableRepository
{
    private readonly InMemoryStore _s;
    public InMemoryTableRepository(InMemoryStore s) => _s = s;

    public Task<Table?> GetByIdAsync(Guid id, CancellationToken ct = default)
        => Task.FromResult(_s.Tables.TryGetValue(id, out var t) ? t : null);

    public Task<IReadOnlyList<Table>> ListAsync(Guid storeId, Guid? areaId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<Table>>(
               _s.Tables.Values
                 .Where(t => t.StoreId == storeId && (areaId is null || t.AreaId == areaId))
                 .OrderBy(t => t.SortOrder).ToList());

    public Task<bool> UpdateAsync(Table table, int expectedRowVersion, CancellationToken ct = default)
    {
        if (!_s.Tables.TryGetValue(table.Id, out var current)) return Task.FromResult(false);
        if (current.RowVersion != expectedRowVersion) return Task.FromResult(false);
        table.RowVersion = expectedRowVersion + 1;
        _s.Tables[table.Id] = table;
        return Task.FromResult(true);
    }
}

public sealed class InMemoryMenuRepository : IMenuRepository
{
    private readonly InMemoryStore _s;
    public InMemoryMenuRepository(InMemoryStore s) => _s = s;

    public Task<Item?> GetItemAsync(Guid id, CancellationToken ct = default)
        => Task.FromResult(_s.Items.TryGetValue(id, out var i) ? i : null);

    public Task<IReadOnlyList<Item>> ListItemsAsync(Guid storeId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<Item>>(
               _s.Items.Values.Where(i => i.StoreId == storeId && i.IsActive)
                 .OrderBy(i => i.SortOrder).ToList());

    public Task<IReadOnlyList<Category>> ListCategoriesAsync(Guid storeId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<Category>>(
               _s.Categories.Values.Where(c => c.StoreId == storeId && c.IsActive)
                 .OrderBy(c => c.SortOrder).ToList());

    public Task<IReadOnlyList<Topping>> ListToppingsAsync(Guid storeId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<Topping>>(
               _s.Toppings.Values.Where(t => t.StoreId == storeId && t.IsActive)
                 .OrderBy(t => t.SortOrder).ToList());

    public Task<IReadOnlyDictionary<Guid, IReadOnlyList<Guid>>> ListItemToppingMapAsync(
        Guid storeId, CancellationToken ct = default)
    {
        var all = _s.Toppings.Values.Where(t => t.StoreId == storeId).Select(t => t.Id).ToList();
        var map = _s.Items.Values.Where(i => i.StoreId == storeId)
            .ToDictionary(i => i.Id, _ => (IReadOnlyList<Guid>)all);
        return Task.FromResult<IReadOnlyDictionary<Guid, IReadOnlyList<Guid>>>(map);
    }

    public Task<string> GetMenuEtagAsync(Guid storeId, CancellationToken ct = default)
    {
        // ETag đổi khi bất kỳ món/danh mục/topping nào được sửa.
        var ticks = _s.Items.Values.Select(i => i.UpdatedAt.Ticks)
            .Concat(_s.Categories.Values.Select(c => c.UpdatedAt.Ticks))
            .Concat(_s.Toppings.Values.Select(t => t.UpdatedAt.Ticks))
            .DefaultIfEmpty(0).Max();
        var count = _s.Items.Count + _s.Categories.Count + _s.Toppings.Count;
        return Task.FromResult($"\"{ticks:x}-{count}\"");
    }
}

public sealed class InMemoryDeviceRepository : IDeviceRepository
{
    private readonly InMemoryStore _s;
    public InMemoryDeviceRepository(InMemoryStore s) => _s = s;

    public Task<Device?> GetByTokenAsync(string token, CancellationToken ct = default)
        => Task.FromResult(_s.Devices.Values.FirstOrDefault(
               d => d.PairingToken == token && d.IsApproved));

    public Task<int> CountApprovedAsync(Guid storeId, CancellationToken ct = default)
        => Task.FromResult(_s.Devices.Values.Count(d => d.StoreId == storeId && d.IsApproved));

    public Task AddAsync(Device device, CancellationToken ct = default)
    {
        _s.Devices[device.Id] = device;
        return Task.CompletedTask;
    }

    public Task TouchLastSeenAsync(Guid deviceId, DateTime at, CancellationToken ct = default)
    {
        if (_s.Devices.TryGetValue(deviceId, out var d)) d.LastSeenAt = at;
        return Task.CompletedTask;
    }
}

public sealed class InMemoryPrintJobQueue : IPrintJobQueue
{
    private readonly InMemoryStore _s;
    public InMemoryPrintJobQueue(InMemoryStore s) => _s = s;

    public Task EnqueueKitchenTicketAsync(Order order, IReadOnlyList<OrderDetail> details,
                                          CancellationToken ct = default)
    {
        lock (_s.PrintQueue) _s.PrintQueue.Add((order, details));
        return Task.CompletedTask;
    }
}
