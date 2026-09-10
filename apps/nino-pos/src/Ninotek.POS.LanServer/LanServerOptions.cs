// =====================================================================
//  NINOTEK F&B POS — Cấu hình LAN Server
// =====================================================================
namespace Ninotek.POS.LanServer;

/// <summary>Cấu hình của LAN server, đọc từ appsettings hoặc database.</summary>
public sealed class LanServerOptions
{
    public Guid StoreId { get; set; } = Guid.Parse("22222222-2222-4222-8222-222222222222");
    public string StoreName { get; set; } = "Ninotek Coffee - Quy Nhon";
    public string StoreCode { get; set; } = "QN01";
    public string PosVersion { get; set; } = "1.0.0";

    /// <summary>
    /// Tablet có protocolVersion khác PHẢI báo người dùng cập nhật app.
    /// Tăng số này mỗi khi đổi contract theo cách phá vỡ tương thích.
    /// </summary>
    public int ProtocolVersion { get; set; } = 1;

    /// <summary>Mã 6 số hiển thị trên màn hình NinoPOS khi ghép nối thiết bị.</summary>
    public string PairingCode { get; set; } = "000000";
    public bool PairingEnabled { get; set; } = true;

    /// <summary>Giới hạn số tablet, lấy từ licenses.max_devices.</summary>
    public int MaxDevices { get; set; } = 5;
}
