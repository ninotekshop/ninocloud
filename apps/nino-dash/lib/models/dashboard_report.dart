class DashboardReport {
  final double netRevenue;
  final double grossRevenue;
  final double totalDiscount;
  final int totalOrders;
  final int totalGuests;
  final double avgOrderValue;
  final double revenueChangePercent;
  final double tableOccupancyPercent;
  final List<RevenueByHour> revenueByHour;
  final List<TopSellingItem> topSellingItems;
  final List<PaymentBreakdown> paymentBreakdown;
  final List<LowStockAlert> lowStockAlerts;
  final List<SuspiciousActivity> suspiciousActivities;

  const DashboardReport({
    required this.netRevenue,
    required this.grossRevenue,
    required this.totalDiscount,
    required this.totalOrders,
    required this.totalGuests,
    required this.avgOrderValue,
    required this.revenueChangePercent,
    required this.tableOccupancyPercent,
    required this.revenueByHour,
    required this.topSellingItems,
    required this.paymentBreakdown,
    required this.lowStockAlerts,
    required this.suspiciousActivities,
  });

  factory DashboardReport.fromJson(Map<String, dynamic> json) {
    return DashboardReport(
      netRevenue: (json['netRevenue'] as num?)?.toDouble() ?? 0.0,
      grossRevenue: (json['grossRevenue'] as num?)?.toDouble() ?? 0.0,
      totalDiscount: (json['totalDiscount'] as num?)?.toDouble() ?? 0.0,
      totalOrders: (json['totalOrders'] as num?)?.toInt() ?? 0,
      totalGuests: (json['totalGuests'] as num?)?.toInt() ?? 0,
      avgOrderValue: (json['avgOrderValue'] as num?)?.toDouble() ?? 0.0,
      revenueChangePercent: (json['revenueChangePercent'] as num?)?.toDouble() ?? 0.0,
      tableOccupancyPercent: (json['tableOccupancyPercent'] as num?)?.toDouble() ?? 0.0,
      revenueByHour: (json['revenueByHour'] as List<dynamic>?)
              ?.map((e) => RevenueByHour.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
      topSellingItems: (json['topSellingItems'] as List<dynamic>?)
              ?.map((e) => TopSellingItem.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
      paymentBreakdown: (json['paymentBreakdown'] as List<dynamic>?)
              ?.map((e) => PaymentBreakdown.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
      lowStockAlerts: (json['lowStockAlerts'] as List<dynamic>?)
              ?.map((e) => LowStockAlert.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
      suspiciousActivities: (json['suspiciousActivities'] as List<dynamic>?)
              ?.map((e) => SuspiciousActivity.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
    );
  }

  static DashboardReport empty() {
    return const DashboardReport(
      netRevenue: 0.0,
      grossRevenue: 0.0,
      totalDiscount: 0.0,
      totalOrders: 0,
      totalGuests: 0,
      avgOrderValue: 0.0,
      revenueChangePercent: 0.0,
      tableOccupancyPercent: 0.0,
      revenueByHour: [],
      topSellingItems: [],
      paymentBreakdown: [],
      lowStockAlerts: [],
      suspiciousActivities: [],
    );
  }

  static DashboardReport mockData() {
    return DashboardReport(
      netRevenue: 18450000.0,
      grossRevenue: 19800000.0,
      totalDiscount: 1350000.0,
      totalOrders: 86,
      totalGuests: 215,
      avgOrderValue: 214534.0,
      revenueChangePercent: 12.5,
      tableOccupancyPercent: 68.0,
      revenueByHour: [
        const RevenueByHour(hour: 7, revenue: 450000, orderCount: 3),
        const RevenueByHour(hour: 8, revenue: 1200000, orderCount: 8),
        const RevenueByHour(hour: 9, revenue: 950000, orderCount: 6),
        const RevenueByHour(hour: 10, revenue: 1100000, orderCount: 7),
        const RevenueByHour(hour: 11, revenue: 2800000, orderCount: 14),
        const RevenueByHour(hour: 12, revenue: 3500000, orderCount: 18),
        const RevenueByHour(hour: 13, revenue: 2100000, orderCount: 10),
        const RevenueByHour(hour: 14, revenue: 850000, orderCount: 4),
        const RevenueByHour(hour: 15, revenue: 900000, orderCount: 4),
        const RevenueByHour(hour: 16, revenue: 1100000, orderCount: 5),
        const RevenueByHour(hour: 17, revenue: 1500000, orderCount: 7),
      ],
      topSellingItems: [
        const TopSellingItem(
            itemId: '1', itemName: 'Cà phê Sữa Đá', quantity: 64, revenue: 2240000),
        const TopSellingItem(
            itemId: '2', itemName: 'Trà Đào Cam Sả', quantity: 48, revenue: 2160000),
        const TopSellingItem(
            itemId: '3', itemName: 'Bạc Xỉu Sài Gòn', quantity: 38, revenue: 1520000),
        const TopSellingItem(
            itemId: '4', itemName: 'Trà Sữa Oolong Trân Châu', quantity: 32, revenue: 1440000),
        const TopSellingItem(
            itemId: '5', itemName: 'Bánh Mỳ Bò Nướng', quantity: 25, revenue: 1125000),
      ],
      paymentBreakdown: [
        const PaymentBreakdown(method: 'VIETQR', amount: 11070000, count: 52),
        const PaymentBreakdown(method: 'CASH', amount: 5535000, count: 26),
        const PaymentBreakdown(method: 'CARD', amount: 1845000, count: 8),
      ],
      lowStockAlerts: [
        const LowStockAlert(
            ingredientId: 'i1',
            name: 'Hạt cà phê Robusta',
            stockQuantity: 1.2,
            minStockAlert: 5.0,
            unit: 'kg'),
        const LowStockAlert(
            ingredientId: 'i2',
            name: 'Sữa đặc Ngôi Sao Phương Nam',
            stockQuantity: 3.0,
            minStockAlert: 10.0,
            unit: 'hộp'),
        const LowStockAlert(
            ingredientId: 'i3',
            name: 'Siro Đào Monin',
            stockQuantity: 0.5,
            minStockAlert: 2.0,
            unit: 'chai'),
      ],
      suspiciousActivities: [
        const SuspiciousActivity(
          shiftId: 's1',
          userId: 'u101',
          userName: 'Nguyễn Văn Thu Ngân',
          action: 'CANCEL_ITEM',
          count: 6,
          totalAmount: 240000,
          thresholdExceeded: 'Huỷ 6 món sau khi đã chuyển bếp',
        ),
        const SuspiciousActivity(
          shiftId: 's1',
          userId: 'u102',
          userName: 'Trần Thị Thu Ngân 2',
          action: 'APPLY_DISCOUNT',
          count: 4,
          totalAmount: 500000,
          thresholdExceeded: 'Áp dụng giảm giá 30% thủ công 4 lần',
        ),
      ],
    );
  }
}

class RevenueByHour {
  final int hour;
  final double revenue;
  final int orderCount;

  const RevenueByHour({
    required this.hour,
    required this.revenue,
    required this.orderCount,
  });

  factory RevenueByHour.fromJson(Map<String, dynamic> json) {
    return RevenueByHour(
      hour: (json['hour'] as num?)?.toInt() ?? 0,
      revenue: (json['revenue'] as num?)?.toDouble() ?? 0.0,
      orderCount: (json['orderCount'] as num?)?.toInt() ?? 0,
    );
  }
}

class TopSellingItem {
  final String itemId;
  final String itemName;
  final double quantity;
  final double revenue;

  const TopSellingItem({
    required this.itemId,
    required this.itemName,
    required this.quantity,
    required this.revenue,
  });

  factory TopSellingItem.fromJson(Map<String, dynamic> json) {
    return TopSellingItem(
      itemId: json['itemId'] as String? ?? '',
      itemName: json['itemName'] as String? ?? '',
      quantity: (json['quantity'] as num?)?.toDouble() ?? 0.0,
      revenue: (json['revenue'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

class PaymentBreakdown {
  final String method;
  final double amount;
  final int count;

  const PaymentBreakdown({
    required this.method,
    required this.amount,
    required this.count,
  });

  factory PaymentBreakdown.fromJson(Map<String, dynamic> json) {
    return PaymentBreakdown(
      method: json['method'] as String? ?? 'CASH',
      amount: (json['amount'] as num?)?.toDouble() ?? 0.0,
      count: (json['count'] as num?)?.toInt() ?? 0,
    );
  }

  String get label {
    switch (method.toUpperCase()) {
      case 'VIETQR':
        return 'Chuyển khoản VietQR';
      case 'CASH':
        return 'Tiền mặt';
      case 'CARD':
        return 'Thẻ ngân hàng';
      case 'EWALLET':
        return 'Ví điện tử';
      default:
        return method;
    }
  }
}

class LowStockAlert {
  final String ingredientId;
  final String name;
  final double stockQuantity;
  final double minStockAlert;
  final String unit;

  const LowStockAlert({
    required this.ingredientId,
    required this.name,
    required this.stockQuantity,
    required this.minStockAlert,
    required this.unit,
  });

  factory LowStockAlert.fromJson(Map<String, dynamic> json) {
    return LowStockAlert(
      ingredientId: json['ingredientId'] as String? ?? '',
      name: json['name'] as String? ?? '',
      stockQuantity: (json['stockQuantity'] as num?)?.toDouble() ?? 0.0,
      minStockAlert: (json['minStockAlert'] as num?)?.toDouble() ?? 0.0,
      unit: json['unit'] as String? ?? '',
    );
  }

  double get percentLeft => (minStockAlert > 0) ? (stockQuantity / minStockAlert).clamp(0.0, 1.0) : 0.0;
}

class SuspiciousActivity {
  final String shiftId;
  final String userId;
  final String userName;
  final String action;
  final int count;
  final double totalAmount;
  final String thresholdExceeded;

  const SuspiciousActivity({
    required this.shiftId,
    required this.userId,
    required this.userName,
    required this.action,
    required this.count,
    required this.totalAmount,
    required this.thresholdExceeded,
  });

  factory SuspiciousActivity.fromJson(Map<String, dynamic> json) {
    return SuspiciousActivity(
      shiftId: json['shiftId'] as String? ?? '',
      userId: json['userId'] as String? ?? '',
      userName: json['userName'] as String? ?? 'Nhân viên',
      action: json['action'] as String? ?? '',
      count: (json['count'] as num?)?.toInt() ?? 0,
      totalAmount: (json['totalAmount'] as num?)?.toDouble() ?? 0.0,
      thresholdExceeded: json['thresholdExceeded'] as String? ?? '',
    );
  }

  String get actionLabel {
    switch (action.toUpperCase()) {
      case 'CANCEL_ITEM':
        return 'Huỷ món sau khi gọi';
      case 'APPLY_DISCOUNT':
        return 'Giảm giá bất thường';
      case 'VOID_BILL':
        return 'Huỷ hoá đơn đã in';
      default:
        return action;
    }
  }
}
