// =====================================================================
//  NINOTEK NinoOrder — Quản lý kết nối LAN và tự kết nối lại
// =====================================================================
//  Master SRS yêu cầu: mất LAN thì hiện banner cảnh báo và tự thử kết nối
//  lại mỗi 3 giây.
//
//  Vì sao nhịp CỐ ĐỊNH 3 giây chứ không phải backoff luỹ thừa như thường lệ:
//  nhân viên đang đứng cạnh bàn khách và cần biết NGAY khi nào gọi món được
//  trở lại. Backoff giãn tới 30 giây nghĩa là họ đứng chờ nửa phút không biết
//  chuyện gì đang xảy ra. Đây là mạng LAN, không phải Internet — ping mỗi 3
//  giây gần như không tốn gì.
// =====================================================================

import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'lan_client.dart';

enum ConnectionStatus {
  /// Chưa chọn máy thu ngân.
  disconnected,

  /// Đang dò tìm hoặc đang thử kết nối lại.
  connecting,

  /// Đang kết nối bình thường.
  connected,

  /// Mất kết nối, đang tự thử lại. Đây là lúc hiện banner đỏ.
  reconnecting,
}

class LanConnectionState {
  const LanConnectionState({
    required this.status,
    this.lastConnectedAt,
    this.attempts = 0,
    this.message,
    this.latencyMs,
  });

  final ConnectionStatus status;
  final DateTime? lastConnectedAt;
  final int attempts;
  final String? message;

  /// Độ trễ round-trip của lần ping gần nhất, tính bằng mili-giây.
  /// Null khi chưa đo được lần nào (mất kết nối, hoặc mới khởi động).
  final int? latencyMs;

  bool get isOnline => status == ConnectionStatus.connected;

  /// Chỉ hiện banner khi thực sự mất kết nối, không hiện lúc khởi động.
  bool get shouldShowBanner => status == ConnectionStatus.reconnecting;
}

class ConnectionManager {
  ConnectionManager({
    required LanClient client,
    this.retryInterval = const Duration(seconds: 3),
    this.heartbeatInterval = const Duration(seconds: 10),
  }) : _client = client;

  final LanClient _client;

  /// Nhịp thử kết nối lại — cố định 3 giây theo Master SRS.
  final Duration retryInterval;

  /// Nhịp ping khi đang kết nối tốt, để phát hiện mất mạng sớm.
  final Duration heartbeatInterval;

  final _controller = StreamController<LanConnectionState>.broadcast();
  final _eventController = StreamController<Map<String, dynamic>>.broadcast();

  Timer? _timer;
  WebSocketChannel? _kitchenSocket;
  WebSocketChannel? _tableSocket;
  StreamSubscription<dynamic>? _kitchenSub;
  StreamSubscription<dynamic>? _tableSub;

  /// eventId đã xử lý — máy POS phát lại sự kiện cũ khi ta nối lại, và
  /// xử lý hai lần sẽ làm sơ đồ bàn nhấp nháy sai hoặc đếm trùng món.
  final Set<String> _seenEventIds = <String>{};

  LanConnectionState _state = const LanConnectionState(status: ConnectionStatus.disconnected);

  LanConnectionState get state => _state;
  Stream<LanConnectionState> get stateStream => _controller.stream;

  /// Sự kiện real-time từ máy POS, đã khử trùng lặp theo eventId.
  Stream<Map<String, dynamic>> get events => _eventController.stream;

  Future<void> start() async {
    _emit(const LanConnectionState(status: ConnectionStatus.connecting));
    await _attempt();
    _timer?.cancel();
    _timer = Timer.periodic(retryInterval, (_) => _tick());
  }

  Future<void> _tick() async {
    // Khi đang khoẻ thì ping thưa hơn để đỡ tốn pin tablet.
    if (_state.isOnline) {
      final since = DateTime.now().difference(_state.lastConnectedAt ?? DateTime(0));
      if (since < heartbeatInterval) return;
    }
    await _attempt();
  }

  Future<void> _attempt() async {
    final stopwatch = Stopwatch()..start();
    final alive = await _client.ping();
    stopwatch.stop();

    if (alive) {
      if (!_state.isOnline) {
        await _openSockets();
      }
      _emit(LanConnectionState(
        status: ConnectionStatus.connected,
        lastConnectedAt: DateTime.now(),
        latencyMs: stopwatch.elapsedMilliseconds,
      ));
      return;
    }

    await _closeSockets();
    _emit(LanConnectionState(
      status: ConnectionStatus.reconnecting,
      lastConnectedAt: _state.lastConnectedAt,
      attempts: _state.attempts + 1,
      message: 'Đang mất kết nối với trạm thu ngân',
    ));
  }

  Future<void> _openSockets() async {
    final server = _client.server;
    if (server == null) return;

    await _closeSockets();
    final base = 'ws://${server.host}:${server.port}/ws/lan';

    // Middleware NinoPOS yêu cầu Bearer token trên WebSocket giống như REST —
    // dùng IOWebSocketChannel (dart:io) vì đây là API duy nhất trong gói
    // web_socket_channel cho phép gửi kèm header tuỳ chỉnh lúc bắt tay HTTP
    // nâng cấp lên WebSocket. App chỉ chạy Android/iOS/Tablet (không chạy
    // web), nên phụ thuộc dart:io ở đây là an toàn.
    _kitchenSocket = IOWebSocketChannel.connect(Uri.parse('$base/kitchen'),
        headers: _client.websocketHeaders);
    _tableSocket = IOWebSocketChannel.connect(Uri.parse('$base/tables'),
        headers: _client.websocketHeaders);

    _kitchenSub = _kitchenSocket!.stream.listen(_onMessage,
        onError: (_) => _markLost(), onDone: _markLost);
    _tableSub = _tableSocket!.stream.listen(_onMessage,
        onError: (_) => _markLost(), onDone: _markLost);
  }

  void _onMessage(dynamic raw) {
    try {
      final json = _decode(raw);
      if (json == null) return;

      final eventId = json['eventId'] as String?;
      // Khử trùng lặp: máy POS phát lại tối đa 20 sự kiện gần nhất khi ta nối lại.
      if (eventId != null && !_seenEventIds.add(eventId)) return;

      // Giới hạn bộ nhớ — ca làm 12 tiếng sinh ra rất nhiều sự kiện.
      if (_seenEventIds.length > 500) {
        final excess = _seenEventIds.take(250).toList();
        _seenEventIds.removeAll(excess);
      }

      _eventController.add(json);
    } catch (_) {
      // Message hỏng không được làm sập kênh sự kiện.
    }
  }

  Map<String, dynamic>? _decode(dynamic raw) {
    if (raw is! String) return null;
    try {
      final decoded = jsonDecode(raw);
      return decoded is Map<String, dynamic> ? decoded : null;
    } on FormatException {
      return null;
    }
  }

  void _markLost() {
    if (!_state.isOnline) return;
    _emit(LanConnectionState(
      status: ConnectionStatus.reconnecting,
      lastConnectedAt: _state.lastConnectedAt,
      attempts: _state.attempts + 1,
      message: 'Đang mất kết nối với trạm thu ngân',
    ));
  }

  Future<void> _closeSockets() async {
    await _kitchenSub?.cancel();
    await _tableSub?.cancel();
    _kitchenSub = null;
    _tableSub = null;
    await _kitchenSocket?.sink.close();
    await _tableSocket?.sink.close();
    _kitchenSocket = null;
    _tableSocket = null;
  }

  void _emit(LanConnectionState next) {
    _state = next;
    if (!_controller.isClosed) _controller.add(next);
  }

  Future<void> dispose() async {
    _timer?.cancel();
    await _closeSockets();
    await _controller.close();
    await _eventController.close();
  }
}
