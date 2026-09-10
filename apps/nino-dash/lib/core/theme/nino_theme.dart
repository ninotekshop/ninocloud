import 'package:flutter/material.dart';

/// Design tokens & Theme cho NinoDash
abstract class NinoDashTheme {
  // Brand colors
  static const Color brandPrimary = Color(0xFF007AFF);
  static const Color brandPrimaryDark = Color(0xFF0055FF);
  static const Color brandPrimaryLight = Color(0xFF4DA3FF);

  // Semantic
  static const Color success = Color(0xFF34C759);
  static const Color warning = Color(0xFFFF9500);
  static const Color danger = Color(0xFFFF3B30);
  static const Color info = Color(0xFF5AC8FA);

  // Surface
  static const Color background = Color(0xFFF2F2F7);
  static const Color card = Color(0xFFFFFFFF);
  static const Color divider = Color(0xFFE5E5EA);

  // Text
  static const Color textPrimary = Color(0xFF1C1C1E);
  static const Color textSecondary = Color(0xFF6E6E73);
  static const Color textTertiary = Color(0xFFAEAEB2);

  // Table Status Colors
  static const Color tableEmpty = Color(0xFF34C759);
  static const Color tableOccupied = Color(0xFF007AFF);
  static const Color tableReserved = Color(0xFFFF9500);
  static const Color tableBilling = Color(0xFFFF3B30);
  static const Color tableLocked = Color(0xFFAEAEB2);

  static ThemeData get lightTheme {
    return ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: brandPrimary,
        primary: brandPrimary,
        surface: card,
        error: danger,
      ),
      scaffoldBackgroundColor: background,
      appBarTheme: const AppBarTheme(
        backgroundColor: card,
        foregroundColor: textPrimary,
        elevation: 0,
        scrolledUnderElevation: 1,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: textPrimary,
          fontSize: 18,
          fontWeight: FontWeight.bold,
        ),
      ),
      cardTheme: CardThemeData(
        color: card,
        elevation: 0.5,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: divider, width: 1),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: divider,
        space: 1,
        thickness: 1,
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: card,
        selectedItemColor: brandPrimary,
        unselectedItemColor: textTertiary,
        selectedLabelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
        unselectedLabelStyle: TextStyle(fontSize: 12),
        type: BottomNavigationBarType.fixed,
        elevation: 8,
      ),
    );
  }

  static Color getTableStatusColor(String status) {
    switch (status.toUpperCase()) {
      case 'EMPTY':
        return tableEmpty;
      case 'OCCUPIED':
        return tableOccupied;
      case 'RESERVED':
        return tableReserved;
      case 'BILLING':
        return tableBilling;
      case 'LOCKED':
      default:
        return tableLocked;
    }
  }

  static String getTableStatusLabel(String status) {
    switch (status.toUpperCase()) {
      case 'EMPTY':
        return 'Trống';
      case 'OCCUPIED':
        return 'Có khách';
      case 'RESERVED':
        return 'Đã đặt';
      case 'BILLING':
        return 'Chờ thanh toán';
      case 'LOCKED':
        return 'Đang khóa';
      default:
        return status;
    }
  }
}
