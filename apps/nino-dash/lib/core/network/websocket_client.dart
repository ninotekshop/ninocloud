import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';

class RealtimeEvent {
  final String event;
  final String eventId;
  final DateTime sentAt;
  final Map<String, dynamic> data;

  const RealtimeEvent({
    required this.event,
    required this.eventId,
    required this.sentAt,
    required this.data,
  });

  factory RealtimeEvent.fromJson(Map<String, dynamic> json) {
    return RealtimeEvent(
      event: json['event'] as String? ?? 'UNKNOWN',
      eventId: json['eventId'] as String? ?? '',
      sentAt: json['sentAt'] != null
          ? DateTime.tryParse(json['sentAt'] as String) ?? DateTime.now()
          : DateTime.now(),
      data: json['data'] as Map<String, dynamic>? ?? const {},
    );
  }
}

class DashboardWebSocketClient {
  final String wsUrl;
  WebSocketChannel? _channel;
  StreamSubscription? _subscription;

  final StreamController<RealtimeEvent> _eventController = StreamController<RealtimeEvent>.broadcast();
  final Set<String> _processedEventIds = {};

  bool _isConnected = false;
  bool get isConnected => _isConnected;

  Stream<RealtimeEvent> get eventStream => _eventController.stream;

  DashboardWebSocketClient({
    this.wsUrl = 'ws://127.0.0.1:3000/ws/cloud/realtime-reports',
  });

  void connect() {
    try {
      _channel = WebSocketChannel.connect(Uri.parse(wsUrl));
      _isConnected = true;

      _subscription = _channel!.stream.listen(
        (message) {
          _handleMessage(message as String);
        },
        onError: (error) {
          _isConnected = false;
          _scheduleReconnect();
        },
        onDone: () {
          _isConnected = false;
          _scheduleReconnect();
        },
      );
    } catch (_) {
      _isConnected = false;
    }
  }

  void _handleMessage(String rawMessage) {
    try {
      final Map<String, dynamic> json = jsonDecode(rawMessage);
      final event = RealtimeEvent.fromJson(json);

      // Deduplication check via eventId
      if (event.eventId.isNotEmpty && _processedEventIds.contains(event.eventId)) {
        return; // Ignore duplicate
      }
      if (event.eventId.isNotEmpty) {
        _processedEventIds.add(event.eventId);
        if (_processedEventIds.length > 500) {
          _processedEventIds.remove(_processedEventIds.first);
        }
      }

      _eventController.add(event);
    } catch (_) {}
  }

  void _scheduleReconnect() {
    Timer(const Duration(seconds: 10), () {
      if (!_isConnected) {
        connect();
      }
    });
  }

  /// Giả lập phát sự kiện WS real-time (dành cho demo / offline testing)
  void simulateEvent(RealtimeEvent event) {
    _isConnected = true;
    _eventController.add(event);
  }

  void dispose() {
    _subscription?.cancel();
    _channel?.sink.close();
    _eventController.close();
  }
}
