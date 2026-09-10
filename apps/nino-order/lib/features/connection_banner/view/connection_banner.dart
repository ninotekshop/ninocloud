// =====================================================================
//  NINOTEK NinoOrder — Banner cảnh báo mất kết nối
// =====================================================================
//  Master SRS: khi mất LAN, hiện thông báo "Đang mất kết nối với trạm thu
//  ngân" và tự thử kết nối lại mỗi 3 giây.
//
//  Nguyên tắc thiết kế: banner KHÔNG chặn thao tác. Nhân viên vẫn phải gọi
//  món được — đơn vào hàng đợi offline và tự gửi khi có mạng lại. Chặn màn
//  hình lúc mất mạng nghĩa là quán ngừng bán hàng, đúng thứ mà kiến trúc
//  Offline-First sinh ra để tránh.
// =====================================================================

import 'package:flutter/material.dart';

import '../../../core/network/connection_manager.dart';
import '../../../core/offline/offline_queue.dart';
import '../../../core/theme/nino_theme.dart';

class ConnectionBanner extends StatelessWidget {
  const ConnectionBanner({
    super.key,
    required this.connection,
    required this.queue,
  });

  final LanConnectionState connection;
  final QueueState? queue;

  @override
  Widget build(BuildContext context) {
    final pending = queue?.pendingCount ?? 0;

    // Đã kết nối lại và hàng đợi đã trống — không còn gì để báo.
    if (!connection.shouldShowBanner && pending == 0) {
      return const SizedBox.shrink();
    }

    // Có mạng lại nhưng còn đơn đang đẩy: banner xanh, mang tin tốt.
    if (!connection.shouldShowBanner && pending > 0) {
      return _Bar(
        color: NinoTokens.semanticSuccess,
        icon: Icons.cloud_upload_outlined,
        title: 'Đã kết nối lại — đang gửi $pending đơn chờ',
        showSpinner: true,
      );
    }

    return _Bar(
      color: NinoTokens.semanticDanger,
      icon: Icons.wifi_off_rounded,
      title: 'Đang mất kết nối với trạm thu ngân',
      subtitle: pending > 0
          ? '$pending đơn đã lưu trên máy, sẽ tự gửi khi có mạng lại'
          : 'Đang thử kết nối lại mỗi 3 giây (lần ${connection.attempts})',
      showSpinner: true,
    );
  }
}

/// Chỉ báo gọn hiển thị THƯỜNG TRỰC trên AppBar: chấm màu + trạng thái kết
/// nối + độ trễ (ms) tới máy NinoPOS. Khác với [ConnectionBanner] (chỉ hiện
/// khi có sự cố), widget này giúp nhân viên và người giám sát luôn biết
/// chất lượng đường truyền LAN ngay cả khi mọi thứ đang chạy tốt.
class ConnectionStatusChip extends StatelessWidget {
  const ConnectionStatusChip({super.key, required this.connection});

  final LanConnectionState connection;

  @override
  Widget build(BuildContext context) {
    final (color, label) = switch (connection.status) {
      ConnectionStatus.connected => (
          _latencyColor(connection.latencyMs),
          connection.latencyMs != null
              ? '${connection.latencyMs} ms'
              : 'Đã kết nối',
        ),
      ConnectionStatus.reconnecting => (NinoTokens.semanticDanger, 'Mất kết nối'),
      ConnectionStatus.connecting => (NinoTokens.semanticWarning, 'Đang dò...'),
      ConnectionStatus.disconnected => (NinoTokens.textTertiary, 'Chưa ghép nối'),
    };

    return Semantics(
      label: 'Trạng thái kết nối trạm thu ngân: $label',
      child: Container(
        margin: const EdgeInsets.only(right: NinoTokens.spaceMD),
        padding: const EdgeInsets.symmetric(
            horizontal: NinoTokens.spaceSM, vertical: 4),
        decoration: BoxDecoration(
          color: Colors.black.withOpacity(0.16),
          borderRadius: BorderRadius.circular(NinoTokens.radiusMD),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: NinoTokens.spaceXS),
            Text(
              label,
              style: const TextStyle(
                color: NinoTokens.textOnPrimary,
                fontSize: NinoTokens.fontSizeCaption,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Xanh trong ngưỡng LAN (< 500ms theo tokens.json), vàng nếu vượt —
  /// vẫn kết nối được nhưng nhân viên nên biết Wi-Fi đang yếu.
  static Color _latencyColor(int? ms) {
    if (ms == null) return NinoTokens.semanticSuccess;
    return ms <= NinoTokens.lanTimeoutMs
        ? NinoTokens.semanticSuccess
        : NinoTokens.semanticWarning;
  }
}

class _Bar extends StatelessWidget {
  const _Bar({
    required this.color,
    required this.icon,
    required this.title,
    this.subtitle,
    this.showSpinner = false,
  });

  final Color color;
  final IconData icon;
  final String title;
  final String? subtitle;
  final bool showSpinner;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: NinoTokens.spaceLG, vertical: NinoTokens.spaceMD),
          child: Row(
            children: [
              Icon(icon, color: NinoTokens.textOnPrimary, size: 22),
              const SizedBox(width: NinoTokens.spaceMD),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(title,
                        style: const TextStyle(
                          color: NinoTokens.textOnPrimary,
                          fontSize: NinoTokens.fontSizeBody,
                          fontWeight: FontWeight.w600,
                        )),
                    if (subtitle != null) ...[
                      const SizedBox(height: 2),
                      Text(subtitle!,
                          style: const TextStyle(
                            color: NinoTokens.textOnPrimary,
                            fontSize: NinoTokens.fontSizeCaption,
                          )),
                    ],
                  ],
                ),
              ),
              if (showSpinner)
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: NinoTokens.textOnPrimary),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
