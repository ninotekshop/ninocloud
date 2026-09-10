// =====================================================================
//  NINOTEK NinoOrder — Lưu cấu hình ghép nối cục bộ trên thiết bị
// =====================================================================
//  Sau khi ghép nối một lần, tablet phải nhớ máy NinoPOS nào và deviceToken
//  nào — nhân viên không thể ghép nối lại mỗi lần mở app. Dùng
//  SharedPreferences: đơn giản, phổ biến, đủ cho vài chục byte cấu hình.
// =====================================================================

import 'package:shared_preferences/shared_preferences.dart';

import '../network/lan_client.dart';

/// Cấu hình đã ghép nối, đọc lại được sau khi tắt/mở app.
class PairedDeviceConfig {
  const PairedDeviceConfig({
    required this.server,
    required this.deviceId,
    required this.deviceToken,
    required this.deviceName,
  });

  final LanServerInfo server;
  final String deviceId;
  final String deviceToken;
  final String deviceName;
}

/// Bọc SharedPreferences để phần còn lại của app không cần biết tên khoá.
class DeviceStorage {
  static const _kHost = 'pos_host';
  static const _kPort = 'pos_port';
  static const _kStoreName = 'pos_store_name';
  static const _kStoreCode = 'pos_store_code';
  static const _kPosVersion = 'pos_version';
  static const _kProtocolVersion = 'pos_protocol_version';
  static const _kDeviceId = 'device_id';
  static const _kDeviceToken = 'device_token';
  static const _kDeviceName = 'device_name';

  /// Đọc cấu hình đã lưu, hoặc null nếu tablet này chưa từng ghép nối.
  Future<PairedDeviceConfig?> load() async {
    final prefs = await SharedPreferences.getInstance();
    final host = prefs.getString(_kHost);
    final token = prefs.getString(_kDeviceToken);
    final deviceId = prefs.getString(_kDeviceId);
    if (host == null || token == null || deviceId == null) return null;

    return PairedDeviceConfig(
      server: LanServerInfo(
        host: host,
        port: prefs.getInt(_kPort) ?? 8080,
        storeName: prefs.getString(_kStoreName) ?? '',
        storeCode: prefs.getString(_kStoreCode) ?? '',
        posVersion: prefs.getString(_kPosVersion) ?? '',
        protocolVersion: prefs.getInt(_kProtocolVersion) ?? kSupportedProtocolVersion,
      ),
      deviceId: deviceId,
      deviceToken: token,
      deviceName: prefs.getString(_kDeviceName) ?? 'Tablet',
    );
  }

  /// Lưu lại ngay sau khi ghép nối thành công, để lần mở app sau không phải
  /// dò mạng và nhập lại mã 6 số.
  Future<void> save({
    required LanServerInfo server,
    required String deviceId,
    required String deviceToken,
    required String deviceName,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kHost, server.host);
    await prefs.setInt(_kPort, server.port);
    await prefs.setString(_kStoreName, server.storeName);
    await prefs.setString(_kStoreCode, server.storeCode);
    await prefs.setString(_kPosVersion, server.posVersion);
    await prefs.setInt(_kProtocolVersion, server.protocolVersion);
    await prefs.setString(_kDeviceId, deviceId);
    await prefs.setString(_kDeviceToken, deviceToken);
    await prefs.setString(_kDeviceName, deviceName);
  }

  /// Nhân viên bấm "Ghép nối lại" (đổi máy POS, hoặc thu ngân thu hồi token).
  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await Future.wait([
      prefs.remove(_kHost),
      prefs.remove(_kPort),
      prefs.remove(_kStoreName),
      prefs.remove(_kStoreCode),
      prefs.remove(_kPosVersion),
      prefs.remove(_kProtocolVersion),
      prefs.remove(_kDeviceId),
      prefs.remove(_kDeviceToken),
      prefs.remove(_kDeviceName),
    ]);
  }
}
