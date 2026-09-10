using Ninotek.POS.Core.Enums;

namespace Ninotek.POS.Core.Authorization;

/// <summary>Central role matrix shared by POS and LAN request handlers.</summary>
public static class RolePolicy
{
    public static UserRole ParseRole(string? value)
        => value?.ToUpperInvariant() switch
        {
            "OWNER" => UserRole.OWNER,
            "ADMIN" => UserRole.ADMIN,
            "CASHIER" => UserRole.CASHIER,
            "WAITER" => UserRole.WAITER,
            "KITCHEN" or "KITCHEN_STAFF" => UserRole.KITCHEN,
            _ => throw new ArgumentException("Unknown user role.", nameof(value)),
        };

    public static string RoleName(UserRole role)
        => role == UserRole.KITCHEN ? "KITCHEN_STAFF" : role.ToString();

    public static bool IsAdmin(UserRole role)
        => role is UserRole.OWNER or UserRole.ADMIN;

    public static bool CanUsePos(UserRole role)
        => IsAdmin(role) || role == UserRole.CASHIER;

    public static bool CanUseOrder(UserRole role)
        => IsAdmin(role) || role == UserRole.WAITER;

    public static bool CanUseKitchen(UserRole role)
        => IsAdmin(role) || role == UserRole.KITCHEN;

    public static bool CanViewRevenue(UserRole role)
        => IsAdmin(role);

    public static bool CanManageMenu(UserRole role)
        => IsAdmin(role);

    public static bool CanManageUsers(UserRole role)
        => IsAdmin(role);

    public static bool CanApplyDiscount(UserRole role, decimal discountPercent, decimal maxDiscountPercent)
        => IsAdmin(role) || (role == UserRole.CASHIER && discountPercent >= 0 && discountPercent <= maxDiscountPercent);
}
