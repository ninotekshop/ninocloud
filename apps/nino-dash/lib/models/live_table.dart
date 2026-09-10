class LiveTable {
  final String tableId;
  final String tableName;
  final String zoneName;
  final String status;
  final int guestCount;
  final double runningTotal;
  final DateTime? openedAt;
  final List<LiveOrderItem> items;

  const LiveTable({
    required this.tableId,
    required this.tableName,
    required this.zoneName,
    required this.status,
    required this.guestCount,
    required this.runningTotal,
    this.openedAt,
    this.items = const [],
  });

  factory LiveTable.fromJson(Map<String, dynamic> json) {
    return LiveTable(
      tableId: json['tableId'] as String? ?? json['id'] as String? ?? '',
      tableName: json['tableName'] as String? ?? json['name'] as String? ?? '',
      zoneName: json['zoneName'] as String? ?? 'Tầng 1',
      status: json['status'] as String? ?? 'EMPTY',
      guestCount: (json['guestCount'] as num?)?.toInt() ?? 0,
      runningTotal: (json['runningTotal'] as num?)?.toDouble() ?? 0.0,
      openedAt: json['openedAt'] != null ? DateTime.tryParse(json['openedAt'] as String) : null,
      items: (json['items'] as List<dynamic>?)
              ?.map((e) => LiveOrderItem.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const [],
    );
  }

  String get occupiedDurationText {
    if (openedAt == null) return '';
    final diff = DateTime.now().difference(openedAt!);
    if (diff.inHours > 0) {
      return '${diff.inHours}h ${diff.inMinutes.remainder(60)}m';
    }
    return '${diff.inMinutes} phút';
  }

  static List<LiveTable> mockTables() {
    final now = DateTime.now();
    return [
      LiveTable(
        tableId: 't1',
        tableName: 'Bàn 01',
        zoneName: 'Tầng 1',
        status: 'OCCUPIED',
        guestCount: 4,
        runningTotal: 380000,
        openedAt: now.subtract(const Duration(minutes: 42)),
        items: const [
          LiveOrderItem(name: 'Cà phê Sữa Đá', quantity: 2, price: 35000),
          LiveOrderItem(name: 'Trà Đào Cam Sả', quantity: 2, price: 45000),
          LiveOrderItem(name: 'Bánh Mỳ Bò Nướng', quantity: 2, price: 45000),
        ],
      ),
      LiveTable(
        tableId: 't2',
        tableName: 'Bàn 02',
        zoneName: 'Tầng 1',
        status: 'BILLING',
        guestCount: 2,
        runningTotal: 150000,
        openedAt: now.subtract(const Duration(minutes: 65)),
        items: const [
          LiveOrderItem(name: 'Bạc Xỉu Sài Gòn', quantity: 2, price: 40000),
          LiveOrderItem(name: 'Hướng Dương', quantity: 1, price: 30000),
          LiveOrderItem(name: 'Khô Gà Lá Chanh', quantity: 1, price: 40000),
        ],
      ),
      LiveTable(
        tableId: 't3',
        tableName: 'Bàn 03',
        zoneName: 'Tầng 1',
        status: 'EMPTY',
        guestCount: 0,
        runningTotal: 0,
      ),
      LiveTable(
        tableId: 't4',
        tableName: 'Bàn VIP 01',
        zoneName: 'Sân Thượng',
        status: 'OCCUPIED',
        guestCount: 8,
        runningTotal: 1250000,
        openedAt: now.subtract(const Duration(minutes: 110)),
        items: const [
          LiveOrderItem(name: 'Combo Lẩu Thái F&B', quantity: 1, price: 650000),
          LiveOrderItem(name: 'Bia Heineken', quantity: 12, price: 35000),
          LiveOrderItem(name: 'Trái Cây Đĩa', quantity: 2, price: 90000),
        ],
      ),
      LiveTable(
        tableId: 't5',
        tableName: 'Bàn 05',
        zoneName: 'Tầng 1',
        status: 'RESERVED',
        guestCount: 6,
        runningTotal: 0,
      ),
      LiveTable(
        tableId: 't6',
        tableName: 'Bàn 06',
        zoneName: 'Tầng 2',
        status: 'OCCUPIED',
        guestCount: 3,
        runningTotal: 210000,
        openedAt: now.subtract(const Duration(minutes: 25)),
        items: const [
          LiveOrderItem(name: 'Trà Sữa Oolong', quantity: 3, price: 45000),
          LiveOrderItem(name: 'Topping Trân Châu Black', quantity: 3, price: 10000),
          LiveOrderItem(name: 'Bánh Mỳ Nướng Bơ Tỏi', quantity: 1, price: 45000),
        ],
      ),
      LiveTable(
        tableId: 't7',
        tableName: 'Bàn 07',
        zoneName: 'Tầng 2',
        status: 'EMPTY',
        guestCount: 0,
        runningTotal: 0,
      ),
      LiveTable(
        tableId: 't8',
        tableName: 'Bàn 08',
        zoneName: 'Tầng 2',
        status: 'EMPTY',
        guestCount: 0,
        runningTotal: 0,
      ),
    ];
  }
}

class LiveOrderItem {
  final String name;
  final double quantity;
  final double price;

  const LiveOrderItem({
    required this.name,
    required this.quantity,
    required this.price,
  });

  factory LiveOrderItem.fromJson(Map<String, dynamic> json) {
    return LiveOrderItem(
      name: json['name'] as String? ?? json['itemName'] as String? ?? '',
      quantity: (json['quantity'] as num?)?.toDouble() ?? 1.0,
      price: (json['price'] as num?)?.toDouble() ?? 0.0,
    );
  }

  double get totalPrice => quantity * price;
}
