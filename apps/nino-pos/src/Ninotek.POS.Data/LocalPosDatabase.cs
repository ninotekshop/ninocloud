using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Ninotek.POS.Core.Payments;

namespace Ninotek.POS.Data;

public sealed record LocalTable(Guid Id, string Name, string Status, int Seats, Guid? CurrentOrderId);
public sealed record LocalMenuItem(Guid Id, string Name, decimal Price, string Unit, bool IsAvailable, string PrintStation);
public sealed record LocalOrderLine(Guid ItemId, decimal Quantity, string? Note = null);
public sealed record LocalOrderReceipt(Guid OrderId, string OrderCode, decimal Total);
public sealed record LocalCashReceipt(Guid OrderId, decimal Total, decimal Change);
public sealed record LocalPrintJob(long Id, string JobType, string PrinterName, Guid? OrderId, string Payload);
public sealed record LocalSyncEntry(long Id, string EntityType, Guid EntityId, string Operation, string Payload);

/// <summary>
/// SQLite persistence for the Windows POS. Every write that affects a sale also
/// appends a sync_queue row and a print_jobs row in the same transaction.
/// </summary>
public sealed class LocalPosDatabase : IAsyncDisposable
{
    private readonly string _connectionString;
    private SqliteConnection? _connection;

    public LocalPosDatabase(string databasePath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(databasePath))!);
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
            ForeignKeys = true,
        }.ToString();
    }

    public Guid StoreId { get; private set; }
    public string StoreCode { get; private set; } = "NINO";
    public string StoreName { get; private set; } = "Ninotek Coffee";

    public async Task InitializeAsync(CancellationToken ct = default)
    {
        _connection = new SqliteConnection(_connectionString);
        await _connection.OpenAsync(ct);
        await ExecuteAsync("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;", ct);

        foreach (var sql in Schema)
        {
            await ExecuteAsync(sql, ct);
        }

        await SeedAsync(ct);
    }

    public async Task<IReadOnlyList<LocalTable>> ListTablesAsync(CancellationToken ct = default)
    {
        const string sql = "SELECT id, name, status, seat_capacity, current_order_id FROM tables ORDER BY sort_order, name";
        var result = new List<LocalTable>();
        await using var command = CreateCommand(sql);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            result.Add(new LocalTable(
                Guid.Parse(reader.GetString(0)),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetInt32(3),
                reader.IsDBNull(4) ? null : Guid.Parse(reader.GetString(4))));
        }
        return result;
    }

    public async Task<IReadOnlyList<LocalMenuItem>> ListMenuAsync(CancellationToken ct = default)
    {
        const string sql = "SELECT id, name, base_price, unit, is_available, print_station FROM items WHERE is_active=1 ORDER BY sort_order, name";
        var result = new List<LocalMenuItem>();
        await using var command = CreateCommand(sql);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            result.Add(new LocalMenuItem(
                Guid.Parse(reader.GetString(0)),
                reader.GetString(1),
                reader.GetDecimal(2),
                reader.GetString(3),
                reader.GetInt64(4) == 1,
                reader.GetString(5)));
        }
        return result;
    }

    public async Task<LocalOrderReceipt> CreateOrderAsync(
        Guid userId,
        Guid? tableId,
        IReadOnlyList<LocalOrderLine> lines,
        Guid? requestedOrderId = null,
        CancellationToken ct = default)
    {
        if (lines.Count == 0) throw new InvalidOperationException("Order must contain at least one item.");
        await using var transaction = (SqliteTransaction)await _connection!.BeginTransactionAsync(ct);
        var orderId = requestedOrderId ?? Guid.NewGuid();
        var orderCode = await NextOrderCodeAsync(transaction, ct);
        var now = DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture);
        decimal total = 0;
        var printableItems = new List<object>();

        foreach (var line in lines)
        {
            if (line.Quantity <= 0) throw new InvalidOperationException("Quantity must be positive.");
            await using var itemCommand = CreateCommand(
                "SELECT name, base_price, is_available FROM items WHERE id=$id AND is_active=1", transaction);
            itemCommand.Parameters.AddWithValue("$id", line.ItemId.ToString());
            await using var itemReader = await itemCommand.ExecuteReaderAsync(ct);
            if (!await itemReader.ReadAsync(ct)) throw new InvalidOperationException("Item is not available.");
            var itemName = itemReader.GetString(0);
            var price = itemReader.GetDecimal(1);
            if (itemReader.GetInt64(2) != 1) throw new InvalidOperationException($"Item {itemName} is sold out.");
            total += price * line.Quantity;
            printableItems.Add(new { name = itemName, quantity = line.Quantity, price });

            await using var detailCommand = CreateCommand(
                "INSERT INTO order_details(id, order_id, item_id, item_name_snapshot, quantity, price, line_total, note) VALUES($id,$order,$item,$name,$qty,$price,$line,$note)", transaction);
            detailCommand.Parameters.AddWithValue("$id", Guid.NewGuid().ToString());
            detailCommand.Parameters.AddWithValue("$order", orderId.ToString());
            detailCommand.Parameters.AddWithValue("$item", line.ItemId.ToString());
            detailCommand.Parameters.AddWithValue("$name", itemName);
            detailCommand.Parameters.AddWithValue("$qty", line.Quantity);
            detailCommand.Parameters.AddWithValue("$price", price);
            detailCommand.Parameters.AddWithValue("$line", price * line.Quantity);
            detailCommand.Parameters.AddWithValue("$note", (object?)line.Note ?? DBNull.Value);
            await detailCommand.ExecuteNonQueryAsync(ct);
        }

        await using (var orderCommand = CreateCommand(
            "INSERT INTO orders(id, store_id, order_code, table_id, user_id, status, guest_count, subtotal, final_total, created_at, updated_at) VALUES($id,$store,$code,$table,$user,'PENDING',1,$subtotal,$total,$now,$now)", transaction))
        {
            orderCommand.Parameters.AddWithValue("$id", orderId.ToString());
            orderCommand.Parameters.AddWithValue("$store", StoreId.ToString());
            orderCommand.Parameters.AddWithValue("$code", orderCode);
            orderCommand.Parameters.AddWithValue("$table", (object?)tableId?.ToString() ?? DBNull.Value);
            orderCommand.Parameters.AddWithValue("$user", userId.ToString());
            orderCommand.Parameters.AddWithValue("$subtotal", total);
            orderCommand.Parameters.AddWithValue("$total", total);
            orderCommand.Parameters.AddWithValue("$now", now);
            await orderCommand.ExecuteNonQueryAsync(ct);
        }

        if (tableId.HasValue)
        {
            await using var tableCommand = CreateCommand(
                "UPDATE tables SET status='OCCUPIED', current_order_id=$order, updated_at=$now WHERE id=$table", transaction);
            tableCommand.Parameters.AddWithValue("$order", orderId.ToString());
            tableCommand.Parameters.AddWithValue("$now", now);
            tableCommand.Parameters.AddWithValue("$table", tableId.Value.ToString());
            await tableCommand.ExecuteNonQueryAsync(ct);
        }

        var payload = JsonSerializer.Serialize(new
        {
            id = orderId,
            store_id = StoreId,
            order_code = orderCode,
            table_id = tableId,
            user_id = userId,
            status = "PENDING",
            subtotal = total,
            final_total = total,
            items = printableItems,
            created_at = now,
            updated_at = now,
            row_version = 1,
        });
        await EnqueueSyncAsync(transaction, "orders", orderId, "INSERT", payload, ct);
        await EnqueuePrintAsync(transaction, "KITCHEN_TICKET", "kitchen", orderId, payload, ct);
        await transaction.CommitAsync(ct);
        return new LocalOrderReceipt(orderId, orderCode, total);
    }

    public async Task<bool> HasOrderAsync(Guid orderId, CancellationToken ct = default)
    {
        await using var command = CreateCommand("SELECT 1 FROM orders WHERE id=$id LIMIT 1");
        command.Parameters.AddWithValue("$id", orderId.ToString());
        return await command.ExecuteScalarAsync(ct) is not null;
    }

    public async Task<IReadOnlyList<LocalOrderReceipt>> ListPendingTakeawayOrdersAsync(CancellationToken ct = default)
    {
        const string sql = "SELECT id, order_code, final_total FROM orders WHERE (table_id IS NULL OR table_id = '') AND status='PENDING' ORDER BY created_at DESC";
        var result = new List<LocalOrderReceipt>();
        await using var command = CreateCommand(sql);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            result.Add(new LocalOrderReceipt(
                Guid.Parse(reader.GetString(0)),
                reader.GetString(1),
                reader.GetDecimal(2)));
        }
        return result;
    }

    public async Task<IReadOnlyList<LocalOrderLine>> GetOrderLinesAsync(Guid orderId, CancellationToken ct = default)
    {
        const string sql = "SELECT item_id, quantity, note FROM order_details WHERE order_id=$order";
        var result = new List<LocalOrderLine>();
        await using var command = CreateCommand(sql);
        command.Parameters.AddWithValue("$order", orderId.ToString());
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            result.Add(new LocalOrderLine(
                Guid.Parse(reader.GetString(0)),
                reader.GetDecimal(1),
                reader.IsDBNull(2) ? null : reader.GetString(2)));
        }
        return result;
    }

    public async Task<IReadOnlyList<LocalSyncEntry>> PendingSyncAsync(int limit = 100, CancellationToken ct = default)
    {
        var entries = new List<LocalSyncEntry>();
        await using var command = CreateCommand("SELECT id, entity_type, entity_id, operation, payload FROM sync_queue WHERE status IN ('PENDING','FAILED') ORDER BY id LIMIT $limit");
        command.Parameters.AddWithValue("$limit", limit);
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            entries.Add(new LocalSyncEntry(reader.GetInt64(0), reader.GetString(1), Guid.Parse(reader.GetString(2)), reader.GetString(3), reader.GetString(4)));
        }
        return entries;
    }

    public async Task MarkSyncCompletedAsync(long queueId, CancellationToken ct = default)
    {
        await using var command = CreateCommand("UPDATE sync_queue SET status='SYNCED', synced_at=$now WHERE id=$id");
        command.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture));
        command.Parameters.AddWithValue("$id", queueId);
        await command.ExecuteNonQueryAsync(ct);
    }

    public async Task MarkSyncFailedAsync(long queueId, string? error, CancellationToken ct = default)
    {
        await using var command = CreateCommand("UPDATE sync_queue SET status='FAILED', retry_count=retry_count+1, last_error=$error WHERE id=$id");
        command.Parameters.AddWithValue("$error", (object?)error ?? DBNull.Value);
        command.Parameters.AddWithValue("$id", queueId);
        await command.ExecuteNonQueryAsync(ct);
    }

    public async Task<LocalCashReceipt> ReceiveCashAsync(
        Guid orderId,
        Guid cashierId,
        decimal receivedAmount,
        CancellationToken ct = default)
    {
        await using var transaction = (SqliteTransaction)await _connection!.BeginTransactionAsync(ct);
        var order = await ReadOrderTotalAsync(transaction, orderId, ct)
            ?? throw new InvalidOperationException("Order not found.");
        if (receivedAmount < order.Total) throw new InvalidOperationException("Insufficient cash received.");
        var now = DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture);
        var change = receivedAmount - order.Total;
        var paymentId = Guid.NewGuid();

        await using (var payment = CreateCommand(
            "INSERT INTO payments(id, store_id, order_id, payment_method, status, amount, received_amount, change_amount, paid_at, created_by_user_id) VALUES($id,$store,$order,'CASH','SUCCESS',$amount,$received,$change,$now,$user)", transaction))
        {
            payment.Parameters.AddWithValue("$id", paymentId.ToString());
            payment.Parameters.AddWithValue("$store", StoreId.ToString());
            payment.Parameters.AddWithValue("$order", orderId.ToString());
            payment.Parameters.AddWithValue("$amount", order.Total);
            payment.Parameters.AddWithValue("$received", receivedAmount);
            payment.Parameters.AddWithValue("$change", change);
            payment.Parameters.AddWithValue("$now", now);
            payment.Parameters.AddWithValue("$user", cashierId.ToString());
            await payment.ExecuteNonQueryAsync(ct);
        }

        await using (var orderUpdate = CreateCommand(
            "UPDATE orders SET status='COMPLETED', paid_amount=$amount, completed_at=$now, updated_at=$now WHERE id=$order", transaction))
        {
            orderUpdate.Parameters.AddWithValue("$amount", order.Total);
            orderUpdate.Parameters.AddWithValue("$now", now);
            orderUpdate.Parameters.AddWithValue("$order", orderId.ToString());
            await orderUpdate.ExecuteNonQueryAsync(ct);
        }

        var payload = JsonSerializer.Serialize(new { id = paymentId, order_id = orderId, order_code = order.OrderCode, total = order.Total, amount = order.Total, method = "CASH", status = "SUCCESS", paid_at = now });
        await EnqueueSyncAsync(transaction, "payments", paymentId, "INSERT", payload, ct);
        await EnqueuePrintAsync(transaction, "BILL", "bill", orderId, payload, ct);
        await transaction.CommitAsync(ct);
        return new LocalCashReceipt(orderId, order.Total, change);
    }

    public async Task<string> CreateVietQrAsync(Guid orderId, CancellationToken ct = default)
    {
        var order = await ReadOrderTotalAsync(null, orderId, ct)
            ?? throw new InvalidOperationException("Order not found.");
        var request = new VietQrRequest
        {
            AcqId = await SettingAsync("bank.acq_id", "970436", ct),
            AccountNo = await SettingAsync("bank.account_no", "0123456789", ct),
            AccountName = await SettingAsync("bank.account_name", StoreName, ct),
            MerchantCity = await SettingAsync("store.city", "QUY NHON", ct),
            Amount = checked((long)order.Total),
            AddInfo = order.OrderCode,
        };
        var payload = VietQrPayloadBuilder.Build(request);
        await using var command = CreateCommand("INSERT INTO payment_qr_sessions(id, store_id, order_id, amount, add_info, qr_code_raw, expires_at) VALUES($id,$store,$order,$amount,$info,$qr,$expires)");
        command.Parameters.AddWithValue("$id", Guid.NewGuid().ToString());
        command.Parameters.AddWithValue("$store", StoreId.ToString());
        command.Parameters.AddWithValue("$order", orderId.ToString());
        command.Parameters.AddWithValue("$amount", order.Total);
        command.Parameters.AddWithValue("$info", order.OrderCode);
        command.Parameters.AddWithValue("$qr", payload);
        command.Parameters.AddWithValue("$expires", DateTime.UtcNow.AddMinutes(15).ToString("O", CultureInfo.InvariantCulture));
        await command.ExecuteNonQueryAsync(ct);
        return payload;
    }

    public async Task<IReadOnlyList<LocalPrintJob>> PendingPrintJobsAsync(CancellationToken ct = default)
    {
        var jobs = new List<LocalPrintJob>();
        await using var command = CreateCommand("SELECT id, job_type, printer_name, order_id, payload FROM print_jobs WHERE status='PENDING' ORDER BY id");
        await using var reader = await command.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            jobs.Add(new LocalPrintJob(reader.GetInt64(0), reader.GetString(1), reader.GetString(2), reader.IsDBNull(3) ? null : Guid.Parse(reader.GetString(3)), reader.GetString(4)));
        }
        return jobs;
    }

    public async Task MarkPrintJobAsync(long id, bool success, string? error = null, CancellationToken ct = default)
    {
        await using var command = CreateCommand(success
            ? "UPDATE print_jobs SET status='DONE', printed_at=$now WHERE id=$id"
            : "UPDATE print_jobs SET status='FAILED', retry_count=retry_count+1, last_error=$error WHERE id=$id");
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$now", DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture));
        command.Parameters.AddWithValue("$error", (object?)error ?? DBNull.Value);
        await command.ExecuteNonQueryAsync(ct);
    }

    private async Task<(string OrderCode, decimal Total)?> ReadOrderTotalAsync(SqliteTransaction? transaction, Guid orderId, CancellationToken ct)
    {
        await using var command = CreateCommand("SELECT order_code, final_total FROM orders WHERE id=$id", transaction);
        command.Parameters.AddWithValue("$id", orderId.ToString());
        await using var reader = await command.ExecuteReaderAsync(ct);
        return await reader.ReadAsync(ct) ? (reader.GetString(0), reader.GetDecimal(1)) : null;
    }

    private async Task<string> NextOrderCodeAsync(SqliteTransaction transaction, CancellationToken ct)
    {
        long next;
        await using (var read = CreateCommand("SELECT last_number FROM order_sequences WHERE store_id=$store", transaction))
        {
            read.Parameters.AddWithValue("$store", StoreId.ToString());
            await using var reader = await read.ExecuteReaderAsync(ct);
            next = await reader.ReadAsync(ct) ? reader.GetInt64(0) + 1 : 100001;
        }
        await using var update = CreateCommand("INSERT INTO order_sequences(store_id,last_number) VALUES($store,$number) ON CONFLICT(store_id) DO UPDATE SET last_number=excluded.last_number", transaction);
        update.Parameters.AddWithValue("$store", StoreId.ToString());
        update.Parameters.AddWithValue("$number", next);
        await update.ExecuteNonQueryAsync(ct);
        return $"{StoreCode}{next.ToString(CultureInfo.InvariantCulture)}";
    }

    private async Task<string> SettingAsync(string key, string fallback, CancellationToken ct)
    {
        await using var command = CreateCommand("SELECT value FROM app_settings WHERE key=$key");
        command.Parameters.AddWithValue("$key", key);
        var value = await command.ExecuteScalarAsync(ct);
        return value is string text && !string.IsNullOrWhiteSpace(text) ? text : fallback;
    }

    private async Task EnqueueSyncAsync(SqliteTransaction transaction, string type, Guid entityId, string operation, string payload, CancellationToken ct)
    {
        await using var command = CreateCommand("INSERT INTO sync_queue(store_id,entity_type,entity_id,operation,payload) VALUES($store,$type,$id,$operation,$payload)", transaction);
        command.Parameters.AddWithValue("$store", StoreId.ToString());
        command.Parameters.AddWithValue("$type", type);
        command.Parameters.AddWithValue("$id", entityId.ToString());
        command.Parameters.AddWithValue("$operation", operation);
        command.Parameters.AddWithValue("$payload", payload);
        await command.ExecuteNonQueryAsync(ct);
    }

    private async Task EnqueuePrintAsync(SqliteTransaction transaction, string type, string printer, Guid orderId, string payload, CancellationToken ct)
    {
        await using var command = CreateCommand("INSERT INTO print_jobs(store_id,job_type,printer_name,order_id,payload) VALUES($store,$type,$printer,$order,$payload)", transaction);
        command.Parameters.AddWithValue("$store", StoreId.ToString());
        command.Parameters.AddWithValue("$type", type);
        command.Parameters.AddWithValue("$printer", printer);
        command.Parameters.AddWithValue("$order", orderId.ToString());
        command.Parameters.AddWithValue("$payload", payload);
        await command.ExecuteNonQueryAsync(ct);
    }

    private SqliteCommand CreateCommand(string sql, SqliteTransaction? transaction = null)
    {
        var command = _connection!.CreateCommand();
        command.CommandText = sql;
        command.Transaction = transaction;
        return command;
    }

    private async Task ExecuteAsync(string sql, CancellationToken ct)
    {
        await using var command = CreateCommand(sql);
        await command.ExecuteNonQueryAsync(ct);
    }

    private async Task SeedAsync(CancellationToken ct)
    {
        await using var transaction = (SqliteTransaction)await _connection!.BeginTransactionAsync(ct);
        await using var storeCommand = CreateCommand("SELECT id, code, name FROM stores LIMIT 1", transaction);
        await using var reader = await storeCommand.ExecuteReaderAsync(ct);
        if (await reader.ReadAsync(ct))
        {
            StoreId = Guid.Parse(reader.GetString(0));
            StoreCode = reader.GetString(1);
            StoreName = reader.GetString(2);
            await transaction.CommitAsync(ct);
            await EnsureSampleCatalogAsync(ct);
            return;
        }
        StoreId = Guid.Parse("22222222-2222-4222-8222-222222222222");
        StoreCode = "QN01";
        StoreName = "Ninotek Coffee - Quy Nhon";
        await ExecuteInTransactionAsync(transaction, "INSERT INTO stores(id,code,name,bank_acq_id,bank_account_no,bank_account_name) VALUES($id,$code,$name,'970436','0123456789','NINOTEK COFFEE - QUY NHON')", new Dictionary<string, object?> { ["$id"] = StoreId.ToString(), ["$code"] = StoreCode, ["$name"] = StoreName }, ct);
        var areaId = Guid.NewGuid();
        await ExecuteInTransactionAsync(transaction, "INSERT INTO areas(id,store_id,name,sort_order) VALUES($id,$store,'Main room',1)", new Dictionary<string, object?> { ["$id"] = areaId.ToString(), ["$store"] = StoreId.ToString() }, ct);
        for (var i = 1; i <= 8; i++)
        {
            var tableId = Guid.Parse($"aaaaaaaa-0000-4000-8000-{i:D12}");
            await ExecuteInTransactionAsync(transaction, "INSERT INTO tables(id,store_id,area_id,name,seat_capacity,sort_order) VALUES($id,$store,$area,$name,4,$sort)", new Dictionary<string, object?> { ["$id"] = tableId.ToString(), ["$store"] = StoreId.ToString(), ["$area"] = areaId.ToString(), ["$name"] = $"Ban {i:00}", ["$sort"] = i }, ct);
        }
        var items = SampleItems;
        for (var i = 0; i < items.Length; i++)
        {
            await ExecuteInTransactionAsync(transaction, "INSERT INTO items(id,store_id,name,base_price,unit,print_station,sort_order) VALUES($id,$store,$name,$price,$unit,$station,$sort)", new Dictionary<string, object?> { ["$id"] = items[i].Id.ToString(), ["$store"] = StoreId.ToString(), ["$name"] = items[i].Name, ["$price"] = items[i].Price, ["$unit"] = items[i].Unit, ["$station"] = items[i].Station, ["$sort"] = i + 1 }, ct);
        }
        await ExecuteInTransactionAsync(transaction, "INSERT INTO order_sequences(store_id,last_number) VALUES($store,100000)", new Dictionary<string, object?> { ["$store"] = StoreId.ToString() }, ct);
        await ExecuteInTransactionAsync(transaction, "INSERT INTO app_settings(key,value) VALUES('bank.acq_id','970436'),('bank.account_no','0123456789'),('bank.account_name','NINOTEK COFFEE - QUY NHON'),('store.city','QUY NHON')", null, ct);
        await transaction.CommitAsync(ct);
    }

    private async Task EnsureSampleCatalogAsync(CancellationToken ct)
    {
        await using var transaction = (SqliteTransaction)await _connection!.BeginTransactionAsync(ct);
        var areaId = Guid.Parse("44444444-4444-4444-8444-000000000001");
        await ExecuteInTransactionAsync(transaction, "INSERT OR IGNORE INTO areas(id,store_id,name,sort_order) VALUES($id,$store,'Tầng 1',1)", new Dictionary<string, object?> { ["$id"] = areaId.ToString(), ["$store"] = StoreId.ToString() }, ct);
        for (var i = 1; i <= 8; i++)
        {
            var tableId = Guid.Parse($"aaaaaaaa-0000-4000-8000-{i:D12}");
            await ExecuteInTransactionAsync(transaction, "INSERT OR IGNORE INTO tables(id,store_id,area_id,name,seat_capacity,sort_order) VALUES($id,$store,$area,$name,4,$sort)", new Dictionary<string, object?> { ["$id"] = tableId.ToString(), ["$store"] = StoreId.ToString(), ["$area"] = areaId.ToString(), ["$name"] = $"Bàn {i:00}", ["$sort"] = i }, ct);
        }

        var items = SampleItems;
        for (var i = 0; i < items.Length; i++)
        {
            await ExecuteInTransactionAsync(transaction, "INSERT OR IGNORE INTO items(id,store_id,name,base_price,unit,print_station,sort_order) VALUES($id,$store,$name,$price,$unit,$station,$sort)", new Dictionary<string, object?> { ["$id"] = items[i].Id.ToString(), ["$store"] = StoreId.ToString(), ["$name"] = items[i].Name, ["$price"] = items[i].Price, ["$unit"] = items[i].Unit, ["$station"] = items[i].Station, ["$sort"] = i + 1 }, ct);
        }

        await ExecuteInTransactionAsync(transaction, "INSERT OR IGNORE INTO order_sequences(store_id,last_number) VALUES($store,100000)", new Dictionary<string, object?> { ["$store"] = StoreId.ToString() }, ct);
        await ExecuteInTransactionAsync(transaction, "INSERT OR IGNORE INTO app_settings(key,value) VALUES('bank.acq_id','970436'),('bank.account_no','0123456789'),('bank.account_name','NINOTEK COFFEE - QUY NHON'),('store.city','QUY NHON')", null, ct);
        await transaction.CommitAsync(ct);
    }

    private async Task ExecuteInTransactionAsync(SqliteTransaction transaction, string sql, IReadOnlyDictionary<string, object?>? parameters, CancellationToken ct)
    {
        await using var command = CreateCommand(sql, transaction);
        if (parameters is not null)
        {
            foreach (var parameter in parameters) command.Parameters.AddWithValue(parameter.Key, parameter.Value ?? DBNull.Value);
        }
        await command.ExecuteNonQueryAsync(ct);
    }

    public async ValueTask DisposeAsync()
    {
        if (_connection is not null) await _connection.DisposeAsync();
    }

    private static readonly string[] Schema =
    [
        "CREATE TABLE IF NOT EXISTS stores(id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, bank_acq_id TEXT, bank_account_no TEXT, bank_account_name TEXT)",
        "CREATE TABLE IF NOT EXISTS areas(id TEXT PRIMARY KEY, store_id TEXT NOT NULL, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)",
        "CREATE TABLE IF NOT EXISTS tables(id TEXT PRIMARY KEY, store_id TEXT NOT NULL, area_id TEXT NOT NULL, name TEXT NOT NULL, seat_capacity INTEGER NOT NULL DEFAULT 4, status TEXT NOT NULL DEFAULT 'EMPTY', current_order_id TEXT, sort_order INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(store_id,name))",
        "CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, store_id TEXT NOT NULL, name TEXT NOT NULL, base_price NUMERIC NOT NULL, unit TEXT NOT NULL, print_station TEXT NOT NULL DEFAULT 'BAR', is_available INTEGER NOT NULL DEFAULT 1, is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0)",
        "CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, store_id TEXT NOT NULL, order_code TEXT NOT NULL, table_id TEXT, user_id TEXT NOT NULL, status TEXT NOT NULL, guest_count INTEGER NOT NULL DEFAULT 1, subtotal NUMERIC NOT NULL, discount_amount NUMERIC NOT NULL DEFAULT 0, final_total NUMERIC NOT NULL, paid_amount NUMERIC NOT NULL DEFAULT 0, created_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL, UNIQUE(store_id,order_code))",
        "CREATE TABLE IF NOT EXISTS order_details(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, item_id TEXT NOT NULL, item_name_snapshot TEXT NOT NULL, quantity NUMERIC NOT NULL, price NUMERIC NOT NULL, topping_total NUMERIC NOT NULL DEFAULT 0, discount_amount NUMERIC NOT NULL DEFAULT 0, line_total NUMERIC NOT NULL, note TEXT, kitchen_status TEXT NOT NULL DEFAULT 'WAITING')",
        "CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY, store_id TEXT NOT NULL, order_id TEXT NOT NULL, payment_method TEXT NOT NULL, status TEXT NOT NULL, amount NUMERIC NOT NULL, received_amount NUMERIC, change_amount NUMERIC NOT NULL DEFAULT 0, transaction_ref TEXT, paid_at TEXT, created_by_user_id TEXT)",
        "CREATE TABLE IF NOT EXISTS payment_qr_sessions(id TEXT PRIMARY KEY, store_id TEXT NOT NULL, order_id TEXT NOT NULL, amount NUMERIC NOT NULL, add_info TEXT NOT NULL, qr_code_raw TEXT NOT NULL, expires_at TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS sync_queue(id INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', retry_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        "CREATE TABLE IF NOT EXISTS print_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT NOT NULL, job_type TEXT NOT NULL, printer_name TEXT NOT NULL, order_id TEXT, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', retry_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, printed_at TEXT)",
        "CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY, value TEXT)",
        "CREATE TABLE IF NOT EXISTS order_sequences(store_id TEXT PRIMARY KEY, last_number INTEGER NOT NULL DEFAULT 100000)",
    ];

    private static readonly (Guid Id, string Name, decimal Price, string Unit, string Station)[] SampleItems =
    [
        (Guid.Parse("77777777-7777-4777-8777-000000000001"), "Cà phê đen đá", 18000m, "ly", "BAR"),
        (Guid.Parse("77777777-7777-4777-8777-000000000002"), "Cà phê sữa đá", 22000m, "ly", "BAR"),
        (Guid.Parse("77777777-7777-4777-8777-000000000003"), "Trà đào cam sả", 35000m, "ly", "BAR"),
        (Guid.Parse("77777777-7777-4777-8777-000000000004"), "Khoai tây chiên", 35000m, "phần", "KITCHEN"),
        (Guid.Parse("77777777-7777-4777-8777-000000000005"), "Bia 333", 18000m, "chai", "BAR"),
        (Guid.Parse("77777777-7777-4777-8777-000000000006"), "Bia Tiger", 22000m, "chai", "BAR"),
        (Guid.Parse("77777777-7777-4777-8777-000000000007"), "Lẩu Thái hải sản", 180000m, "nồi", "KITCHEN"),
        (Guid.Parse("77777777-7777-4777-8777-000000000008"), "Cánh gà chiên nước mắm", 95000m, "phần", "KITCHEN"),
        (Guid.Parse("77777777-7777-4777-8777-000000000009"), "Mực nướng sa tế", 120000m, "phần", "KITCHEN"),
        (Guid.Parse("77777777-7777-4777-8777-00000000000a"), "Nước suối", 12000m, "chai", "BAR"),
        (Guid.Parse("77777777-7777-4777-8777-00000000000b"), "Nước ngọt", 15000m, "lon", "BAR"),
        (Guid.Parse("77777777-7777-4777-8777-00000000000c"), "Trái cây theo mùa", 65000m, "đĩa", "KITCHEN"),
    ];
}
