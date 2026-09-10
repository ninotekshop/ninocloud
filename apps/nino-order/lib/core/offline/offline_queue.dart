// =====================================================================
//  NINOTEK NinoOrder — Hàng đợi đơn hàng khi mất kết nối LAN
// =====================================================================
//  ĐÂY LÀ PHẦN QUAN TRỌNG NHẤT CỦA APP.
//
//  Wi-Fi ở quán ăn chập chờn là chuyện bình thường, không phải sự cố hiếm.
//  Nhân viên đứng cạnh bàn khách, bấm "Gửi Bếp", và app PHẢI nhận đơn ngay
//  lập tức — không được bắt họ đứng chờ hay bấm lại trước mặt khách.
//
//  BỐN BẤT BIẾN KHÔNG ĐƯỢC PHÁ:
//
//  1. UUID SINH TRƯỚC KHI GỬI.
//     `orderId` và mọi `orderDetailId` được sinh lúc nhân viên bấm nút, rồi
//     mới đưa vào hàng đợi. Gửi lại bao nhiêu lần cũng cùng UUID đó, nên máy
//     POS nhận ra và trả về đơn cũ thay vì tạo đơn thứ hai.
//
//  2. GHI XUỐNG ĐĨA TRƯỚC KHI BÁO THÀNH CÔNG.
//     Nếu chỉ giữ trong RAM, app bị hệ điều hành giết (tablet hết pin, người
//     dùng vuốt tắt) là mất trắng đơn của khách.
//
//  3. GỬI TUẦN TỰ THEO THỨ TỰ VÀO HÀNG ĐỢI.
//     Không gửi song song. Khách gọi món đợt 1 rồi đợt 2, bếp phải nhận đúng
//     thứ tự đó. Gửi song song thì đợt 2 có thể tới trước.
//
//  4. CHỈ XOÁ KHỎI HÀNG ĐỢI KHI MÁY POS ĐÃ XÁC NHẬN.
//     Timeout không phải là thất bại — đơn có thể đã tới nơi. Giữ lại và gửi
//     lại; quy tắc 1 bảo đảm không trùng.
// =====================================================================

import 'dart:async';
import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Một đơn hàng đang chờ gửi lên máy POS.
class PendingOrder {
  PendingOrder({
    required this.orderId,
    required this.payload,
    required this.queuedAt,
    this.attempts = 0,
    this.lastError,
  });

  /// UUID v4 sinh phía tablet — đồng thời là khoá khử trùng lặp.
  final String orderId;

  /// Body JSON gửi tới POST /api/v1/lan/order/create.
  final Map<String, dynamic> payload;

  final DateTime queuedAt;
  int attempts;
  String? lastError;

  Map<String, dynamic> toJson() => {
        'orderId': orderId,
        'payload': payload,
        'queuedAt': queuedAt.toIso8601String(),
        'attempts': attempts,
        'lastError': lastError,
      };

  static PendingOrder fromJson(Map<String, dynamic> json) => PendingOrder(
        orderId: json['orderId'] as String,
        payload: Map<String, dynamic>.from(json['payload'] as Map),
        queuedAt: DateTime.parse(json['queuedAt'] as String),
        attempts: (json['attempts'] as num?)?.toInt() ?? 0,
        lastError: json['lastError'] as String?,
      );
}

/// Kết quả một lần gửi đơn lên máy POS.
enum SendOutcome {
  /// Máy POS đã ghi nhận (201 tạo mới, hoặc 200 nhận ra đơn cũ).
  accepted,

  /// Máy POS từ chối vì lý do nghiệp vụ (món hết, bàn bị khoá).
  /// KHÔNG gửi lại — gửi lại bao nhiêu lần cũng bị từ chối như vậy.
  rejected,

  /// Không tới được máy POS. Giữ lại và thử lần sau.
  unreachable,
}

class SendResult {
  const SendResult(this.outcome, {this.message, this.body});
  final SendOutcome outcome;
  final String? message;
  final Map<String, dynamic>? body;
}

/// Nơi lưu hàng đợi xuống đĩa. Tách interface để test được mà không cần Hive.
abstract class QueueStorage {
  Future<List<PendingOrder>> load();
  Future<void> save(List<PendingOrder> orders);
}

/// Lưu trong bộ nhớ — chỉ dùng cho test.
class InMemoryQueueStorage implements QueueStorage {
  List<String> _raw = [];

  @override
  Future<List<PendingOrder>> load() async =>
      _raw.map((s) => PendingOrder.fromJson(jsonDecode(s) as Map<String, dynamic>)).toList();

  @override
  Future<void> save(List<PendingOrder> orders) async {
    _raw = orders.map((o) => jsonEncode(o.toJson())).toList();
  }
}

/// Lưu xuống đĩa thật bằng SharedPreferences.
///
/// Đây là lý do bất biến "ghi xuống đĩa trước khi báo thành công" đứng vững
/// kể cả khi hệ điều hành giết tiến trình app ngay sau khi nhân viên bấm
/// "Gửi Bếp": SharedPreferences ghi file ngay trong `save()`, không đợi vòng
/// lặp sự kiện kế tiếp.
class SharedPrefsQueueStorage implements QueueStorage {
  SharedPrefsQueueStorage({this.storageKey = 'nino_order.offline_queue'});

  final String storageKey;

  @override
  Future<List<PendingOrder>> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getStringList(storageKey) ?? const [];
    return raw
        .map((s) => PendingOrder.fromJson(jsonDecode(s) as Map<String, dynamic>))
        .toList();
  }

  @override
  Future<void> save(List<PendingOrder> orders) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(
      storageKey,
      orders.map((o) => jsonEncode(o.toJson())).toList(),
    );
  }
}

typedef OrderSender = Future<SendResult> Function(Map<String, dynamic> payload);

/// Trạng thái hàng đợi để UI hiển thị banner.
class QueueState {
  const QueueState({
    required this.pendingCount,
    required this.isFlushing,
    required this.isOnline,
    this.lastError,
  });

  final int pendingCount;
  final bool isFlushing;
  final bool isOnline;
  final String? lastError;

  bool get hasBacklog => pendingCount > 0;
}

class OfflineOrderQueue {
  OfflineOrderQueue({
    required QueueStorage storage,
    required OrderSender sender,
    this.maxAttempts = 50,
  })  : _storage = storage,
        _sender = sender;

  final QueueStorage _storage;
  final OrderSender _sender;

  /// Sau ngần này lần thử, đơn được đánh dấu cần xử lý thủ công.
  /// Đặt cao vì mất mạng cả tiếng vẫn là tình huống bình thường ở quán —
  /// nhưng không vô hạn, để đơn hỏng vĩnh viễn không chặn cả hàng đợi.
  final int maxAttempts;

  final List<PendingOrder> _queue = [];
  final List<PendingOrder> _deadLetter = [];
  final _stateController = StreamController<QueueState>.broadcast();

  bool _flushing = false;
  bool _online = false;
  Timer? _retryTimer;

  /// Lần đẩy hàng đợi đang chạy, nếu có.
  ///
  /// `enqueue` cố tình KHÔNG chờ lần đẩy này — nhân viên bấm "Gửi Bếp" phải
  /// thấy phản hồi ngay. Nhưng đôi khi cần biết lúc nào mọi thứ đã lắng:
  /// màn hình "đang đồng bộ", và bộ test cần chạy tất định.
  Future<void>? _inFlight;

  Stream<QueueState> get stateStream => _stateController.stream;
  int get pendingCount => _queue.length;
  List<PendingOrder> get deadLetters => List.unmodifiable(_deadLetter);
  bool get isOnline => _online;

  /// Chờ lần đẩy đang chạy kết thúc. Trả về ngay nếu không có gì đang chạy.
  Future<void> get idle async {
    while (_inFlight != null) {
      await _inFlight;
    }
  }

  Future<void> restore() async {
    _queue
      ..clear()
      ..addAll(await _storage.load());
    _emit();
  }

  /// Bật nhịp tự thử gửi lại cố định mỗi 3 giây (Master SRS mục 4).
  ///
  /// Đây là lớp bảo hiểm thứ hai bên cạnh `ConnectionManager` (vốn cũng gọi
  /// `flush()` mỗi khi phát hiện có mạng lại): nếu máy POS báo lỗi tạm thời
  /// (5xx) trong lúc LAN vẫn "sống" — network vẫn ping được — hàng đợi sẽ
  /// không đứng yên chờ sự kiện online/offline mà tự thử lại đều đặn.
  /// `flush()` tự bỏ qua nếu hàng đợi rỗng hoặc đang chạy, nên gọi thừa
  /// không hại gì.
  void startAutoRetry({Duration interval = const Duration(seconds: 3)}) {
    _retryTimer?.cancel();
    _retryTimer = Timer.periodic(interval, (_) => flush());
  }

  /// Nhận đơn từ màn hình giỏ hàng.
  ///
  /// Ghi xuống đĩa TRƯỚC khi trả về, để nhân viên thấy "đã gửi" là đơn thật
  /// sự an toàn — kể cả khi app bị giết ngay sau đó.
  Future<void> enqueue(String orderId, Map<String, dynamic> payload) async {
    // Chống bấm hai lần: cùng orderId thì bỏ qua.
    if (_queue.any((o) => o.orderId == orderId)) return;

    _queue.add(PendingOrder(
      orderId: orderId,
      payload: payload,
      queuedAt: DateTime.now(),
    ));
    await _storage.save(_queue);
    _emit();

    unawaited(flush());
  }

  void setOnline(bool online) {
    if (_online == online) return;
    _online = online;
    _emit();
    if (online) unawaited(flush());
  }

  /// Đẩy hàng đợi lên máy POS, TUẦN TỰ theo đúng thứ tự vào hàng.
  Future<void> flush() {
    if (_flushing || _queue.isEmpty) return _inFlight ?? Future<void>.value();
    final future = _flush();
    _inFlight = future;
    return future.whenComplete(() {
      if (identical(_inFlight, future)) _inFlight = null;
    });
  }

  Future<void> _flush() async {
    _flushing = true;
    _emit();

    try {
      // Duyệt bản sao: danh sách gốc bị sửa trong vòng lặp.
      for (final order in List<PendingOrder>.from(_queue)) {
        final result = await _sender(order.payload);

        switch (result.outcome) {
          case SendOutcome.accepted:
            _queue.removeWhere((o) => o.orderId == order.orderId);
            await _storage.save(_queue);
            _emit();

          case SendOutcome.rejected:
            // Lỗi nghiệp vụ: gửi lại cũng vô ích. Đưa sang danh sách chờ xử lý
            // thủ công để nhân viên biết đơn nào không vào được và vì sao.
            order.lastError = result.message;
            _deadLetter.add(order);
            _queue.removeWhere((o) => o.orderId == order.orderId);
            await _storage.save(_queue);
            _emit();

          case SendOutcome.unreachable:
            order.attempts++;
            order.lastError = result.message;

            if (order.attempts >= maxAttempts) {
              _deadLetter.add(order);
              _queue.removeWhere((o) => o.orderId == order.orderId);
            }
            await _storage.save(_queue);
            _emit();

            // DỪNG cả vòng lặp. Mạng đã hỏng thì các đơn sau cũng hỏng, và
            // quan trọng hơn: gửi tiếp sẽ phá vỡ thứ tự FIFO.
            return;
        }
      }
    } finally {
      _flushing = false;
      _emit();
    }
  }

  /// Nhân viên bấm "thử lại" trên một đơn trong danh sách chờ xử lý.
  Future<void> retryDeadLetter(String orderId) async {
    final index = _deadLetter.indexWhere((o) => o.orderId == orderId);
    if (index < 0) return;

    final order = _deadLetter.removeAt(index);
    order.attempts = 0;
    order.lastError = null;
    _queue.add(order);
    await _storage.save(_queue);
    _emit();
    unawaited(flush());
  }

  Future<void> discardDeadLetter(String orderId) async {
    _deadLetter.removeWhere((o) => o.orderId == orderId);
    _emit();
  }

  void _emit() {
    if (_stateController.isClosed) return;
    _stateController.add(QueueState(
      pendingCount: _queue.length,
      isFlushing: _flushing,
      isOnline: _online,
      lastError: _queue.isNotEmpty ? _queue.first.lastError : null,
    ));
  }

  Future<void> dispose() async {
    _retryTimer?.cancel();
    await _stateController.close();
  }
}
