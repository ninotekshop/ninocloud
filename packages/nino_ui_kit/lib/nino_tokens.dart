// FILE NÀY ĐƯỢC SINH TỰ ĐỘNG — KHÔNG SỬA TAY.
// Nguồn: packages/design-tokens/tokens.json
// Sinh lại: node tools/scripts/gen-tokens.js

// ignore_for_file: constant_identifier_names

import 'package:flutter/widgets.dart';

/// Design tokens của Ninotek, dùng chung cho NinoOrder và NinoDash.
abstract final class NinoTokens {

  // --- brand ---
  /// Ninotek Blue — nút chính, tab đang chọn
  static const Color brandPrimary = Color(0xFF007AFF);
  /// Điểm cuối gradient thương hiệu
  static const Color brandPrimaryDark = Color(0xFF0055FF);
  static const Color brandPrimaryLight = Color(0xFF4DA3FF);
  static const Color brandPrimaryPressed = Color(0xFF0062CC);

  // --- semantic ---
  /// Bàn trống / Món đã xong / Thanh toán thành công
  static const Color semanticSuccess = Color(0xFF34C759);
  /// Đang chế biến / Sắp hết nguyên liệu
  static const Color semanticWarning = Color(0xFFFF9500);
  /// Cảnh báo kho / Bàn chờ trả tiền / Huỷ món
  static const Color semanticDanger = Color(0xFFFF3B30);
  static const Color semanticInfo = Color(0xFF5AC8FA);

  // --- surface ---
  /// Nền ứng dụng
  static const Color surfaceBackground = Color(0xFFF2F2F7);
  static const Color surfaceCard = Color(0xFFFFFFFF);
  static const Color surfaceElevated = Color(0xFFFFFFFF);
  static const Color surfaceDivider = Color(0xFFE5E5EA);
  static const Color surfaceOverlay = Color(0x66000000);

  // --- text ---
  static const Color textPrimary = Color(0xFF1C1C1E);
  static const Color textSecondary = Color(0xFF6E6E73);
  static const Color textTertiary = Color(0xFFAEAEB2);
  static const Color textOnPrimary = Color(0xFFFFFFFF);
  static const Color textDisabled = Color(0xFFC7C7CC);

  // --- tableStatus ---
  /// Trống
  static const Color tableStatusEMPTY = Color(0xFF34C759);
  /// Có khách
  static const Color tableStatusOCCUPIED = Color(0xFF007AFF);
  /// Đã đặt
  static const Color tableStatusRESERVED = Color(0xFFFF9500);
  /// Chờ thanh toán
  static const Color tableStatusBILLING = Color(0xFFFF3B30);
  /// Đang bị khoá
  static const Color tableStatusLOCKED = Color(0xFFAEAEB2);

  // --- kitchenStatus ---
  /// Chờ làm
  static const Color kitchenStatusWAITING = Color(0xFFAEAEB2);
  /// Đang chế biến
  static const Color kitchenStatusCOOKING = Color(0xFFFF9500);
  /// Đã xong
  static const Color kitchenStatusREADY = Color(0xFF34C759);
  /// Đã lên bàn
  static const Color kitchenStatusSERVED = Color(0xFF007AFF);
  /// Đã huỷ
  static const Color kitchenStatusCANCELLED = Color(0xFFFF3B30);

  // --- Kích thước chạm (Master SRS: tối thiểu 48x48 dp) ---
  static const double touchTargetMinimum = 48.0;
  static const double touchTargetComfortable = 56.0;
  static const double touchTargetLarge = 72.0;
  static const double touchTargetSpacingBetween = 8.0;

  // --- Khoảng cách ---
  static const double spaceXS = 4.0;
  static const double spaceSM = 8.0;
  static const double spaceMD = 12.0;
  static const double spaceLG = 16.0;
  static const double spaceXL = 24.0;
  static const double spaceXXL = 32.0;
  static const double spaceXXXL = 48.0;

  // --- Bo góc ---
  static const double radiusSm = 6.0;
  static const double radiusMd = 10.0;
  static const double radiusLg = 16.0;
  static const double radiusPill = 999.0;

  // --- Cỡ chữ ---
  static const double fontSizeDisplayLarge = 48.0;
  static const double fontSizeDisplay = 34.0;
  static const double fontSizeH1 = 28.0;
  static const double fontSizeH2 = 22.0;
  static const double fontSizeH3 = 18.0;
  static const double fontSizeBody = 16.0;
  static const double fontSizeBodyStrong = 16.0;
  static const double fontSizeCaption = 13.0;
  static const double fontSizeButton = 16.0;

  // --- Hằng số kết nối (Offline-First) ---
  static const int lanReconnectIntervalMs = 3000;
  static const int lanTimeoutMs = 500;
  static const int cloudSyncIntervalMs = 30000;
  static const int cloudSyncBatchSize = 100;
  static const int tableLockTtlSeconds = 30;
  static const int qrSessionTtlMinutes = 15;

  /// Màu tương ứng với trạng thái bàn trong sơ đồ bàn.
  static const Map<String, Color> tableStatusColors = <String, Color>{
    'EMPTY': Color(0xFF34C759), // Trống
    'OCCUPIED': Color(0xFF007AFF), // Có khách
    'RESERVED': Color(0xFFFF9500), // Đã đặt
    'BILLING': Color(0xFFFF3B30), // Chờ thanh toán
    'LOCKED': Color(0xFFAEAEB2), // Đang bị khoá
  };

  /// Màu tương ứng với trạng thái chế biến món (KDS).
  static const Map<String, Color> kitchenStatusColors = <String, Color>{
    'WAITING': Color(0xFFAEAEB2), // Chờ làm
    'COOKING': Color(0xFFFF9500), // Đang chế biến
    'READY': Color(0xFF34C759), // Đã xong
    'SERVED': Color(0xFF007AFF), // Đã lên bàn
    'CANCELLED': Color(0xFFFF3B30), // Đã huỷ
  };
}
