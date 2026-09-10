import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme/nino_theme.dart';
import '../../models/dashboard_report.dart';

final _currencyFormat = NumberFormat.currency(locale: 'vi_VN', symbol: 'đ', decimalDigits: 0);

class InventoryAlertScreen extends StatelessWidget {
  final List<LowStockAlert> stockAlerts;
  final List<SuspiciousActivity> suspiciousActivities;
  final VoidCallback onRefresh;

  const InventoryAlertScreen({
    super.key,
    required this.stockAlerts,
    required this.suspiciousActivities,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async => onRefresh(),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Section 1: Low Stock & Waste Warnings
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.inventory_2_outlined, color: NinoDashTheme.warning, size: 22),
                          SizedBox(width: 8),
                          Text(
                            'CẢNH BÁO KHO & CẠN NGUYÊN LIỆU',
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.bold,
                              color: NinoDashTheme.textPrimary,
                            ),
                          ),
                        ],
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: NinoDashTheme.warning.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          '${stockAlerts.length} món',
                          style: const TextStyle(
                            color: NinoDashTheme.warning,
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Nguyên vật liệu bên dưới đã giảm sâu dưới ngưỡng tối thiểu. Cần nhập kho gấp để tránh gián đoạn pha chế/chế biến.',
                    style: TextStyle(color: NinoDashTheme.textSecondary, fontSize: 12),
                  ),
                  const Divider(height: 24),
                  if (stockAlerts.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 20),
                      child: Center(
                        child: Text(
                          '✅ Kho ổn định, chưa có cảnh báo cạn nguyên liệu',
                          style: TextStyle(color: NinoDashTheme.success, fontWeight: FontWeight.w600),
                        ),
                      ),
                    )
                  else
                    ...stockAlerts.map((item) {
                      final isCritical = item.percentLeft < 0.3;
                      return Container(
                        margin: const EdgeInsets.only(bottom: 12),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: isCritical
                              ? NinoDashTheme.danger.withOpacity(0.05)
                              : NinoDashTheme.warning.withOpacity(0.05),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(
                            color: isCritical
                                ? NinoDashTheme.danger.withOpacity(0.3)
                                : NinoDashTheme.warning.withOpacity(0.3),
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  item.name,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 14,
                                  ),
                                ),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: isCritical ? NinoDashTheme.danger : NinoDashTheme.warning,
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    isCritical ? 'CRITICAL' : 'CẢNH BÁO',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 10,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  'Tồn hiện tại: ${item.stockQuantity} ${item.unit}',
                                  style: TextStyle(
                                    color: isCritical ? NinoDashTheme.danger : NinoDashTheme.warning,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13,
                                  ),
                                ),
                                Text(
                                  'Ngưỡng cảnh báo: ${item.minStockAlert} ${item.unit}',
                                  style: const TextStyle(
                                    color: NinoDashTheme.textSecondary,
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            ClipRRect(
                              borderRadius: BorderRadius.circular(4),
                              child: LinearProgressIndicator(
                                value: item.percentLeft,
                                minHeight: 6,
                                backgroundColor: NinoDashTheme.divider,
                                valueColor: AlwaysStoppedAnimation<Color>(
                                  isCritical ? NinoDashTheme.danger : NinoDashTheme.warning,
                                ),
                              ),
                            ),
                          ],
                        ),
                      );
                    }),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),

          // Section 2: Suspicious Shift Audit & Loss Prevention
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Row(
                        children: [
                          Icon(Icons.gavel, color: NinoDashTheme.danger, size: 22),
                          SizedBox(width: 8),
                          Text(
                            'GIÁM SÁT THẤT THOÁT & NGHI VẤN',
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.bold,
                              color: NinoDashTheme.textPrimary,
                            ),
                          ),
                        ],
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: NinoDashTheme.danger.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          '${suspiciousActivities.length} sự kiện',
                          style: const TextStyle(
                            color: NinoDashTheme.danger,
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Phát hiện các thao tác huỷ món, giảm giá hoặc sửa bill vượt ngưỡng quy định của nhân viên trong ca.',
                    style: TextStyle(color: NinoDashTheme.textSecondary, fontSize: 12),
                  ),
                  const Divider(height: 24),
                  if (suspiciousActivities.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 20),
                      child: Center(
                        child: Text(
                          '✅ Chưa phát hiện thao tác nghi vấn trong ca',
                          style: TextStyle(color: NinoDashTheme.success, fontWeight: FontWeight.w600),
                        ),
                      ),
                    )
                  else
                    ...suspiciousActivities.map((act) {
                      return Container(
                        margin: const EdgeInsets.only(bottom: 12),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: NinoDashTheme.danger.withOpacity(0.04),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: NinoDashTheme.danger.withOpacity(0.2)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Row(
                                  children: [
                                    const Icon(Icons.warning_amber, color: NinoDashTheme.danger, size: 18),
                                    const SizedBox(width: 6),
                                    Text(
                                      act.actionLabel,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.bold,
                                        fontSize: 14,
                                        color: NinoDashTheme.danger,
                                      ),
                                    ),
                                  ],
                                ),
                                Text(
                                  'Ca: ${act.shiftId}',
                                  style: const TextStyle(
                                    fontSize: 11,
                                    color: NinoDashTheme.textSecondary,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'Nhân viên: ${act.userName}',
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                                fontSize: 13,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Mô tả: ${act.thresholdExceeded}',
                              style: const TextStyle(fontSize: 12),
                            ),
                            const SizedBox(height: 6),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  'Số lần: ${act.count} lần',
                                  style: const TextStyle(
                                    color: NinoDashTheme.textSecondary,
                                    fontSize: 12,
                                  ),
                                ),
                                Text(
                                  'Tổng giá trị: ${_currencyFormat.format(act.totalAmount)}',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13,
                                    color: NinoDashTheme.danger,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      );
                    }),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
