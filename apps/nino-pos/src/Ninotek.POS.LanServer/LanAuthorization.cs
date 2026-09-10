using System.Net;
using Ninotek.POS.Core.Authorization;
using Ninotek.POS.Core.Entities;
using Ninotek.POS.Core.Enums;

namespace Ninotek.POS.LanServer;

public sealed record LanIdentity(
    Guid DeviceId,
    Guid StoreId,
    string DeviceName,
    UserRole Role);

public static class LanAuthorization
{
    public const string IdentityItemKey = "Ninotek.LanIdentity";

    public static UserRole RoleForDevice(Device device)
        => device.DeviceType.Equals("KDS", StringComparison.OrdinalIgnoreCase)
            ? UserRole.KITCHEN
            : UserRole.WAITER;

    public static bool TryGetIdentity(HttpContext http, out LanIdentity identity)
    {
        if (http.Items.TryGetValue(IdentityItemKey, out var value) && value is LanIdentity found)
        {
            identity = found;
            return true;
        }

        identity = null!;
        return false;
    }

    public static bool IsAllowed(HttpContext http, UserRole role)
        => TryGetIdentity(http, out var identity) &&
           (RolePolicy.IsAdmin(identity.Role) || identity.Role == role);

    public static IResult Unauthorized()
        => Results.Problem(
            title: "Thiết bị chưa được ghép nối",
            statusCode: StatusCodes.Status401Unauthorized,
            type: "https://ninotek.vn/errors/lan-unauthorized");

    public static IResult Forbidden()
        => Results.Problem(
            title: "Vai trò hiện tại không được phép thao tác",
            statusCode: StatusCodes.Status403Forbidden,
            type: "https://ninotek.vn/errors/forbidden");

    public static bool IsPublicPath(PathString path)
        => path.StartsWithSegments("/api/v1/lan/discovery") ||
           path.StartsWithSegments("/api/v1/lan/devices/pair") ||
           path.StartsWithSegments("/health");

    public static bool IsAllowedPath(HttpContext http, LanIdentity identity)
    {
        var path = http.Request.Path;
        if (path.StartsWithSegments("/ws/lan/kitchen") ||
            (path.Value?.Contains("/kitchen-status", StringComparison.OrdinalIgnoreCase) ?? false))
        {
            return RolePolicy.CanUseKitchen(identity.Role);
        }

        if (path.StartsWithSegments("/ws/lan/tables"))
        {
            return RolePolicy.CanUseOrder(identity.Role);
        }

        if ((path.Value?.Contains("/orders/", StringComparison.OrdinalIgnoreCase) ?? false) &&
            HttpMethods.IsGet(http.Request.Method))
        {
            return RolePolicy.CanUseOrder(identity.Role) || RolePolicy.CanUseKitchen(identity.Role);
        }

        return RolePolicy.CanUseOrder(identity.Role);
    }
}
