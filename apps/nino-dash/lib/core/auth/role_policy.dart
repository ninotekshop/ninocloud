enum AppRole { owner, admin, cashier, waiter, kitchenStaff }

class UserSession {
  const UserSession({required this.userId, required this.displayName, required this.role, this.accessToken});

  final String userId;
  final String displayName;
  final AppRole role;
  final String? accessToken;

  bool get canViewRevenue => role == AppRole.owner || role == AppRole.admin;

  static AppRole parseRole(String value) {
    switch (value.toUpperCase()) {
      case 'OWNER': return AppRole.owner;
      case 'ADMIN': return AppRole.admin;
      case 'CASHIER': return AppRole.cashier;
      case 'WAITER': return AppRole.waiter;
      case 'KITCHEN':
      case 'KITCHEN_STAFF': return AppRole.kitchenStaff;
      default: throw ArgumentError('Unknown user role: $value');
    }
  }
}
