// =====================================================================
//  NINOTEK NinoOrder — Chuyển bàn / Gộp bàn
// =====================================================================
//  Khớp POST /api/v1/lan/orders/{orderId}/transfer trong openapi.yaml.
//  mergeIfOccupied=false  → "Chuyển bàn": từ chối nếu bàn đích đã có khách.
//  mergeIfOccupied=true   → "Gộp bàn": nhập đơn hiện tại vào đơn đang mở ở
//                           bàn đích (khách ăn chung, gộp bill).
// =====================================================================

import 'package:flutter/material.dart';

import '../../../core/theme/nino_theme.dart';
import '../../../data/models/models.dart';

class TableTransferSheet extends StatefulWidget {
  const TableTransferSheet({
    super.key,
    required this.sourceTable,
    required this.candidateTables,
  });

  /// Bàn đang có đơn cần chuyển đi.
  final TableStatus sourceTable;

  /// Mọi bàn khác trong sơ đồ — nhân viên chọn một bàn đích trong đây.
  final List<TableStatus> candidateTables;

  @override
  State<TableTransferSheet> createState() => _TableTransferSheetState();
}

class _TableTransferSheetState extends State<TableTransferSheet> {
  String? _targetTableId;
  bool _mergeIfOccupied = false;

  @override
  Widget build(BuildContext context) {
    final targets =
        widget.candidateTables.where((t) => t.id != widget.sourceTable.id).toList();
    final target = targets.where((t) => t.id == _targetTableId).firstOrNull;
    final targetIsOccupied = target != null && !target.isEmpty;

    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      maxChildSize: 0.92,
      expand: false,
      builder: (context, scrollController) => Column(
        children: [
          const SizedBox(height: NinoTokens.spaceMD),
          Container(
            width: 44,
            height: 4,
            decoration: BoxDecoration(
              color: NinoTokens.surfaceDivider,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(NinoTokens.spaceLG),
            child: Text('Chuyển / gộp bàn ${widget.sourceTable.name}',
                style: const TextStyle(fontSize: NinoTokens.fontSizeH2, fontWeight: FontWeight.w700)),
          ),
          Expanded(
            child: ListView.builder(
              controller: scrollController,
              itemCount: targets.length,
              itemBuilder: (context, i) {
                final t = targets[i];
                return RadioListTile<String>(
                  value: t.id,
                  groupValue: _targetTableId,
                  onChanged: (v) => setState(() => _targetTableId = v),
                  title: Text(t.name),
                  subtitle: Text(t.isEmpty
                      ? 'Trống'
                      : 'Đang có khách — ${t.guestCount ?? '?'} khách'),
                );
              },
            ),
          ),
          if (targetIsOccupied)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: NinoTokens.spaceLG),
              child: SwitchListTile(
                value: _mergeIfOccupied,
                onChanged: (v) => setState(() => _mergeIfOccupied = v),
                title: const Text('Gộp vào đơn đang mở ở bàn đích'),
                subtitle: const Text('Tắt: sẽ báo lỗi vì bàn đích đã có khách'),
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(NinoTokens.spaceLG),
            child: SizedBox(
              width: double.infinity,
              height: NinoTokens.touchTargetLarge,
              child: ElevatedButton(
                onPressed: _targetTableId == null
                    ? null
                    : () => Navigator.of(context).pop(
                          TableTransferRequest(
                            targetTableId: _targetTableId!,
                            mergeIfOccupied: targetIsOccupied && _mergeIfOccupied,
                          ),
                        ),
                child: Text(targetIsOccupied && _mergeIfOccupied ? 'Gộp bàn' : 'Chuyển bàn'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class TableTransferRequest {
  const TableTransferRequest({required this.targetTableId, required this.mergeIfOccupied});
  final String targetTableId;
  final bool mergeIfOccupied;
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
