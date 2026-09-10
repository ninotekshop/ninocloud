// =====================================================================
//  NINOTEK NinoOrder — Chủ đề giao diện
// =====================================================================
//  Màu và kích thước lấy từ packages/nino_ui_kit/lib/nino_tokens.dart,
//  vốn được sinh tự động từ packages/design-tokens/tokens.json.
//  KHÔNG hard-code mã màu HEX ở đây.
// =====================================================================

import 'package:flutter/material.dart';

/// Bản sao cục bộ của design token. Trong monorepo thật, file này import
/// từ package `nino_ui_kit`. Giữ ở đây để app chạy độc lập được khi cần.
abstract final class NinoTokens {
  static const Color brandPrimary = Color(0xFF007AFF);
  static const Color brandPrimaryDark = Color(0xFF0055FF);
  static const Color brandPrimaryPressed = Color(0xFF0062CC);
  static const Color semanticSuccess = Color(0xFF34C759);
  static const Color semanticWarning = Color(0xFFFF9500);
  static const Color semanticDanger = Color(0xFFFF3B30);
  static const Color surfaceBackground = Color(0xFFF2F2F7);
  static const Color surfaceCard = Color(0xFFFFFFFF);
  static const Color surfaceDivider = Color(0xFFE5E5EA);
  static const Color textPrimary = Color(0xFF1C1C1E);
  static const Color textSecondary = Color(0xFF6E6E73);
  static const Color textTertiary = Color(0xFFAEAEB2);
  static const Color textOnPrimary = Color(0xFFFFFFFF);

  /// Ràng buộc BẮT BUỘC theo Master SRS: mọi phần tử bấm được >= 48x48 dp.
  static const double touchTargetMinimum = 48.0;
  static const double touchTargetComfortable = 56.0;
  static const double touchTargetLarge = 72.0;

  static const double spaceXS = 4.0;
  static const double spaceSM = 8.0;
  static const double spaceMD = 12.0;
  static const double spaceLG = 16.0;
  static const double spaceXL = 24.0;

  static const double radiusMD = 10.0;
  static const double radiusLG = 16.0;

  static const double fontSizeBody = 16.0;
  static const double fontSizeH3 = 18.0;
  static const double fontSizeH2 = 22.0;
  static const double fontSizeCaption = 13.0;

  /// Nhịp thử kết nối lại — Master SRS quy định 3 giây.
  static const int lanReconnectIntervalMs = 3000;

  /// Ngưỡng độ trễ LAN NinoOrder → NinoPOS. Vượt ngưỡng này thì hiển thị
  /// cảnh báo màu vàng thay vì xanh, dù kết nối vẫn còn sống.
  static const int lanTimeoutMs = 500;

  static const Map<String, Color> tableStatusColors = <String, Color>{
    'EMPTY': semanticSuccess,
    'OCCUPIED': brandPrimary,
    'RESERVED': semanticWarning,
    'BILLING': semanticDanger,
    'LOCKED': textTertiary,
  };

  static const Map<String, String> tableStatusLabels = <String, String>{
    'EMPTY': 'Trống',
    'OCCUPIED': 'Có khách',
    'RESERVED': 'Đã đặt',
    'BILLING': 'Chờ thanh toán',
    'LOCKED': 'Đang thao tác',
  };
}

ThemeData buildNinoTheme() {
  final base = ThemeData.light(useMaterial3: true);
  return base.copyWith(
    scaffoldBackgroundColor: NinoTokens.surfaceBackground,
    colorScheme: base.colorScheme.copyWith(
      primary: NinoTokens.brandPrimary,
      error: NinoTokens.semanticDanger,
      surface: NinoTokens.surfaceCard,
    ),
    // Mọi nút đều đạt tối thiểu 48dp. Nhân viên bưng khay bằng một tay,
    // ngón kia bấm — nút nhỏ là bấm nhầm món.
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        minimumSize: const Size(NinoTokens.touchTargetMinimum,
                                NinoTokens.touchTargetComfortable),
        backgroundColor: NinoTokens.brandPrimary,
        foregroundColor: NinoTokens.textOnPrimary,
        textStyle: const TextStyle(
            fontSize: NinoTokens.fontSizeBody, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(NinoTokens.radiusMD)),
      ),
    ),
    cardTheme: CardThemeData(
      color: NinoTokens.surfaceCard,
      elevation: 2,
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(NinoTokens.radiusLG)),
    ),
    textTheme: base.textTheme.apply(
      bodyColor: NinoTokens.textPrimary,
      displayColor: NinoTokens.textPrimary,
      fontFamily: 'Inter',
    ),
  );
}
