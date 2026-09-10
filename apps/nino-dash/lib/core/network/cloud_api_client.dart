import 'dart:convert';
import 'package:http/http.dart' as http;

import '../../models/dashboard_report.dart';
import '../../models/live_table.dart';
import '../../models/store_branch.dart';

class ConnectionTestResult {
  final bool isLive;
  final String serverType; // 'NinoCloud', 'NinoPOS LAN', 'Offline'
  final String message;
  final int? statusCode;

  const ConnectionTestResult({
    required this.isLive,
    required this.serverType,
    required this.message,
    this.statusCode,
  });
}

class DiscoveredPosStation {
  final String ip;
  final int port;
  final String storeName;
  final String storeCode;
  final String posVersion;

  const DiscoveredPosStation({
    required this.ip,
    this.port = 8080,
    required this.storeName,
    required this.storeCode,
    required this.posVersion,
  });

  String get baseUrl => 'http://$ip:$port/api/v1';
}

class CloudApiClient {
  String baseUrl;
  String? accessToken;
  bool isLanMode;

  CloudApiClient({
    this.baseUrl = 'http://127.0.0.1:3000/api/v1',
    this.accessToken,
    this.isLanMode = false,
  });

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (accessToken != null && accessToken!.isNotEmpty)
          'Authorization': 'Bearer $accessToken',
      };

  /// Quét tự động mạng LAN để phát hiện trạm thu ngân NinoPOS
  static Future<List<DiscoveredPosStation>> discoverLanPosStations({
    List<String>? candidatePrefixes,
    int port = 8080,
    Function(int current, int total)? onProgress,
  }) async {
    final List<DiscoveredPosStation> discovered = [];

    // Candidate prefixes for local network scan
    final prefixes = candidatePrefixes ?? ['192.168.1', '192.168.0', '192.168.88', '10.0.2', '127.0.0.1'];

    final candidateIps = <String>[];
    for (var prefix in prefixes) {
      if (prefix == '127.0.0.1') {
        candidateIps.add('127.0.0.1');
      } else {
        for (int i = 1; i <= 254; i++) {
          candidateIps.add('$prefix.$i');
        }
      }
    }

    int processed = 0;
    const batchSize = 35; // Concurrent scan batch

    for (int i = 0; i < candidateIps.length; i += batchSize) {
      final batch = candidateIps.sublist(
        i,
        (i + batchSize < candidateIps.length) ? i + batchSize : candidateIps.length,
      );

      final futures = batch.map((ip) async {
        try {
          final uri = Uri.parse('http://$ip:$port/api/v1/lan/discovery');
          final response = await http.get(uri).timeout(const Duration(milliseconds: 600));
          if (response.statusCode == 200) {
            final Map<String, dynamic> body = jsonDecode(response.body);
            return DiscoveredPosStation(
              ip: ip,
              port: port,
              storeName: body['storeName'] as String? ?? 'NinoPOS Station',
              storeCode: body['storeCode'] as String? ?? 'STORE_LAN',
              posVersion: body['posVersion'] as String? ?? '1.0.0',
            );
          }
        } catch (_) {}
        return null;
      });

      final results = await Future.wait(futures);
      for (var res in results) {
        if (res != null) {
          discovered.add(res);
        }
      }

      processed += batch.length;
      if (onProgress != null) {
        onProgress(processed, candidateIps.length);
      }
    }

    return discovered;
  }

  /// Kiểm tra kết nối tới Server (NinoCloud hoặc NinoPOS LAN)
  Future<ConnectionTestResult> testConnection() async {
    try {
      if (isLanMode || baseUrl.contains(':8080')) {
        final uri = Uri.parse('$baseUrl/lan/discovery');
        final response = await http.get(uri).timeout(const Duration(seconds: 3));
        if (response.statusCode == 200) {
          final Map<String, dynamic> body = jsonDecode(response.body);
          return ConnectionTestResult(
            isLive: true,
            serverType: 'NinoPOS LAN',
            message: 'Đã kết nối trực tiếp trạm thu ngân: ${body['storeName'] ?? 'NinoPOS'}',
            statusCode: 200,
          );
        }
      }

      // Try Cloud Health or Dashboard
      final uri = Uri.parse('$baseUrl/cloud/reports/dashboard').replace(
        queryParameters: {
          'storeId': '22222222-2222-4222-8222-222222222222',
          'from': DateTime.now().toIso8601String().substring(0, 10),
          'to': DateTime.now().toIso8601String().substring(0, 10),
        },
      );

      final response = await http.get(uri, headers: _headers).timeout(const Duration(seconds: 3));
      if (response.statusCode == 200) {
        return const ConnectionTestResult(
          isLive: true,
          serverType: 'NinoCloud Backend',
          message: 'Đã kết nối máy chủ NinoCloud (HTTP 200 OK)',
          statusCode: 200,
        );
      } else if (response.statusCode == 401 || response.statusCode == 403) {
        return ConnectionTestResult(
          isLive: true,
          serverType: 'NinoCloud Backend',
          message: 'Máy chủ phản hồi HTTP ${response.statusCode} (Cần JWT Token hợp lệ)',
          statusCode: response.statusCode,
        );
      }
      return ConnectionTestResult(
        isLive: false,
        serverType: 'Offline',
        message: 'Máy chủ phản hồi mã lỗi HTTP ${response.statusCode}',
        statusCode: response.statusCode,
      );
    } catch (e) {
      final errStr = e.toString();
      String tip = 'Không thể kết nối tới $baseUrl';
      if (errStr.contains('Connection refused') && baseUrl.contains('127.0.0.1')) {
        tip = 'Không thể dùng 127.0.0.1 trên điện thoại di động.\n👉 Hãy nhấn nút "🔍 Tự động quét tìm trạm POS" bên dưới hoặc chọn IP Wi-Fi máy tính.';
      } else if (errStr.contains('Connection refused')) {
        tip = 'Máy chủ $baseUrl từ chối kết nối (Server chưa bật hoặc sai cổng/IP).';
      }
      return ConnectionTestResult(
        isLive: false,
        serverType: 'Offline',
        message: tip,
      );
    }
  }

  /// Lấy báo cáo doanh thu & chỉ số KPI cho NinoDash (từ NinoCloud hoặc NinoPOS LAN)
  Future<DashboardReport> getDashboardReport({
    required String storeId,
    required String fromDate,
    required String toDate,
  }) async {
    try {
      // If LAN POS Direct Mode
      if (isLanMode || baseUrl.contains(':8080')) {
        final uri = Uri.parse('$baseUrl/lan/reports/dashboard');
        final response = await http.get(uri, headers: _headers).timeout(const Duration(seconds: 4));
        if (response.statusCode == 200) {
          final Map<String, dynamic> body = jsonDecode(response.body);
          return DashboardReport.fromJson(body);
        }
      }

      // Try Cloud Endpoint
      final uri = Uri.parse('$baseUrl/cloud/reports/dashboard').replace(
        queryParameters: {
          'storeId': storeId,
          'from': fromDate,
          'to': toDate,
        },
      );

      final response = await http.get(uri, headers: _headers).timeout(const Duration(seconds: 4));

      if (response.statusCode == 200) {
        final Map<String, dynamic> body = jsonDecode(response.body);
        return DashboardReport.fromJson(body);
      }
    } catch (_) {}

    // Return real empty report (0đ) instead of fake mock numbers
    return DashboardReport.empty();
  }

  /// Lấy trạng thái sơ đồ bàn real-time (hỗ trợ cả NinoCloud & NinoPOS LAN API)
  Future<List<LiveTable>> getLiveTables({required String storeId}) async {
    try {
      // If LAN POS Direct Mode
      if (isLanMode || baseUrl.contains(':8080')) {
        final uri = Uri.parse('$baseUrl/lan/tables/status');
        final response = await http.get(uri, headers: _headers).timeout(const Duration(seconds: 3));
        if (response.statusCode == 200) {
          final List<dynamic> list = jsonDecode(response.body);
          return list.map((e) {
            final Map<String, dynamic> map = e as Map<String, dynamic>;
            return LiveTable(
              tableId: map['id'] as String? ?? '',
              tableName: map['name'] as String? ?? 'Bàn',
              zoneName: 'Trạm LAN POS',
              status: map['status'] as String? ?? 'EMPTY',
              guestCount: (map['guestCount'] as num?)?.toInt() ?? 0,
              runningTotal: (map['runningTotal'] as num?)?.toDouble() ?? 0.0,
              openedAt: map['seatedMinutes'] != null
                  ? DateTime.now().subtract(Duration(minutes: (map['seatedMinutes'] as num).toInt()))
                  : null,
            );
          }).toList();
        }
      }

      // Try Cloud Endpoint
      final uri = Uri.parse('$baseUrl/cloud/reports/tables/active').replace(
        queryParameters: {'storeId': storeId},
      );

      final response = await http.get(uri, headers: _headers).timeout(const Duration(seconds: 3));

      if (response.statusCode == 200) {
        final List<dynamic> list = jsonDecode(response.body);
        return list.map((e) => LiveTable.fromJson(e as Map<String, dynamic>)).toList();
      }
    } catch (_) {}

    return LiveTable.mockTables();
  }

  /// Lấy danh sách các chi nhánh thuộc tài khoản Owner
  Future<List<StoreBranch>> getStoreBranches() async {
    try {
      final uri = Uri.parse('$baseUrl/cloud/tenants/branches');
      final response = await http.get(uri, headers: _headers).timeout(const Duration(seconds: 3));

      if (response.statusCode == 200) {
        final List<dynamic> list = jsonDecode(response.body);
        return list.map((e) => StoreBranch.fromJson(e as Map<String, dynamic>)).toList();
      }
    } catch (_) {}

    return StoreBranch.mockBranches();
  }
}
