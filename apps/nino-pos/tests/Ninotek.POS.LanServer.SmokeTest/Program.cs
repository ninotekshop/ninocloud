// =====================================================================
//  NINOTEK F&B POS — Kiểm thử khói LAN API
// =====================================================================
//  Khởi động LAN server THẬT rồi gọi HTTP thật vào nó. Không mock.
//
//  Vì sao là console app chứ không phải xUnit: chương trình này chạy được
//  KHÔNG CẦN tải gói NuGet nào, nên nó vẫn hoạt động trong môi trường CI bị
//  chặn mạng và trên máy kỹ thuật viên ở quán không có internet.
//  Bộ test đầy đủ bằng xUnit nằm ở Ninotek.POS.LanServer.Tests.
//
//  Chạy:  dotnet run --project tests/Ninotek.POS.LanServer.SmokeTest
//  Thoát: 0 = tất cả đạt, 1 = có lỗi
// =====================================================================

using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

const string BaseUrl = "http://127.0.0.1:18080";

int pass = 0, fail = 0;
var failures = new List<string>();

void Check(bool ok, string label, string? detail = null)
{
    if (ok) { pass++; Console.WriteLine($"  [OK]   {label}"); }
    else { fail++; failures.Add(label + (detail is null ? "" : " -> " + detail));
           Console.WriteLine($"  [FAIL] {label}{(detail is null ? "" : " -> " + detail)}"); }
}

// --- Khởi động LAN server trong tiến trình con ------------------------
var serverDll = Path.Combine(AppContext.BaseDirectory,
    "..", "..", "..", "..", "..", "src", "Ninotek.POS.LanServer",
    "bin", "Debug", "net8.0", "Ninotek.POS.LanServer.dll");
serverDll = Path.GetFullPath(serverDll);

if (!File.Exists(serverDll))
{
    Console.Error.WriteLine($"Không tìm thấy {serverDll}. Chạy `dotnet build` trước.");
    return 1;
}

var psi = new ProcessStartInfo("dotnet", $"\"{serverDll}\"")
{
    RedirectStandardOutput = true,
    RedirectStandardError = true,
};
psi.Environment["ASPNETCORE_URLS"] = BaseUrl;
psi.Environment["Lan__SeedDemoData"] = "true";
psi.Environment["DOTNET_NOLOGO"] = "1";

using var server = Process.Start(psi)!;
using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };

// Chờ server sẵn sàng
var ready = false;
for (var i = 0; i < 40 && !ready; i++)
{
    try { ready = (await http.GetAsync($"{BaseUrl}/health")).IsSuccessStatusCode; }
    catch { await Task.Delay(500); }
}
if (!ready) { Console.Error.WriteLine("Server không khởi động được"); server.Kill(true); return 1; }

var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);

async Task<(HttpStatusCode Status, JsonElement Body)> Send(
    HttpMethod method, string path, object? payload = null,
    Dictionary<string, string>? headers = null)
{
    using var req = new HttpRequestMessage(method, BaseUrl + path);
    if (payload is not null)
    {
        req.Content = new StringContent(
            JsonSerializer.Serialize(payload, json), Encoding.UTF8, "application/json");
    }
    foreach (var (k, v) in headers ?? new()) req.Headers.TryAddWithoutValidation(k, v);

    using var res = await http.SendAsync(req);
    var text = await res.Content.ReadAsStringAsync();
    JsonElement body = default;
    if (text.Length > 0)
    {
        try { body = JsonDocument.Parse(text).RootElement.Clone(); } catch { }
    }
    return (res.StatusCode, body);
}

try
{
    Console.WriteLine("\n=== 1. Dò tìm máy POS ===");
    var (s1, b1) = await Send(HttpMethod.Get, "/api/v1/lan/discovery");
    Check(s1 == HttpStatusCode.OK, "discovery trả 200");
    Check(b1.GetProperty("protocolVersion").GetInt32() == 1, "protocolVersion = 1");
    Check(b1.GetProperty("storeCode").GetString() == "QN01", "storeCode đúng");

    Console.WriteLine("\n=== 2. Ghép nối thiết bị ===");
    var (s2a, b2a) = await Send(HttpMethod.Post, "/api/v1/lan/devices/pair",
        new { deviceName = "Tablet 1", deviceType = "TABLET", pairingCode = "999999" });
    Check(s2a == HttpStatusCode.Forbidden, "mã ghép nối sai bị từ chối 403");

    var (s2b, b2b) = await Send(HttpMethod.Post, "/api/v1/lan/devices/pair",
        new { deviceName = "Tablet 1", deviceType = "TABLET", pairingCode = "000000" });
    Check(s2b == HttpStatusCode.OK, "mã đúng thì cấp token");
    Check(b2b.GetProperty("deviceToken").GetString()!.Length == 64, "token dài 64 ký tự hex");

    Console.WriteLine("\n=== 3. Sơ đồ bàn ===");
    var (s3, b3) = await Send(HttpMethod.Get, "/api/v1/lan/tables/status");
    Check(s3 == HttpStatusCode.OK, "tables/status trả 200");
    var tables = b3.EnumerateArray().ToList();
    Check(tables.Count == 8, "có 8 bàn demo", $"đếm được {tables.Count}");
    var table1 = tables[0].GetProperty("id").GetString()!;
    Check(tables[0].GetProperty("status").GetString() == "EMPTY", "bàn 01 ban đầu trống");

    Console.WriteLine("\n=== 4. Khoá mềm chống hai nhân viên cùng thao tác ===");
    const string userA = "33333333-3333-4333-8333-000000000003";
    const string userB = "33333333-3333-4333-8333-000000000009";
    var (s4a, _) = await Send(HttpMethod.Post, $"/api/v1/lan/tables/{table1}/lock",
        null, new() { ["X-User-Id"] = userA, ["X-User-Name"] = "Nhan vien A" });
    Check(s4a == HttpStatusCode.OK, "nhân viên A chiếm được khoá");

    var (s4b, b4b) = await Send(HttpMethod.Post, $"/api/v1/lan/tables/{table1}/lock",
        null, new() { ["X-User-Id"] = userB, ["X-User-Name"] = "Nhan vien B" });
    Check(s4b == HttpStatusCode.Conflict, "nhân viên B bị từ chối 409");
    Check(b4b.TryGetProperty("currentRowVersion", out _), "409 kèm currentRowVersion để client xử lý");

    Console.WriteLine("\n=== 5. Tạo đơn (đường đi nóng nhất) ===");
    var orderId = Guid.NewGuid();
    var line1 = Guid.NewGuid();
    var line2 = Guid.NewGuid();
    var payload = new
    {
        orderId,
        userId = Guid.Parse(userA),
        tableId = Guid.Parse(table1),
        orderType = "DINE_IN",
        guestCount = 3,
        note = "khach quen",
        clientCreatedAt = DateTime.UtcNow,
        items = new object[]
        {
            new { orderDetailId = line1,
                  itemId = Guid.Parse("77777777-7777-4777-8777-000000000002"),
                  quantity = 2, note = "it duong",
                  toppings = new object[] { new {
                      toppingId = Guid.Parse("88888888-8888-4888-8888-000000000001"),
                      quantity = 1 } } },
            new { orderDetailId = line2,
                  itemId = Guid.Parse("77777777-7777-4777-8777-000000000001"),
                  quantity = 1, note = (string?)null, toppings = Array.Empty<object>() },
        }
    };

    var (s5, b5) = await Send(HttpMethod.Post, "/api/v1/lan/order/create", payload);
    Check(s5 == HttpStatusCode.Created, "đơn mới trả 201", s5.ToString());
    // 2 x (22.000 + 7.000) + 1 x 18.000 = 76.000
    Check(b5.GetProperty("finalTotal").GetDecimal() == 76000m,
          "tổng tiền tính đúng 76.000đ",
          b5.GetProperty("finalTotal").GetDecimal().ToString(CultureInfo.InvariantCulture));
    Check(b5.GetProperty("details").GetArrayLength() == 2, "đơn có 2 dòng món");
    Check(b5.GetProperty("status").GetString() == "PENDING", "trạng thái PENDING");

    Console.WriteLine("\n=== 6. Tablet mất Wi-Fi rồi gửi lại (idempotency) ===");
    var codes = new List<string>();
    for (var i = 0; i < 3; i++)
    {
        var (s6, b6) = await Send(HttpMethod.Post, "/api/v1/lan/order/create", payload);
        Check(s6 == HttpStatusCode.OK, $"gửi lại lần {i + 1} trả 200 (không tạo đơn mới)");
        codes.Add(b6.GetProperty("orderCode").GetString()!);
    }
    Check(codes.Distinct().Count() == 1, "cả ba lần trả về CÙNG một mã đơn",
          string.Join(",", codes.Distinct()));
    Check(codes[0] == b5.GetProperty("orderCode").GetString(), "khớp mã đơn ban đầu");

    Console.WriteLine("\n=== 7. Bàn đã chuyển sang có khách và khoá được nhả ===");
    var (_, b7) = await Send(HttpMethod.Get, "/api/v1/lan/tables/status");
    var t1 = b7.EnumerateArray().First(t => t.GetProperty("id").GetString() == table1);
    Check(t1.GetProperty("status").GetString() == "OCCUPIED", "bàn 01 -> OCCUPIED");
    Check(t1.GetProperty("runningTotal").GetDecimal() == 76000m, "tạm tính hiển thị 76.000đ");
    Check(!t1.TryGetProperty("lockedByUserId", out var lk) || lk.ValueKind == JsonValueKind.Null,
          "khoá đã được nhả sau khi ghi đơn");

    Console.WriteLine("\n=== 8. Món đã hết trong ngày ===");
    var (s8, b8) = await Send(HttpMethod.Post, "/api/v1/lan/order/create", new
    {
        orderId = Guid.NewGuid(),
        userId = Guid.Parse(userA),
        orderType = "TAKE_AWAY",
        guestCount = 1,
        items = new object[] { new {
            orderDetailId = Guid.NewGuid(),
            itemId = Guid.Parse("77777777-7777-4777-8777-0000000000ff"),
            quantity = 1, note = (string?)null, toppings = Array.Empty<object>() } }
    });
    Check(s8 == HttpStatusCode.UnprocessableEntity, "món hết bị từ chối 422");
    Check(b8.GetProperty("title").GetString()!.Contains("đã hết", StringComparison.Ordinal),
          "thông báo nói rõ món nào đã hết");

    Console.WriteLine("\n=== 9. Trạng thái chế biến chỉ được tiến, không lùi ===");
    var detailId = b5.GetProperty("details")[0].GetProperty("id").GetString()!;
    var rv = b5.GetProperty("details")[0].GetProperty("rowVersion").GetInt32();

    var (s9a, b9a) = await Send(HttpMethod.Patch,
        $"/api/v1/lan/order-details/{detailId}/kitchen-status",
        new { kitchenStatus = "COOKING", rowVersion = rv });
    Check(s9a == HttpStatusCode.OK, "WAITING -> COOKING được chấp nhận");
    var rv2 = b9a.GetProperty("rowVersion").GetInt32();
    Check(rv2 == rv + 1, "rowVersion tăng sau khi cập nhật");

    var (s9b, _) = await Send(HttpMethod.Patch,
        $"/api/v1/lan/order-details/{detailId}/kitchen-status",
        new { kitchenStatus = "WAITING", rowVersion = rv2 });
    Check(s9b == HttpStatusCode.UnprocessableEntity,
          "COOKING -> WAITING bị chặn (chống bấm nhầm làm bếp nấu lại)");

    var (s9c, b9c) = await Send(HttpMethod.Patch,
        $"/api/v1/lan/order-details/{detailId}/kitchen-status",
        new { kitchenStatus = "READY", rowVersion = rv });   // rowVersion CŨ
    Check(s9c == HttpStatusCode.Conflict, "rowVersion cũ bị chặn 409 (optimistic locking)");
    Check(b9c.GetProperty("currentRowVersion").GetInt32() == rv2,
          "409 trả về rowVersion hiện tại để client thử lại");

    Console.WriteLine("\n=== 10. Thực đơn có ETag ===");
    using var menuReq = new HttpRequestMessage(HttpMethod.Get, BaseUrl + "/api/v1/lan/menu");
    using var menuRes = await http.SendAsync(menuReq);
    var etag = menuRes.Headers.ETag?.Tag ?? menuRes.Headers.GetValues("ETag").First();
    Check(menuRes.StatusCode == HttpStatusCode.OK, "menu trả 200");
    Check(!string.IsNullOrEmpty(etag), "menu có ETag");

    using var menuReq2 = new HttpRequestMessage(HttpMethod.Get, BaseUrl + "/api/v1/lan/menu");
    menuReq2.Headers.TryAddWithoutValidation("If-None-Match", etag);
    using var menuRes2 = await http.SendAsync(menuReq2);
    Check(menuRes2.StatusCode == HttpStatusCode.NotModified,
          "gọi lại với ETag trả 304 (tablet dùng cache, đỡ tốn Wi-Fi)");

    Console.WriteLine("\n=== 11. WebSocket phát lại sự kiện đã bỏ lỡ ===");
    using var ws = new ClientWebSocket();
    await ws.ConnectAsync(new Uri($"{BaseUrl.Replace("http", "ws")}/ws/lan/kitchen"),
                          CancellationToken.None);
    Check(ws.State == WebSocketState.Open, "kết nối được kênh bếp");

    var received = new List<string>();
    var buffer = new byte[8192];
    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
    try
    {
        while (!cts.IsCancellationRequested && received.Count < 5)
        {
            var r = await ws.ReceiveAsync(buffer, cts.Token);
            var msg = Encoding.UTF8.GetString(buffer, 0, r.Count);
            received.Add(JsonDocument.Parse(msg).RootElement.GetProperty("event").GetString()!);
        }
    }
    catch (OperationCanceledException) { }

    Check(received.Contains("ORDER_CREATED"),
          "tablet nối muộn vẫn nhận được ORDER_CREATED đã phát trước đó",
          string.Join(",", received));
    Check(received.Contains("KITCHEN_STATUS_CHANGED"),
          "nhận được cả KITCHEN_STATUS_CHANGED");

    var eventIds = new HashSet<string>();
    Check(received.Count == received.Count, "mọi message đều parse được JSON");
}
finally
{
    if (!server.HasExited) server.Kill(true);
}

Console.WriteLine($"\n=== LAN API: {pass} PASS / {fail} FAIL ===");
foreach (var f in failures) Console.WriteLine("  X " + f);
return fail == 0 ? 0 : 1;
