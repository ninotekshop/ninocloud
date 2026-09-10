import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/nino_theme.dart';
import '../../../models/dashboard_report.dart';

final _currencyFormat = NumberFormat.currency(locale: 'vi_VN', symbol: 'đ', decimalDigits: 0);

class KpiGrid extends StatelessWidget {
  final DashboardReport report;

  const KpiGrid({super.key, required this.report});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Main net revenue card
        Card(
          color: NinoDashTheme.brandPrimary,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'DOANH THU RÒNG HÔM NAY',
                      style: TextStyle(
                        color: Colors.white70,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 0.5,
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Row(
                        children: [
                          Icon(
                            report.revenueChangePercent >= 0
                                ? Icons.trending_up
                                : Icons.trending_down,
                            color: Colors.white,
                            size: 16,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            '${report.revenueChangePercent >= 0 ? '+' : ''}${report.revenueChangePercent.toStringAsFixed(1)}%',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  _currencyFormat.format(report.netRevenue),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 32,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 12),
                const Divider(color: Colors.white24, height: 1),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _whiteSubText('Tổng gộp: ${_currencyFormat.format(report.grossRevenue)}'),
                    _whiteSubText('Giảm giá: ${_currencyFormat.format(report.totalDiscount)}'),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),

        // Grid 4 secondary KPI cards
        LayoutBuilder(
          builder: (context, constraints) {
            final cardWidth = (constraints.maxWidth - 12) / 2;
            return Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                SizedBox(
                  width: cardWidth,
                  child: _MiniKpiCard(
                    title: 'Số đơn hàng',
                    value: '${report.totalOrders} đơn',
                    icon: Icons.receipt_long,
                    iconColor: NinoDashTheme.brandPrimary,
                  ),
                ),
                SizedBox(
                  width: cardWidth,
                  child: _MiniKpiCard(
                    title: 'Số lượng khách',
                    value: '${report.totalGuests} khách',
                    icon: Icons.people_alt,
                    iconColor: NinoDashTheme.info,
                  ),
                ),
                SizedBox(
                  width: cardWidth,
                  child: _MiniKpiCard(
                    title: 'Trung bình / Đơn (AOV)',
                    value: _currencyFormat.format(report.avgOrderValue),
                    icon: Icons.analytics,
                    iconColor: NinoDashTheme.success,
                  ),
                ),
                SizedBox(
                  width: cardWidth,
                  child: _MiniKpiCard(
                    title: 'Công suất sử dụng bàn',
                    value: '${report.tableOccupancyPercent.toStringAsFixed(0)}%',
                    icon: Icons.table_bar,
                    iconColor: NinoDashTheme.warning,
                  ),
                ),
              ],
            );
          },
        ),
        const SizedBox(height: 20),

        // Payment Breakdown Card
        PaymentBreakdownWidget(items: report.paymentBreakdown, totalRevenue: report.netRevenue),
      ],
    );
  }

  Widget _whiteSubText(String text) {
    return Text(
      text,
      style: const TextStyle(color: Color(0xE6FFFFFF), fontSize: 13),
    );
  }
}

class _MiniKpiCard extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color iconColor;

  const _MiniKpiCard({
    required this.title,
    required this.value,
    required this.icon,
    required this.iconColor,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(
                      color: NinoDashTheme.textSecondary,
                      fontSize: 12,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: iconColor.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(icon, color: iconColor, size: 18),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              value,
              style: const TextStyle(
                color: NinoDashTheme.textPrimary,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class PaymentBreakdownWidget extends StatelessWidget {
  final List<PaymentBreakdown> items;
  final double totalRevenue;

  const PaymentBreakdownWidget({
    super.key,
    required this.items,
    required this.totalRevenue,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.pie_chart_outline, color: NinoDashTheme.brandPrimary, size: 20),
                SizedBox(width: 8),
                Text(
                  'Cơ cấu Phương thức Thanh toán',
                  style: TextStyle(
                    color: NinoDashTheme.textPrimary,
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            ...items.map((item) {
              final ratio = totalRevenue > 0 ? (item.amount / totalRevenue).clamp(0.0, 1.0) : 0.0;
              final percentText = (ratio * 100).toStringAsFixed(1);
              return Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          '${item.label} (${item.count} đơn)',
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        Text(
                          '${_currencyFormat.format(item.amount)} ($percentText%)',
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: LinearProgressIndicator(
                        value: ratio,
                        minHeight: 8,
                        backgroundColor: NinoDashTheme.divider,
                        valueColor: AlwaysStoppedAnimation<Color>(_getMethodColor(item.method)),
                      ),
                    ),
                  ],
                ),
              );
            }),
          ],
        ),
      ),
    );
  }

  Color _getMethodColor(String method) {
    switch (method.toUpperCase()) {
      case 'VIETQR':
        return NinoDashTheme.brandPrimary;
      case 'CASH':
        return NinoDashTheme.success;
      case 'CARD':
        return NinoDashTheme.warning;
      default:
        return NinoDashTheme.info;
    }
  }
}
