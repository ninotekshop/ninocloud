import 'dart:math';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme/nino_theme.dart';
import '../../models/dashboard_report.dart';

final _currencyFormat = NumberFormat.currency(locale: 'vi_VN', symbol: 'đ', decimalDigits: 0);

enum DateFilterType { today, yesterday, thisWeek, thisMonth }

class DateFilterBar extends StatelessWidget {
  final DateFilterType selectedFilter;
  final ValueChanged<DateFilterType> onFilterChanged;

  const DateFilterBar({
    super.key,
    required this.selectedFilter,
    required this.onFilterChanged,
  });

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _buildChip(DateFilterType.today, 'Hôm nay'),
          const SizedBox(width: 8),
          _buildChip(DateFilterType.yesterday, 'Hôm qua'),
          const SizedBox(width: 8),
          _buildChip(DateFilterType.thisWeek, 'Tuần này'),
          const SizedBox(width: 8),
          _buildChip(DateFilterType.thisMonth, 'Tháng này'),
        ],
      ),
    );
  }

  Widget _buildChip(DateFilterType type, String label) {
    final isSelected = selectedFilter == type;
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (_) => onFilterChanged(type),
      selectedColor: NinoDashTheme.brandPrimary,
      labelStyle: TextStyle(
        color: isSelected ? Colors.white : NinoDashTheme.textPrimary,
        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
      ),
    );
  }
}

class RevenueHourInteractiveChart extends StatefulWidget {
  final List<RevenueByHour> data;

  const RevenueHourInteractiveChart({super.key, required this.data});

  @override
  State<RevenueHourInteractiveChart> createState() => _RevenueHourInteractiveChartState();
}

class _RevenueHourInteractiveChartState extends State<RevenueHourInteractiveChart> {
  int? _hoveredIndex;

  @override
  Widget build(BuildContext context) {
    if (widget.data.isEmpty) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(20),
          child: Center(child: Text('Chưa có dữ liệu biểu đồ')),
        ),
      );
    }

    // Find peak hour
    RevenueByHour peakItem = widget.data.first;
    for (var item in widget.data) {
      if (item.revenue > peakItem.revenue) {
        peakItem = item;
      }
    }

    final hoveredItem = (_hoveredIndex != null && _hoveredIndex! < widget.data.length)
        ? widget.data[_hoveredIndex!]
        : null;

    return Card(
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
                    Icon(Icons.show_chart, color: NinoDashTheme.brandPrimary, size: 20),
                    SizedBox(width: 8),
                    Text(
                      'Biểu đồ Doanh thu theo giờ',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: NinoDashTheme.brandPrimary.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    'Đỉnh: ${peakItem.hour}h (${_currencyFormat.format(peakItem.revenue)})',
                    style: const TextStyle(
                      color: NinoDashTheme.brandPrimary,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Hover tooltip banner
            if (hoveredItem != null)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: NinoDashTheme.brandPrimary.withOpacity(0.08),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: NinoDashTheme.brandPrimary.withOpacity(0.3)),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Khung giờ ${hoveredItem.hour}:00 - ${hoveredItem.hour + 1}:00',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                    ),
                    Text(
                      '${_currencyFormat.format(hoveredItem.revenue)} (${hoveredItem.orderCount} đơn)',
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        color: NinoDashTheme.brandPrimary,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              )
            else
              const Text(
                'Chạm/Chạm giữ vào các điểm trên biểu đồ để xem chi tiết',
                style: TextStyle(color: NinoDashTheme.textTertiary, fontSize: 12),
              ),
            const SizedBox(height: 16),

            // Interactive Line Canvas
            SizedBox(
              height: 180,
              width: double.infinity,
              child: GestureDetector(
                onPanUpdate: (details) => _updateHoverIndex(details.localPosition.dx),
                onTapDown: (details) => _updateHoverIndex(details.localPosition.dx),
                child: CustomPaint(
                  painter: _ChartLinePainter(
                    data: widget.data,
                    selectedIndex: _hoveredIndex,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _updateHoverIndex(double xPos) {
    final RenderBox renderBox = context.findRenderObject() as RenderBox;
    final width = renderBox.size.width - 32;
    if (width <= 0) return;

    final count = widget.data.length;
    final step = width / (count - 1);
    int idx = (xPos / step).round().clamp(0, count - 1);

    setState(() {
      _hoveredIndex = idx;
    });
  }
}

class _ChartLinePainter extends CustomPainter {
  final List<RevenueByHour> data;
  final int? selectedIndex;

  _ChartLinePainter({required this.data, this.selectedIndex});

  @override
  void paint(Canvas canvas, Size size) {
    if (data.isEmpty) return;

    final maxRevenue = data.map((e) => e.revenue).reduce(max);
    final effectiveMax = maxRevenue > 0 ? maxRevenue : 1.0;

    final double width = size.width;
    final double height = size.height - 30; // leave bottom space for x labels

    final double xStep = width / (data.length - 1);

    final points = <Offset>[];
    for (int i = 0; i < data.length; i++) {
      final x = i * xStep;
      final y = height - (data[i].revenue / effectiveMax) * height + 10;
      points.add(Offset(x, y));
    }

    // Draw gradient area below line
    final path = Path();
    path.moveTo(0, height + 10);
    for (var p in points) {
      path.lineTo(p.dx, p.dy);
    }
    path.lineTo(width, height + 10);
    path.close();

    final fillGradient = LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: [
        NinoDashTheme.brandPrimary.withOpacity(0.35),
        NinoDashTheme.brandPrimary.withOpacity(0.0),
      ],
    );

    final fillPaint = Paint()
      ..shader = fillGradient.createShader(Rect.fromLTWH(0, 0, width, height))
      ..style = PaintingStyle.fill;

    canvas.drawPath(path, fillPaint);

    // Draw grid lines
    final gridPaint = Paint()
      ..color = NinoDashTheme.divider
      ..strokeWidth = 1;

    canvas.drawLine(Offset(0, height + 10), Offset(width, height + 10), gridPaint);

    // Draw line
    final linePaint = Paint()
      ..color = NinoDashTheme.brandPrimary
      ..strokeWidth = 3.0
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    final linePath = Path();
    linePath.moveTo(points.first.dx, points.first.dy);
    for (int i = 1; i < points.length; i++) {
      linePath.lineTo(points[i].dx, points[i].dy);
    }
    canvas.drawPath(linePath, linePaint);

    // Draw points & XLabels
    final textPainter = TextPainter(textDirection: ui.TextDirection.ltr);

    for (int i = 0; i < data.length; i++) {
      final pt = points[i];
      final isSelected = selectedIndex == i;

      // Draw point circle
      final pointPaint = Paint()
        ..color = isSelected ? Colors.white : NinoDashTheme.brandPrimary
        ..style = PaintingStyle.fill;

      final borderPaint = Paint()
        ..color = NinoDashTheme.brandPrimary
        ..strokeWidth = isSelected ? 3 : 2
        ..style = PaintingStyle.stroke;

      canvas.drawCircle(pt, isSelected ? 6.0 : 4.0, pointPaint);
      canvas.drawCircle(pt, isSelected ? 6.0 : 4.0, borderPaint);

      // Draw vertical line if selected
      if (isSelected) {
        final guidePaint = Paint()
          ..color = NinoDashTheme.brandPrimary.withOpacity(0.5)
          ..strokeWidth = 1.5;
        canvas.drawLine(Offset(pt.dx, 0), Offset(pt.dx, height + 10), guidePaint);
      }

      // Draw Hour Label
      textPainter.text = TextSpan(
        text: '${data[i].hour}h',
        style: TextStyle(
          color: isSelected ? NinoDashTheme.brandPrimary : NinoDashTheme.textSecondary,
          fontSize: 10,
          fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
        ),
      );
      textPainter.layout();
      textPainter.paint(canvas, Offset(pt.dx - textPainter.width / 2, height + 14));
    }
  }

  @override
  bool shouldRepaint(covariant _ChartLinePainter oldDelegate) {
    return oldDelegate.selectedIndex != selectedIndex || oldDelegate.data != data;
  }
}

class TopSellingBarChart extends StatelessWidget {
  final List<TopSellingItem> items;

  const TopSellingBarChart({super.key, required this.items});

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox();

    final maxRevenue = items.map((e) => e.revenue).reduce(max);
    final effectiveMax = maxRevenue > 0 ? maxRevenue : 1.0;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.emoji_events, color: NinoDashTheme.warning, size: 20),
                SizedBox(width: 8),
                Text(
                  'Top 5 Món Bán Chạy Nhất',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
              ],
            ),
            const SizedBox(height: 16),
            ...items.asMap().entries.map((entry) {
              final rank = entry.key + 1;
              final item = entry.value;
              final ratio = (item.revenue / effectiveMax).clamp(0.0, 1.0);

              return Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 20,
                          height: 20,
                          decoration: BoxDecoration(
                            color: rank == 1
                                ? NinoDashTheme.warning
                                : rank == 2
                                    ? Colors.grey.shade400
                                    : rank == 3
                                        ? Colors.brown.shade300
                                        : NinoDashTheme.divider,
                            shape: BoxShape.circle,
                          ),
                          child: Center(
                            child: Text(
                              '$rank',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: rank <= 3 ? Colors.white : NinoDashTheme.textPrimary,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            item.itemName,
                            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                          ),
                        ),
                        Text(
                          '${item.quantity.toInt()} món',
                          style: const TextStyle(fontSize: 12, color: NinoDashTheme.textSecondary),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          _currencyFormat.format(item.revenue),
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
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
                        valueColor: const AlwaysStoppedAnimation<Color>(NinoDashTheme.brandPrimary),
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
}
