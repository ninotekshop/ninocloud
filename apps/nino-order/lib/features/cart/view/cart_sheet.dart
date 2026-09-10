// =====================================================================
//  NINOTEK NinoOrder — Giỏ hàng và nút "Gửi Bếp"
// =====================================================================
//  Thanh dưới cùng luôn thấy được: nhân viên biết đã chọn bao nhiêu món và
//  tổng bao nhiêu tiền mà không phải mở màn hình khác.
//
//  QUAN TRỌNG: nút "Gửi Bếp" KHÔNG chờ máy POS trả lời. Đơn được đưa vào
//  hàng đợi offline (đã ghi xuống đĩa) rồi báo thành công ngay. Nhân viên
//  đứng cạnh bàn khách, không được bắt họ nhìn vòng xoay.
// =====================================================================

import 'package:flutter/material.dart';

import '../../../core/theme/nino_theme.dart';
import '../../../data/models/models.dart';

class CartBottomBar extends StatelessWidget {
  const CartBottomBar({
    super.key,
    required this.lines,
    required this.onOpenCart,
    required this.onSubmit,
    this.isSubmitting = false,
  });

  final List<CartLine> lines;
  final VoidCallback onOpenCart;
  final VoidCallback onSubmit;
  final bool isSubmitting;

  int get totalItems =>
      lines.fold<int>(0, (sum, l) => sum + l.quantity);

  num get totalAmount =>
      lines.fold<num>(0, (sum, l) => sum + l.lineTotal);

  @override
  Widget build(BuildContext context) {
    if (lines.isEmpty) return const SizedBox.shrink();

    return Material(
      color: NinoTokens.surfaceCard,
      elevation: 12,
      child: SafeArea(
        top: false,
        child: Container(
          height: NinoTokens.touchTargetLarge + NinoTokens.spaceLG,
          padding: const EdgeInsets.symmetric(horizontal: NinoTokens.spaceLG),
          child: Row(
            children: [
              Expanded(
                child: InkWell(
                  onTap: onOpenCart,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: NinoTokens.spaceSM),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text('$totalItems món đã chọn',
                            style: const TextStyle(
                                fontSize: NinoTokens.fontSizeCaption,
                                color: NinoTokens.textSecondary)),
                        const SizedBox(height: 2),
                        Text(formatVnd(totalAmount),
                            style: const TextStyle(
                                fontSize: NinoTokens.fontSizeH2,
                                fontWeight: FontWeight.w700,
                                color: NinoTokens.textPrimary)),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: NinoTokens.spaceLG),
              SizedBox(
                height: NinoTokens.touchTargetLarge,
                width: 170,
                child: ElevatedButton.icon(
                  onPressed: isSubmitting ? null : onSubmit,
                  icon: isSubmitting
                      ? const SizedBox(
                          width: 18, height: 18,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: NinoTokens.textOnPrimary))
                      : const Icon(Icons.send_rounded),
                  label: Text(isSubmitting ? 'Đang gửi...' : 'Gửi Bếp',
                      style: const TextStyle(
                          fontSize: NinoTokens.fontSizeH3,
                          fontWeight: FontWeight.w700)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Danh sách chi tiết giỏ hàng, mở từ thanh dưới.
class CartSheet extends StatelessWidget {
  const CartSheet({
    super.key,
    required this.lines,
    required this.onChangeQuantity,
    required this.onRemove,
    required this.onEditNote,
  });

  final List<CartLine> lines;
  final void Function(CartLine line, int delta) onChangeQuantity;
  final void Function(CartLine line) onRemove;
  final void Function(CartLine line) onEditNote;

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      maxChildSize: 0.92,
      expand: false,
      builder: (context, scrollController) => Column(
        children: [
          const SizedBox(height: NinoTokens.spaceMD),
          Container(
            width: 44, height: 4,
            decoration: BoxDecoration(
              color: NinoTokens.surfaceDivider,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const Padding(
            padding: EdgeInsets.all(NinoTokens.spaceLG),
            child: Text('Món đã chọn',
                style: TextStyle(
                    fontSize: NinoTokens.fontSizeH2, fontWeight: FontWeight.w700)),
          ),
          Expanded(
            child: ListView.separated(
              controller: scrollController,
              itemCount: lines.length,
              separatorBuilder: (_, __) =>
                  const Divider(height: 1, color: NinoTokens.surfaceDivider),
              itemBuilder: (context, i) => _CartLineTile(
                line: lines[i],
                onChangeQuantity: onChangeQuantity,
                onRemove: onRemove,
                onEditNote: onEditNote,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CartLineTile extends StatelessWidget {
  const _CartLineTile({
    required this.line,
    required this.onChangeQuantity,
    required this.onRemove,
    required this.onEditNote,
  });

  final CartLine line;
  final void Function(CartLine, int) onChangeQuantity;
  final void Function(CartLine) onRemove;
  final void Function(CartLine) onEditNote;

  @override
  Widget build(BuildContext context) {
    final extras = <String>[
      ...line.toppings.map((t) => t.name),
      if (line.note != null && line.note!.isNotEmpty) line.note!,
    ];

    return Padding(
      padding: const EdgeInsets.symmetric(
          horizontal: NinoTokens.spaceLG, vertical: NinoTokens.spaceMD),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(line.item.name,
                    style: const TextStyle(
                        fontSize: NinoTokens.fontSizeBody,
                        fontWeight: FontWeight.w600)),
                if (extras.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(extras.join(' · '),
                      style: const TextStyle(
                          fontSize: NinoTokens.fontSizeCaption,
                          color: NinoTokens.semanticWarning)),
                ],
                const SizedBox(height: NinoTokens.spaceXS),
                TextButton.icon(
                  onPressed: () => onEditNote(line),
                  icon: const Icon(Icons.edit_note, size: 18),
                  label: const Text('Ghi chú'),
                  style: TextButton.styleFrom(
                    padding: EdgeInsets.zero,
                    minimumSize: const Size(0, NinoTokens.touchTargetMinimum),
                    tapTargetSize: MaterialTapTargetSize.padded,
                  ),
                ),
              ],
            ),
          ),
          _QuantityStepper(
            quantity: line.quantity,
            onDecrease: () => line.quantity > 1
                ? onChangeQuantity(line, -1)
                : onRemove(line),
            onIncrease: () => onChangeQuantity(line, 1),
          ),
          SizedBox(
            width: 96,
            child: Text(formatVnd(line.lineTotal),
                textAlign: TextAlign.right,
                style: const TextStyle(
                    fontSize: NinoTokens.fontSizeBody,
                    fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }
}

class _QuantityStepper extends StatelessWidget {
  const _QuantityStepper({
    required this.quantity,
    required this.onDecrease,
    required this.onIncrease,
  });

  final int quantity;
  final VoidCallback onDecrease;
  final VoidCallback onIncrease;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Cả hai nút đều đạt 48dp — nhân viên bấm bằng ngón cái khi tay kia
          // đang bưng khay.
          _StepButton(icon: Icons.remove, onPressed: onDecrease),
          SizedBox(
            width: 40,
            child: Text('$quantity',
                textAlign: TextAlign.center,
                style: const TextStyle(
                    fontSize: NinoTokens.fontSizeH3, fontWeight: FontWeight.w700)),
          ),
          _StepButton(icon: Icons.add, onPressed: onIncrease),
        ],
      );
}

class _StepButton extends StatelessWidget {
  const _StepButton({required this.icon, required this.onPressed});
  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => SizedBox(
        width: NinoTokens.touchTargetMinimum,
        height: NinoTokens.touchTargetMinimum,
        child: Material(
          color: NinoTokens.surfaceBackground,
          borderRadius: BorderRadius.circular(NinoTokens.radiusMD),
          child: InkWell(
            borderRadius: BorderRadius.circular(NinoTokens.radiusMD),
            onTap: onPressed,
            child: Icon(icon, size: 20, color: NinoTokens.brandPrimary),
          ),
        ),
      );
}

/// Định dạng tiền kiểu Việt Nam: 76000 -> "76.000đ".
String formatVnd(num amount) {
  final digits = amount.round().abs().toString();
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write('.');
    buffer.write(digits[i]);
  }
  return '${amount < 0 ? '-' : ''}$bufferđ';
}
