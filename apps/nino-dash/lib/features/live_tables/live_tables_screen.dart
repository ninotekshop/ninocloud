import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme/nino_theme.dart';
import '../../models/live_table.dart';

final _currencyFormat = NumberFormat.currency(locale: 'vi_VN', symbol: 'đ', decimalDigits: 0);

class LiveTablesScreen extends StatefulWidget {
  final List<LiveTable> tables;
  final VoidCallback onRefresh;

  const LiveTablesScreen({
    super.key,
    required this.tables,
    required this.onRefresh,
  });

  @override
  State<LiveTablesScreen> createState() => _LiveTablesScreenState();
}

class _LiveTablesScreenState extends State<LiveTablesScreen> {
  String _selectedFilter = 'ACTIVE'; // 'ALL', 'ACTIVE', 'EMPTY'

  @override
  Widget build(BuildContext context) {
    final activeTables = widget.tables.where((t) => t.status == 'OCCUPIED' || t.status == 'BILLING').toList();
    final totalRunningRevenue = activeTables.fold<double>(0.0, (sum, t) => sum + t.runningTotal);
    final totalGuestsServing = activeTables.fold<int>(0, (sum, t) => sum + t.guestCount);

    List<LiveTable> filteredTables;
    if (_selectedFilter == 'ACTIVE') {
      filteredTables = activeTables;
    } else if (_selectedFilter == 'EMPTY') {
      filteredTables = widget.tables.where((t) => t.status == 'EMPTY').toList();
    } else {
      filteredTables = widget.tables;
    }

    return RefreshIndicator(
      onRefresh: () async => widget.onRefresh(),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Live status summary header
          Card(
            color: Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: const BorderSide(color: NinoDashTheme.brandPrimary, width: 1.5),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: NinoDashTheme.brandPrimary.withOpacity(0.1),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.storefront, color: NinoDashTheme.brandPrimary, size: 28),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              width: 8,
                              height: 8,
                              decoration: const BoxDecoration(
                                color: NinoDashTheme.success,
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 6),
                            const Text(
                              'ĐANG MỞ BÁN REAL-TIME',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: NinoDashTheme.textSecondary,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${activeTables.length} bàn đang có khách ($totalGuestsServing người)',
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: NinoDashTheme.textPrimary,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Tạm tính: ${_currencyFormat.format(totalRunningRevenue)}',
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: NinoDashTheme.brandPrimary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Filter tabs
          Row(
            children: [
              _buildFilterChip('ACTIVE', 'Đang mở bán (${activeTables.length})'),
              const SizedBox(width: 8),
              _buildFilterChip('ALL', 'Tất cả (${widget.tables.length})'),
              const SizedBox(width: 8),
              _buildFilterChip('EMPTY', 'Trống (${widget.tables.length - activeTables.length})'),
            ],
          ),
          const SizedBox(height: 16),

          // Grid of tables
          if (filteredTables.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 40),
              child: Center(
                child: Text(
                  'Không có bàn nào phù hợp bộ lọc',
                  style: TextStyle(color: NinoDashTheme.textSecondary),
                ),
              ),
            )
          else
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                childAspectRatio: 1.1,
              ),
              itemCount: filteredTables.length,
              itemBuilder: (context, index) {
                final table = filteredTables[index];
                final statusColor = NinoDashTheme.getTableStatusColor(table.status);
                final statusLabel = NinoDashTheme.getTableStatusLabel(table.status);

                return InkWell(
                  onTap: () => _showTableDetails(context, table),
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    decoration: BoxDecoration(
                      color: NinoDashTheme.card,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: statusColor.withOpacity(0.5), width: 1.5),
                      boxShadow: [
                        BoxShadow(
                          color: statusColor.withOpacity(0.08),
                          blurRadius: 6,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Text(
                                table.tableName,
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 16,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: statusColor.withOpacity(0.12),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(
                                statusLabel,
                                style: TextStyle(
                                  color: statusColor,
                                  fontSize: 11,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                          ],
                        ),
                        Text(
                          table.zoneName,
                          style: const TextStyle(
                            color: NinoDashTheme.textSecondary,
                            fontSize: 12,
                          ),
                        ),
                        const Divider(height: 12),
                        if (table.status == 'OCCUPIED' || table.status == 'BILLING') ...[
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Row(
                                children: [
                                  const Icon(Icons.people_outline, size: 14, color: NinoDashTheme.textSecondary),
                                  const SizedBox(width: 4),
                                  Text('${table.guestCount} người', style: const TextStyle(fontSize: 12)),
                                ],
                              ),
                              if (table.occupiedDurationText.isNotEmpty)
                                Row(
                                  children: [
                                    const Icon(Icons.access_time, size: 14, color: NinoDashTheme.textSecondary),
                                    const SizedBox(width: 4),
                                    Text(table.occupiedDurationText, style: const TextStyle(fontSize: 12)),
                                  ],
                                ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _currencyFormat.format(table.runningTotal),
                            style: const TextStyle(
                              color: NinoDashTheme.brandPrimary,
                              fontWeight: FontWeight.bold,
                              fontSize: 15,
                            ),
                          ),
                        ] else
                          const Text(
                            'Sẵn sàng đón khách',
                            style: TextStyle(
                              color: NinoDashTheme.textTertiary,
                              fontSize: 12,
                              fontStyle: FontStyle.italic,
                            ),
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String key, String label) {
    final isSelected = _selectedFilter == key;
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (_) {
        setState(() {
          _selectedFilter = key;
        });
      },
      selectedColor: NinoDashTheme.brandPrimary.withOpacity(0.15),
      labelStyle: TextStyle(
        color: isSelected ? NinoDashTheme.brandPrimary : NinoDashTheme.textSecondary,
        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
        fontSize: 13,
      ),
    );
  }

  void _showTableDetails(BuildContext context, LiveTable table) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${table.tableName} (${table.zoneName})',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                      ),
                      if (table.openedAt != null)
                        Text(
                          'Mở bàn lúc: ${DateFormat('HH:mm').format(table.openedAt!)} (${table.occupiedDurationText})',
                          style: const TextStyle(color: NinoDashTheme.textSecondary, fontSize: 13),
                        ),
                    ],
                  ),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
              const Divider(height: 20),
              if (table.items.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 20),
                  child: Center(child: Text('Bàn trống / Chưa có món gọi')),
                )
              else ...[
                const Text('Danh sách món gọi:', style: TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Flexible(
                  child: ListView.builder(
                    shrinkWrap: true,
                    itemCount: table.items.length,
                    itemBuilder: (context, idx) {
                      final item = table.items[idx];
                      return ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        title: Text('${item.name} x${item.quantity.toInt()}'),
                        trailing: Text(
                          _currencyFormat.format(item.totalPrice),
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                      );
                    },
                  ),
                ),
                const Divider(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('TỔNG TẠM TÍNH:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    Text(
                      _currencyFormat.format(table.runningTotal),
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 18,
                        color: NinoDashTheme.brandPrimary,
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}
