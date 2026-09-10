// =====================================================================
//  NINOTEK NinoOrder — Mô hình dữ liệu
//  Khớp packages/api-contracts/openapi.yaml
// =====================================================================

class TableStatus {
  const TableStatus({
    required this.id,
    required this.name,
    required this.areaId,
    required this.seatCapacity,
    required this.status,
    required this.rowVersion,
    this.areaName,
    this.currentOrderId,
    this.guestCount,
    this.runningTotal,
    this.seatedMinutes,
    this.lockedByUserId,
    this.lockedUntil,
    this.posX = 0,
    this.posY = 0,
  });

  final String id;
  final String name;
  final String areaId;
  final String? areaName;
  final int seatCapacity;
  final String status;
  final int rowVersion;
  final String? currentOrderId;
  final int? guestCount;
  final num? runningTotal;
  final int? seatedMinutes;
  final String? lockedByUserId;
  final DateTime? lockedUntil;
  final int posX;
  final int posY;

  bool get isEmpty => status == 'EMPTY';

  /// Bàn đang bị nhân viên KHÁC giữ và khoá chưa hết hạn.
  bool isLockedByOther(String myUserId) =>
      lockedByUserId != null &&
      lockedByUserId != myUserId &&
      lockedUntil != null &&
      lockedUntil!.isAfter(DateTime.now());

  static TableStatus fromJson(Map<String, dynamic> j) => TableStatus(
        id: j['id'] as String,
        name: j['name'] as String,
        areaId: j['areaId'] as String,
        areaName: j['areaName'] as String?,
        seatCapacity: (j['seatCapacity'] as num?)?.toInt() ?? 4,
        status: j['status'] as String,
        rowVersion: (j['rowVersion'] as num).toInt(),
        currentOrderId: j['currentOrderId'] as String?,
        guestCount: (j['guestCount'] as num?)?.toInt(),
        runningTotal: j['runningTotal'] as num?,
        seatedMinutes: (j['seatedMinutes'] as num?)?.toInt(),
        lockedByUserId: j['lockedByUserId'] as String?,
        lockedUntil: j['lockedUntil'] == null
            ? null
            : DateTime.parse(j['lockedUntil'] as String),
        posX: (j['posX'] as num?)?.toInt() ?? 0,
        posY: (j['posY'] as num?)?.toInt() ?? 0,
      );
}

class MenuItem {
  const MenuItem({
    required this.id,
    required this.categoryId,
    required this.name,
    required this.basePrice,
    required this.unit,
    required this.isAvailable,
    this.sku,
    this.imageUrl,
    this.allowedToppingIds = const [],
  });

  final String id;
  final String categoryId;
  final String name;
  final num basePrice;
  final String unit;
  final bool isAvailable;
  final String? sku;
  final String? imageUrl;
  final List<String> allowedToppingIds;

  static MenuItem fromJson(Map<String, dynamic> j) => MenuItem(
        id: j['id'] as String,
        categoryId: j['categoryId'] as String,
        name: j['name'] as String,
        basePrice: (j['basePrice'] as num?) ?? (j['sellingPrice'] as num?) ?? 0,
        unit: (j['unit'] ?? 'Ly') as String,
        isAvailable: (j['isAvailable'] ?? true) as bool,
        sku: j['sku'] as String?,
        imageUrl: j['imageUrl'] as String?,
        allowedToppingIds:
            ((j['allowedToppingIds'] as List?) ?? const []).cast<String>(),
      );
}

class MenuCategory {
  const MenuCategory({required this.id, required this.name, required this.colorCode});
  final String id;
  final String name;
  final String colorCode;

  static MenuCategory fromJson(Map<String, dynamic> j) => MenuCategory(
        id: j['id'] as String,
        name: j['name'] as String,
        colorCode: (j['colorCode'] ?? '#007AFF') as String,
      );
}

class Topping {
  const Topping({
    required this.id,
    required this.name,
    required this.extraPrice,
    required this.groupName,
  });
  final String id;
  final String name;
  final num extraPrice;

  /// TOPPING / SUGAR / ICE / SIZE — quyết định cách nhóm trong popup.
  final String groupName;

  static Topping fromJson(Map<String, dynamic> j) => Topping(
        id: j['id'] as String,
        name: j['name'] as String,
        extraPrice: (j['extraPrice'] ?? 0) as num,
        groupName: (j['groupName'] ?? 'TOPPING') as String,
      );
}

/// Một dòng trong giỏ hàng đang soạn.
class CartLine {
  CartLine({
    required this.orderDetailId,
    required this.item,
    this.quantity = 1,
    this.note,
    List<Topping>? toppings,
  }) : toppings = toppings ?? [];

  /// UUID v4 sinh NGAY khi nhân viên thêm món.
  ///
  /// Sinh sớm như vậy để khi mất mạng, đơn nằm trong hàng đợi offline đã có
  /// sẵn ID ổn định. Gửi lại bao nhiêu lần cũng cùng ID, máy POS khử trùng lặp.
  final String orderDetailId;

  final MenuItem item;
  int quantity;
  String? note;
  final List<Topping> toppings;

  num get toppingTotal =>
      toppings.fold<num>(0, (sum, t) => sum + t.extraPrice);

  num get lineTotal => quantity * (item.basePrice + toppingTotal);

  Map<String, dynamic> toJson() => {
        'orderDetailId': orderDetailId,
        'itemId': item.id,
        'quantity': quantity,
        if (note != null && note!.isNotEmpty) 'note': note,
        if (toppings.isNotEmpty)
          'toppings': toppings
              .map((t) => {'toppingId': t.id, 'quantity': 1})
              .toList(),
      };
}
