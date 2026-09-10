// =====================================================================
//  NINOTEK NinoOrder — Màn hình sơ đồ bàn
// =====================================================================
//  Màn hình nhân viên nhìn nhiều nhất trong ca. Ưu tiên: liếc một cái là
//  biết bàn nào trống, bàn nào đang có người khác thao tác.
// =====================================================================

import 'package:flutter/material.dart';

import '../../../core/theme/nino_theme.dart';
import '../../../data/models/models.dart';

class TableMapScreen extends StatelessWidget {
  const TableMapScreen({
    super.key,
    required this.tables,
    required this.currentUserId,
    required this.onTableTap,
    required this.onRefresh,
    this.selectedAreaId,
    this.onAreaSelected,
    this.onTransferTable,
    this.areaName,
  });

  final List<TableStatus> tables;
  final String currentUserId;
  final void Function(TableStatus) onTableTap;
  final Future<void> Function() onRefresh;

  /// null nghĩa là "Tất cả khu vực".
  final String? selectedAreaId;
  final void Function(String? areaId)? onAreaSelected;

  /// Nhân viên bấm giữ một bàn đang có khách để chuyển/gộp bàn.
  final void Function(TableStatus)? onTransferTable;

  final String? areaName;

  /// Danh sách khu vực duy nhất rút ra từ sơ đồ bàn, giữ đúng thứ tự xuất
  /// hiện lần đầu — máy POS trả bàn theo thứ tự sắp xếp có chủ ý.
  List<({String id, String name})> get _areas {
    final seen = <String>{};
    final result = <({String id, String name})>[];
    for (final t in tables) {
      if (seen.add(t.areaId)) {
        result.add((id: t.areaId, name: t.areaName ?? 'Khu vực'));
      }
    }
    return result;
  }

  @override
  Widget build(BuildContext context) {
    final visibleTables = selectedAreaId == null
        ? tables
        : tables.where((t) => t.areaId == selectedAreaId).toList();

    return Column(
      children: [
        if (onAreaSelected != null && _areas.length > 1) _buildAreaTabs(),
        Expanded(
          child: RefreshIndicator(
            onRefresh: onRefresh,
            child: GridView.builder(
              padding: const EdgeInsets.all(NinoTokens.spaceLG),
              physics: const AlwaysScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                // Thẻ bàn rộng tối đa 200dp: trên tablet 10 inch ra 4 cột, trên
                // điện thoại ra 2 cột — không cần viết hai bố cục riêng.
                maxCrossAxisExtent: 200,
                childAspectRatio: 1.15,
                crossAxisSpacing: NinoTokens.spaceMD,
                mainAxisSpacing: NinoTokens.spaceMD,
              ),
              itemCount: visibleTables.length,
              itemBuilder: (context, index) => _TableCard(
                table: visibleTables[index],
                currentUserId: currentUserId,
                onTap: onTableTap,
                onLongPress: onTransferTable,
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildAreaTabs() => SizedBox(
        height: NinoTokens.touchTargetComfortable,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(
              horizontal: NinoTokens.spaceLG, vertical: NinoTokens.spaceSM),
          children: [
            Padding(
              padding: const EdgeInsets.only(right: NinoTokens.spaceSM),
              child: ChoiceChip(
                label: const Text('Tất cả'),
                selected: selectedAreaId == null,
                onSelected: (_) => onAreaSelected?.call(null),
              ),
            ),
            for (final area in _areas)
              Padding(
                padding: const EdgeInsets.only(right: NinoTokens.spaceSM),
                child: ChoiceChip(
                  label: Text(area.name),
                  selected: selectedAreaId == area.id,
                  onSelected: (_) => onAreaSelected?.call(area.id),
                ),
              ),
          ],
        ),
      );
}

class _TableCard extends StatelessWidget {
  const _TableCard({
    required this.table,
    required this.currentUserId,
    required this.onTap,
    this.onLongPress,
  });

  final TableStatus table;
  final String currentUserId;
  final void Function(TableStatus) onTap;
  final void Function(TableStatus)? onLongPress;

  @override
  Widget build(BuildContext context) {
    final lockedByOther = table.isLockedByOther(currentUserId);
    final color = lockedByOther
        ? NinoTokens.tableStatusColors['LOCKED']!
        : (NinoTokens.tableStatusColors[table.status] ?? NinoTokens.textTertiary);

    return Semantics(
      button: true,
      label: '${table.name}, ${NinoTokens.tableStatusLabels[table.status] ?? table.status}'
          '${lockedByOther ? ", đang có nhân viên khác thao tác" : ""}',
      child: Material(
        color: NinoTokens.surfaceCard,
        borderRadius: BorderRadius.circular(NinoTokens.radiusLG),
        child: InkWell(
          borderRadius: BorderRadius.circular(NinoTokens.radiusLG),
          // Bàn đang bị người khác giữ thì làm mờ và KHÔNG cho bấm. Để họ bấm
          // rồi mới báo lỗi 409 là bắt nhân viên học bằng cách thất bại.
          onTap: lockedByOther ? null : () => onTap(table),
          // Giữ lâu trên bàn đang có khách (có đơn) để mở "Chuyển / gộp bàn".
          onLongPress: (lockedByOther || table.currentOrderId == null || onLongPress == null)
              ? null
              : () => onLongPress!(table),
          child: Opacity(
            opacity: lockedByOther ? 0.55 : 1.0,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(NinoTokens.radiusLG),
                border: Border.all(color: color, width: 2),
              ),
              padding: const EdgeInsets.all(NinoTokens.spaceMD),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 10, height: 10,
                        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                      ),
                      const SizedBox(width: NinoTokens.spaceSM),
                      Expanded(
                        child: Text(
                          table.name,
                          style: const TextStyle(
                            fontSize: NinoTokens.fontSizeH3,
                            fontWeight: FontWeight.w700,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (!lockedByOther &&
                          onLongPress != null &&
                          table.currentOrderId != null)
                        const Icon(Icons.swap_horiz,
                            size: 16, color: NinoTokens.textTertiary),
                    ],
                  ),
                  const Spacer(),
                  if (lockedByOther)
                    const _Line(icon: Icons.lock_outline, text: 'Nhân viên khác đang thao tác')
                  else if (table.isEmpty)
                    _Line(icon: Icons.event_seat_outlined,
                          text: '${table.seatCapacity} chỗ')
                  else ...[
                    if (table.guestCount != null)
                      _Line(icon: Icons.people_outline, text: '${table.guestCount} khách'),
                    if (table.seatedMinutes != null)
                      _Line(icon: Icons.schedule, text: _duration(table.seatedMinutes!)),
                    if (table.runningTotal != null)
                      Padding(
                        padding: const EdgeInsets.only(top: NinoTokens.spaceXS),
                        child: Text(
                          _money(table.runningTotal!),
                          style: TextStyle(
                            fontSize: NinoTokens.fontSizeBody,
                            fontWeight: FontWeight.w700,
                            color: color,
                          ),
                        ),
                      ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  static String _duration(int minutes) =>
      minutes < 60 ? '$minutes phút' : '${minutes ~/ 60}h${(minutes % 60).toString().padLeft(2, '0')}';

  /// Định dạng tiền kiểu Việt Nam: 76.000đ
  static String _money(num amount) {
    final s = amount.round().toString();
    final buf = StringBuffer();
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 == 0) buf.write('.');
      buf.write(s[i]);
    }
    return '${buf}đ';
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Row(
          children: [
            Icon(icon, size: 14, color: NinoTokens.textSecondary),
            const SizedBox(width: NinoTokens.spaceXS),
            Expanded(
              child: Text(text,
                  style: const TextStyle(
                      fontSize: NinoTokens.fontSizeCaption,
                      color: NinoTokens.textSecondary),
                  overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
      );
}
