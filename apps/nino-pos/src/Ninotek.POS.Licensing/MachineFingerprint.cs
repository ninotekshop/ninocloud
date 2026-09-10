// =====================================================================
//  NINOTEK F&B POS — Vân tay phần cứng máy Windows
// =====================================================================
//  Sinh Machine ID để khoá license vào đúng một máy trạm.
//
//  Nguồn dữ liệu (theo tài liệu 8. Cap License key.md):
//    CPU ProcessorId + Mainboard SerialNumber + MAC của card mạng vật lý
//
//  THIẾT KẾ CÓ CHỦ Ý:
//   • Hash SHA-256 rồi lấy 32 ký tự hex đầu — KHÔNG gửi số serial thật lên
//     server. Đủ để định danh, nhưng không rò dữ liệu phần cứng của khách.
//   • BỎ QUA card mạng ảo (VMware, VirtualBox, Hyper-V, TAP, Loopback) và
//     mọi MAC bắt đầu bằng 02: — chúng đổi khi khách cài Zalo PC, VPN hay
//     Docker, và sẽ làm license đang chạy tốt bỗng dưng bị từ chối.
//   • Nếu thiếu một thành phần thì vẫn sinh được vân tay từ phần còn lại,
//     miễn có tối thiểu 2/3. Máy POS mini giá rẻ nhiều khi không đọc được
//     serial mainboard.
// =====================================================================

using System.Globalization;
using System.Management;
using System.Net.NetworkInformation;
using System.Security.Cryptography;
using System.Text;

namespace Ninotek.POS.Licensing;

public static class MachineFingerprint
{
    private static readonly string[] VirtualAdapterMarkers =
    {
        "virtual", "vmware", "vbox", "hyper-v", "tap", "loopback",
        "pseudo", "bluetooth", "wan miniport", "docker",
    };

    /// <summary>
    /// Vân tay phần cứng ổn định của máy này (32 ký tự hex viết hoa).
    /// Giá trị phải giữ nguyên qua các lần khởi động lại và cập nhật Windows.
    /// </summary>
    public static string Compute()
    {
        var parts = new List<string>(3);

        string? cpu = TryWmi("Win32_Processor", "ProcessorId");
        if (!string.IsNullOrWhiteSpace(cpu)) parts.Add($"CPU:{cpu.Trim()}");

        string? board = TryWmi("Win32_BaseBoard", "SerialNumber");
        if (IsUsableSerial(board)) parts.Add($"MB:{board!.Trim()}");

        string? mac = TryPhysicalMac();
        if (!string.IsNullOrWhiteSpace(mac)) parts.Add($"MAC:{mac}");

        if (parts.Count < 2)
        {
            throw new InvalidOperationException(
                "Không đọc được đủ thông tin phần cứng để sinh mã máy. " +
                "Hãy chạy NinoPOS với quyền Administrator.");
        }

        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(string.Join("|", parts)));
        return Convert.ToHexString(hash)[..32];
    }

    /// <summary>Định dạng dễ đọc để hiển thị trên màn hình Kích hoạt: XXXX-XXXX-...</summary>
    public static string ComputeDisplay()
    {
        string raw = Compute();
        return string.Join('-', Enumerable.Range(0, raw.Length / 4)
            .Select(i => raw.Substring(i * 4, 4)));
    }

    private static bool IsUsableSerial(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        string v = value.Trim();
        // Nhiều mainboard giá rẻ trả về chuỗi placeholder thay vì serial thật
        return v.Length >= 4
            && !v.Equals("To be filled by O.E.M.", StringComparison.OrdinalIgnoreCase)
            && !v.Equals("Default string", StringComparison.OrdinalIgnoreCase)
            && !v.Equals("None", StringComparison.OrdinalIgnoreCase)
            && v.Trim('0').Length > 0;
    }

    private static string? TryWmi(string wmiClass, string property)
    {
        try
        {
#pragma warning disable CA1416 // Chỉ chạy trên Windows — NinoPOS là ứng dụng Windows
            using var searcher = new ManagementObjectSearcher($"SELECT {property} FROM {wmiClass}");
            foreach (ManagementBaseObject obj in searcher.Get())
            {
                using (obj)
                {
                    string? value = obj[property]?.ToString();
                    if (!string.IsNullOrWhiteSpace(value)) return value;
                }
            }
#pragma warning restore CA1416
        }
        catch (ManagementException)
        {
            // Máy không hỗ trợ WMI class này — bỏ qua, dùng thành phần khác
        }
        return null;
    }

    private static string? TryPhysicalMac()
    {
        return NetworkInterface.GetAllNetworkInterfaces()
            .Where(IsPhysicalAdapter)
            .Select(n => n.GetPhysicalAddress().ToString())
            .Where(m => !string.IsNullOrEmpty(m) && m.Trim('0').Length > 0)
            // Sắp xếp để luôn chọn cùng một card khi máy có nhiều card mạng
            .OrderBy(m => m, StringComparer.Ordinal)
            .FirstOrDefault();
    }

    private static bool IsPhysicalAdapter(NetworkInterface nic)
    {
        if (nic.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel)
        {
            return false;
        }
        string desc = nic.Description.ToLower(CultureInfo.InvariantCulture);
        string name = nic.Name.ToLower(CultureInfo.InvariantCulture);
        if (VirtualAdapterMarkers.Any(m => desc.Contains(m, StringComparison.Ordinal)
                                        || name.Contains(m, StringComparison.Ordinal)))
        {
            return false;
        }
        // MAC quản trị cục bộ (bit thứ 2 của byte đầu) = card ảo
        byte[] addr = nic.GetPhysicalAddress().GetAddressBytes();
        return addr.Length == 6 && (addr[0] & 0x02) == 0;
    }
}
