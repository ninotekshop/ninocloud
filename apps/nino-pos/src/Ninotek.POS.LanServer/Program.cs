// =====================================================================
//  NINOTEK F&B POS — LAN Server (Kestrel tự host trong NinoPOS.exe)
// =====================================================================
//  Phục vụ các tablet NinoOrder trong mạng nội bộ quán.
//  KHÔNG cần Internet — đây là nền tảng của kiến trúc Offline-First.
//
//  Khớp với packages/api-contracts/openapi.yaml, phần LAN API.
// =====================================================================

using System.Text.Json;
using System.Text.Json.Serialization;
using Ninotek.POS.Core.Abstractions;
using Ninotek.POS.Core.Authorization;
using Ninotek.POS.Core.Contracts;
using Ninotek.POS.Core.Entities;
using Ninotek.POS.Core.Enums;
using Ninotek.POS.Core.UseCases;
using Ninotek.POS.LanServer;
using Ninotek.POS.LanServer.Endpoints;
using Ninotek.POS.LanServer.Hubs;
using Ninotek.POS.LanServer.Testing;
using Ninotek.POS.Data;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
});

// --- Tầng dữ liệu -----------------------------------------------------
// Mặc định dùng in-memory để NinoPOS chạy được ngay lần đầu cài đặt, trước
// khi có database. Bản thật (EF Core + SQLite) đăng ký đè ở Ninotek.POS.App.
builder.Services.AddSingleton<InMemoryStore>();
builder.Services.AddSingleton<IOrderRepository, InMemoryOrderRepository>();
builder.Services.AddSingleton<IOrderDetailRepository, InMemoryOrderDetailRepository>();
builder.Services.AddSingleton<ITableRepository, InMemoryTableRepository>();
builder.Services.AddSingleton<IMenuRepository, InMemoryMenuRepository>();
builder.Services.AddSingleton<IDeviceRepository, InMemoryDeviceRepository>();
builder.Services.AddSingleton<IPrintJobQueue, InMemoryPrintJobQueue>();
builder.Services.AddSingleton<IClock, SystemClock>();

// --- Real-time --------------------------------------------------------
builder.Services.AddSingleton<LanEventHub>();
builder.Services.AddSingleton<ILanEventPublisher>(sp => sp.GetRequiredService<LanEventHub>());

// --- Use case ---------------------------------------------------------
builder.Services.AddScoped<CreateOrderUseCase>();
builder.Services.AddScoped<LockTableUseCase>();
builder.Services.AddScoped<TransferTableUseCase>();
builder.Services.AddScoped<UpdateKitchenStatusUseCase>();

builder.Services.AddSingleton<LanServerOptions>();
builder.Services.AddSingleton(new LocalPosDatabase(
    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Ninotek", "NinoPOS", "ninopos.db")));

var app = builder.Build();

await app.Services.GetRequiredService<LocalPosDatabase>().InitializeAsync();

// Cửa sổ giữ kết nối WebSocket sống qua những lúc Wi-Fi quán chập chờn.
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });

// Discovery và pairing là public; mọi thao tác sau đó phải có device token.
// Role được suy ra từ loại thiết bị đã duyệt, không tin user id/role do client tự gửi.
app.Use(async (http, next) =>
{
    if (LanAuthorization.IsPublicPath(http.Request.Path))
    {
        await next();
        return;
    }

    var authorization = http.Request.Headers.Authorization.ToString();
    var token = authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
        ? authorization[7..].Trim()
        : string.Empty;

    if (string.IsNullOrWhiteSpace(token))
    {
        await LanAuthorization.Unauthorized().ExecuteAsync(http);
        return;
    }

    var devices = http.RequestServices.GetRequiredService<IDeviceRepository>();
    var device = await devices.GetByTokenAsync(token, http.RequestAborted);
    if (device is null)
    {
        await LanAuthorization.Unauthorized().ExecuteAsync(http);
        return;
    }

    var identity = new LanIdentity(
        device.Id,
        device.StoreId,
        device.DeviceName,
        LanAuthorization.RoleForDevice(device));
    http.Items[LanAuthorization.IdentityItemKey] = identity;
    await devices.TouchLastSeenAsync(device.Id, DateTime.UtcNow, http.RequestAborted);

    if (!LanAuthorization.IsAllowedPath(http, identity))
    {
        await LanAuthorization.Forbidden().ExecuteAsync(http);
        return;
    }

    await next();
});

app.MapLanEndpoints();

// Dữ liệu demo để chạy thử ngay khi chưa có database
if (app.Configuration.GetValue("Lan:SeedDemoData", false))
{
    DemoSeed.Populate(app.Services.GetRequiredService<InMemoryStore>(),
                      app.Services.GetRequiredService<LanServerOptions>());
    app.Logger.LogInformation("Đã nạp dữ liệu demo");
}

app.Run();
