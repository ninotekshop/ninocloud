import 'dart:async';

enum NotificationType { payment, stock, security, system }

class PushNotificationItem {
  final String id;
  final String title;
  final String body;
  final DateTime timestamp;
  final NotificationType type;
  bool isRead;

  PushNotificationItem({
    required this.id,
    required this.title,
    required this.body,
    required this.timestamp,
    required this.type,
    this.isRead = false,
  });

  static List<PushNotificationItem> initialNotifications() {
    final now = DateTime.now();
    return [
      PushNotificationItem(
        id: 'n1',
        title: '💰 Thanh toán VietQR mới +150.000 VNĐ',
        body: 'Đơn NINOPOS100234 tại Bàn 01 đã chuyển khoản thành công qua Casso Bank.',
        timestamp: now.subtract(const Duration(minutes: 5)),
        type: NotificationType.payment,
      ),
      PushNotificationItem(
        id: 'n2',
        title: '⚠️ Cảnh báo kho: Robusta sắp hết',
        body: 'Tồn kho Hạt cà phê Robusta hiện chỉ còn 1.2 kg (mức cảnh báo: 5.0 kg).',
        timestamp: now.subtract(const Duration(minutes: 25)),
        type: NotificationType.stock,
      ),
      PushNotificationItem(
        id: 'n3',
        title: '🚨 Thao tác nghi vấn: Huỷ món vượt ngưỡng',
        body: 'Thu ngân Nguyễn Văn A đã huỷ 6 món liên tiếp trong ca làm việc #S102.',
        timestamp: now.subtract(const Duration(hours: 1, minutes: 10)),
        type: NotificationType.security,
      ),
      PushNotificationItem(
        id: 'n4',
        title: '✅ Báo cáo chốt ca thành công',
        body: 'Ca sáng đã chốt doanh thu 8.450.000 VNĐ, tiền mặt khớp 100% với kiểm kê két.',
        timestamp: now.subtract(const Duration(hours: 3)),
        type: NotificationType.system,
      ),
    ];
  }
}

class FcmPushService {
  final List<PushNotificationItem> _items = PushNotificationItem.initialNotifications();
  final _controller = StreamController<List<PushNotificationItem>>.broadcast();

  Stream<List<PushNotificationItem>> get notificationStream => _controller.stream;

  List<PushNotificationItem> get currentItems => List.unmodifiable(_items);

  int get unreadCount => _items.where((e) => !e.isRead).length;

  void addNotification({
    required String title,
    required String body,
    required NotificationType type,
  }) {
    final item = PushNotificationItem(
      id: 'n_${DateTime.now().millisecondsSinceEpoch}',
      title: title,
      body: body,
      timestamp: DateTime.now(),
      type: type,
    );
    _items.insert(0, item);
    _controller.add(_items);
  }

  void markAllAsRead() {
    for (var item in _items) {
      item.isRead = true;
    }
    _controller.add(_items);
  }

  void markAsRead(String id) {
    final idx = _items.indexWhere((e) => e.id == id);
    if (idx != -1) {
      _items[idx].isRead = true;
      _controller.add(_items);
    }
  }

  void clearAll() {
    _items.clear();
    _controller.add(_items);
  }
}
