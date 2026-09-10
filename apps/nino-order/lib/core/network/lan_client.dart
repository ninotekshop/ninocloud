// =====================================================================
//  NINOTEK NinoOrder — Client kết nối LAN tới máy NinoPOS
// =====================================================================
//  Toàn bộ giao tiếp đi trong mạng nội bộ quán. KHÔNG cần Internet.
//  Khớp packages/api-contracts/openapi.yaml, phần LAN API.
// =====================================================================

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../offline/offline_queue.dart';

class LanServerInfo {
  const LanServerInfo({
    required this.host,
    required this.port,
    required this.storeName,
    required this.storeCode,
    required this.posVersion,
    required this.protocolVersion,
  });

  final String host;
  final int port;
  final String storeName;
  final String storeCode;
  final String posVersion;
  final int protocolVersion;

  String get baseUrl => 'http://$host:$port';
}

/// Kết quả ghép nối thành công: `deviceId` để hiển thị/nhận diện, và
/// `deviceToken` gửi kèm header Authorization ở mọi lời gọi LAN sau đó.
class PairResult {
  const PairResult({required this.deviceId, required this.deviceToken});
  final String deviceId;
  final String deviceToken;
}

/// Phiên bản giao thức mà app này nói được.
/// Máy POS trả về số khác nghĩa là một trong hai bên đã cũ — phải báo người
/// dùng cập nhật, KHÔNG được cố chạy tiếp rồi hỏng theo cách khó hiểu.
const int kSupportedProtocolVersion = 1;

class ProtocolMismatchException implements Exception {
  ProtocolMismatchException(this.serverVersion);
  final int serverVersion;

  @override
  String toString() => serverVersion > kSupportedProtocolVersion
      ? 'Máy thu ngân đã được cập nhật. Vui lòng cập nhật app NinoOrder.'
      : 'App NinoOrder mới hơn máy thu ngân. Vui lòng cập nhật NinoPOS.';
}

class LanClient {
  LanClient({http.Client? httpClient, this.timeout = const Duration(seconds: 5)})
      : _http = httpClient ?? http.Client();

  final http.Client _http;

  /// Thời gian chờ tối đa. Đặt ngắn có chủ ý: nhân viên đứng cạnh bàn khách,
  /// chờ quá 5 giây là quá lâu. Hết giờ thì đưa đơn vào hàng đợi offline —
  /// nhanh hơn nhiều so với để họ đứng nhìn vòng xoay.
  final Duration timeout;

  LanServerInfo? _server;
  String? _deviceToken;
  String? _deviceId;

  LanServerInfo? get server => _server;
  bool get isPaired => _deviceToken != null;
  String? get deviceId => _deviceId;

  void configure(LanServerInfo server, String? deviceToken, {String? deviceId}) {
    _server = server;
    _deviceToken = deviceToken;
    _deviceId = deviceId;
  }

  /// Xoá mọi cấu hình đã ghép nối — dùng khi nhân viên bấm "Ghép nối lại
  /// máy khác". Tầng gọi (AppRoot) cũng phải xoá [DeviceStorage] tương ứng.
  void reset() {
    _server = null;
    _deviceToken = null;
    _deviceId = null;
  }

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (_deviceToken != null) 'Authorization': 'Bearer $_deviceToken',
      };

  /// Header dùng khi mở kết nối WebSocket tới `/ws/lan/tables` và
  /// `/ws/lan/kitchen`. Middleware NinoPOS yêu cầu Bearer token trên CẢ hai
  /// loại kết nối (REST lẫn WebSocket) — bắt tay HTTP nâng cấp lên
  /// WebSocket vẫn đọc header như một request HTTP bình thường.
  /// Trả về map rỗng khi chưa ghép nối, để tránh gửi `Authorization: Bearer null`.
  Map<String, String> get websocketHeaders =>
      _deviceToken == null ? const {} : {'Authorization': 'Bearer $_deviceToken'};

  // ------------------------------------------------------------------
  // Dò tìm máy POS
  // ------------------------------------------------------------------

  /// Xác nhận địa chỉ này đúng là một máy NinoPOS.
  ///
  /// Gọi khi nhân viên gõ IP thủ công, hoặc lần lượt cho từng địa chỉ trong
  /// [scanSubnet]. Đây là endpoint LAN duy nhất KHÔNG cần deviceToken.
  Future<LanServerInfo?> probe(String host, {int port = 8080}) async {
    try {
      final res = await _http
          .get(Uri.parse('http://$host:$port/api/v1/lan/discovery'))
          .timeout(const Duration(seconds: 2));
      if (res.statusCode != 200) return null;

      final json = jsonDecode(res.body) as Map<String, dynamic>;
      final protocol = (json['protocolVersion'] as num).toInt();
      if (protocol != kSupportedProtocolVersion) {
        throw ProtocolMismatchException(protocol);
      }
      return LanServerInfo(
        host: host,
        port: port,
        storeName: json['storeName'] as String,
        storeCode: json['storeCode'] as String,
        posVersion: json['posVersion'] as String,
        protocolVersion: protocol,
      );
    } on ProtocolMismatchException {
      rethrow;
    } catch (_) {
      return null;
    }
  }

  /// Quét dải mạng nội bộ (ví dụ subnetPrefix="192.168.1" quét .1 → .254).
  ///
  /// Dùng khi nhân viên không biết chính xác IP máy thu ngân — chỉ cần biết
  /// 3 số đầu (thường trùng với IP tablet, trừ số cuối). Quét song song 254
  /// địa chỉ với timeout ngắn, nhanh hơn nhiều so với dò từng địa chỉ.
  Future<List<LanServerInfo>> scanSubnet(String subnetPrefix,
      {int port = 8080}) async {
    final futures = <Future<LanServerInfo?>>[];
    for (var i = 1; i <= 254; i++) {
      futures.add(probe('$subnetPrefix.$i', port: port).catchError((_) => null));
    }
    final results = await Future.wait(futures);
    return results.whereType<LanServerInfo>().toList();
  }

  // ------------------------------------------------------------------
  // Ghép nối
  // ------------------------------------------------------------------

  /// Ghép nối tablet với máy POS bằng mã 6 số hiển thị trên màn hình
  /// NinoPOS. Thành công thì lưu ngay deviceId/deviceToken vào client này —
  /// gọi `configure`/lưu xuống [DeviceStorage] ở tầng gọi để dùng lại lần
  /// sau, không bắt nhân viên ghép nối lại mỗi lần mở app.
  Future<PairResult> pair({
    required String deviceName,
    required String deviceType,
    required String pairingCode,
  }) async {
    final res = await _post('/api/v1/lan/devices/pair', {
      'deviceName': deviceName,
      'deviceType': deviceType,
      'pairingCode': pairingCode,
    });
    if (res.statusCode != 200) {
      throw LanApiException.fromResponse(res);
    }
    final json = jsonDecode(res.body) as Map<String, dynamic>;
    final result = PairResult(
      deviceId: json['deviceId'] as String,
      deviceToken: json['deviceToken'] as String,
    );
    _deviceId = result.deviceId;
    _deviceToken = result.deviceToken;
    return result;
  }

  // ------------------------------------------------------------------
  // Nghiệp vụ
  // ------------------------------------------------------------------

  Future<List<Map<String, dynamic>>> fetchTables({String? areaId}) async {
    final query = areaId == null ? '' : '?areaId=$areaId';
    final res = await _get('/api/v1/lan/tables/status$query');
    if (res.statusCode != 200) throw LanApiException.fromResponse(res);
    return (jsonDecode(res.body) as List).cast<Map<String, dynamic>>();
  }

  /// Trả về null khi thực đơn chưa đổi (HTTP 304) — dùng bản cache.
  Future<Map<String, dynamic>?> fetchMenu({String? etag}) async {
    final res = await _get('/api/v1/lan/menu',
        extraHeaders: etag == null ? null : {'If-None-Match': etag});
    if (res.statusCode == 304) return null;
    if (res.statusCode != 200) throw LanApiException.fromResponse(res);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<DateTime> lockTable(String tableId,
      {required String userId, required String userName}) async {
    final res = await _post('/api/v1/lan/tables/$tableId/lock', const {},
        // Server derives identity from the paired device token. Keep the
        // parameters for source compatibility with older callers.
        extraHeaders: const {});
    if (res.statusCode != 200) throw LanApiException.fromResponse(res);
    final json = jsonDecode(res.body) as Map<String, dynamic>;
    return DateTime.parse(json['lockedUntil'] as String);
  }

  /// Gửi đơn lên máy POS.
  ///
  /// Phân biệt rõ ba kết quả cho hàng đợi offline dùng:
  ///   • 200/201 → đã ghi nhận, xoá khỏi hàng đợi
  ///   • 4xx     → lỗi nghiệp vụ, gửi lại vô ích
  ///   • timeout → chưa rõ, GIỮ LẠI và thử lần sau
  Future<SendResult> createOrder(Map<String, dynamic> payload) async {
    try {
      final res = await _post('/api/v1/lan/order/create', payload);

      if (res.statusCode == 200 || res.statusCode == 201) {
        return SendResult(
          SendOutcome.accepted,
          body: jsonDecode(res.body) as Map<String, dynamic>,
        );
      }
      if (res.statusCode >= 400 && res.statusCode < 500) {
        return SendResult(SendOutcome.rejected,
            message: LanApiException.fromResponse(res).message);
      }
      // 5xx: máy POS lỗi tạm thời — thử lại có thể thành công
      return SendResult(SendOutcome.unreachable,
          message: 'Máy thu ngân báo lỗi ${res.statusCode}');
    } on TimeoutException {
      // KHÔNG coi là thất bại. Đơn có thể đã tới nơi và đang được xử lý.
      // Gửi lại an toàn vì orderId do tablet sinh, máy POS khử trùng lặp.
      return const SendResult(SendOutcome.unreachable,
          message: 'Máy thu ngân không phản hồi');
    } on SocketException catch (e) {
      return SendResult(SendOutcome.unreachable, message: 'Mất kết nối: ${e.message}');
    } on http.ClientException catch (e) {
      return SendResult(SendOutcome.unreachable, message: 'Mất kết nối: ${e.message}');
    }
  }

  Future<Map<String, dynamic>> updateKitchenStatus(
      String orderDetailId, String status, int rowVersion) async {
    final uri = Uri.parse(
        '${_requireServer().baseUrl}/api/v1/lan/order-details/$orderDetailId/kitchen-status');
    final res = await _http
        .patch(uri,
            headers: _headers,
            body: jsonEncode({'kitchenStatus': status, 'rowVersion': rowVersion}))
        .timeout(timeout);
    if (res.statusCode != 200) throw LanApiException.fromResponse(res);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  /// Chuyển bàn hoặc gộp bàn.
  ///
  /// `mergeIfOccupied: false` (mặc định) khớp hành vi "chuyển bàn": máy POS
  /// từ chối nếu bàn đích đã có khách. `mergeIfOccupied: true` khớp "gộp
  /// bàn": nhập đơn hiện tại vào đơn đang mở ở bàn đích.
  Future<Map<String, dynamic>> transferOrder(
    String orderId, {
    required String targetTableId,
    required int rowVersion,
    bool mergeIfOccupied = false,
  }) async {
    final res = await _post('/api/v1/lan/orders/$orderId/transfer', {
      'targetTableId': targetTableId,
      'mergeIfOccupied': mergeIfOccupied,
      'rowVersion': rowVersion,
    });
    if (res.statusCode != 200) throw LanApiException.fromResponse(res);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  /// Ping nhẹ để ConnectionManager biết máy POS còn sống.
  Future<bool> ping() async {
    try {
      final res = await _http
          .get(Uri.parse('${_requireServer().baseUrl}/health'))
          .timeout(const Duration(seconds: 2));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  // ------------------------------------------------------------------

  LanServerInfo _requireServer() {
    final s = _server;
    if (s == null) {
      throw StateError('Chưa kết nối máy thu ngân. Gọi configure() trước.');
    }
    return s;
  }

  Future<http.Response> _get(String path, {Map<String, String>? extraHeaders}) =>
      _http
          .get(Uri.parse('${_requireServer().baseUrl}$path'),
              headers: {..._headers, ...?extraHeaders})
          .timeout(timeout);

  Future<http.Response> _post(String path, Map<String, dynamic> body,
          {Map<String, String>? extraHeaders}) =>
      _http
          .post(Uri.parse('${_requireServer().baseUrl}$path'),
              headers: {..._headers, ...?extraHeaders}, body: jsonEncode(body))
          .timeout(timeout);

  void dispose() => _http.close();
}

class LanApiException implements Exception {
  LanApiException(this.statusCode, this.message, {this.currentRowVersion});

  final int statusCode;
  final String message;

  /// Có giá trị khi lỗi 409 — dùng để hiển thị và cho phép thử lại.
  final int? currentRowVersion;

  bool get isConflict => statusCode == 409;

  factory LanApiException.fromResponse(http.Response res) {
    try {
      final json = jsonDecode(res.body) as Map<String, dynamic>;
      return LanApiException(
        res.statusCode,
        (json['title'] ?? json['detail'] ?? 'Lỗi ${res.statusCode}') as String,
        currentRowVersion: (json['currentRowVersion'] as num?)?.toInt(),
      );
    } catch (_) {
      return LanApiException(res.statusCode, 'Lỗi ${res.statusCode}');
    }
  }

  @override
  String toString() => message;
}
