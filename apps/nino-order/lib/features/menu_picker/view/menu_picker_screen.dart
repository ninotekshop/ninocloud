// =====================================================================
//  NINOTEK NinoOrder — Màn hình chọn món, topping và ghi chú
// =====================================================================
//  Mở ra ngay sau khi nhân viên chiếm khoá một bàn (hoặc bấm "Đặt món mang
//  đi"). Mỗi lần thêm món vào giỏ sẽ sinh sẵn `orderDetailId` (UUID v4) —
//  cùng lý do với `orderId`: gửi lại bao nhiêu lần cũng cùng ID, máy POS
//  khử trùng lặp khi tablet mất mạng giữa chừng.
// =====================================================================

import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';

import '../../../core/network/lan_client.dart';
import '../../../core/theme/nino_theme.dart';
import '../../../data/models/models.dart';
import '../../cart/view/cart_sheet.dart' show formatVnd;

final _uuid = Uuid();

class MenuPickerScreen extends StatefulWidget {
  const MenuPickerScreen({
    super.key,
    required this.client,
    required this.tableLabel,
    required this.onAddToCart,
  });

  final LanClient client;
  final String tableLabel;
  final void Function(CartLine line) onAddToCart;

  @override
  State<MenuPickerScreen> createState() => _MenuPickerScreenState();
}

class _MenuPickerScreenState extends State<MenuPickerScreen> {
  bool _loading = true;
  String? _error;
  List<MenuCategory> _categories = const [];
  List<MenuItem> _items = const [];
  List<Topping> _toppings = const [];
  String? _selectedCategoryId;
  int _addedCount = 0;

  @override
  void initState() {
    super.initState();
    _loadMenu();
  }

  Future<void> _loadMenu() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final snapshot = await widget.client.fetchMenu();
      if (snapshot == null) {
        // 304 chỉ xảy ra khi gửi kèm etag cũ — lần đầu tải luôn có body.
        setState(() => _loading = false);
        return;
      }
      final categories = (snapshot['categories'] as List)
          .cast<Map<String, dynamic>>()
          .map(MenuCategory.fromJson)
          .toList();
      final items = (snapshot['items'] as List)
          .cast<Map<String, dynamic>>()
          .map(MenuItem.fromJson)
          .toList();
      final toppings = (snapshot['toppings'] as List)
          .cast<Map<String, dynamic>>()
          .map(Topping.fromJson)
          .toList();

      setState(() {
        _categories = categories;
        _items = items;
        _toppings = toppings;
        _selectedCategoryId = categories.isEmpty ? null : categories.first.id;
        _loading = false;
      });
    } catch (_) {
      setState(() {
        _error = 'Không tải được thực đơn. Kiểm tra lại kết nối tới máy thu ngân.';
        _loading = false;
      });
    }
  }

  List<MenuItem> get _visibleItems => _selectedCategoryId == null
      ? _items
      : _items.where((i) => i.categoryId == _selectedCategoryId).toList();

  Future<void> _openItem(MenuItem item) async {
    if (!item.isAvailable) return;
    final allowed =
        _toppings.where((t) => item.allowedToppingIds.contains(t.id)).toList();

    final line = await showModalBottomSheet<CartLine>(
      context: context,
      isScrollControlled: true,
      backgroundColor: NinoTokens.surfaceCard,
      builder: (_) => _ItemOptionsSheet(item: item, availableToppings: allowed),
    );
    if (line == null) return;

    widget.onAddToCart(line);
    setState(() => _addedCount++);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        duration: const Duration(milliseconds: 900),
        backgroundColor: NinoTokens.semanticSuccess,
        content: Text('Đã thêm ${line.item.name} vào giỏ'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Chọn món — ${widget.tableLabel}'),
        backgroundColor: NinoTokens.brandPrimary,
        foregroundColor: NinoTokens.textOnPrimary,
      ),
      floatingActionButton: _addedCount == 0
          ? null
          : FloatingActionButton.extended(
              onPressed: () => Navigator.of(context).pop(),
              backgroundColor: NinoTokens.semanticSuccess,
              icon: const Icon(Icons.check),
              label: Text('Xong ($_addedCount món)'),
            ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(NinoTokens.spaceLG),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.wifi_off_rounded, size: 40, color: NinoTokens.semanticDanger),
              const SizedBox(height: NinoTokens.spaceSM),
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: NinoTokens.spaceMD),
              ElevatedButton(onPressed: _loadMenu, child: const Text('Thử lại')),
            ],
          ),
        ),
      );
    }

    return Column(
      children: [
        SizedBox(
          height: NinoTokens.touchTargetLarge,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: NinoTokens.spaceLG, vertical: NinoTokens.spaceSM),
            children: _categories
                .map((c) => Padding(
                      padding: const EdgeInsets.only(right: NinoTokens.spaceSM),
                      child: ChoiceChip(
                        label: Text(c.name),
                        selected: _selectedCategoryId == c.id,
                        onSelected: (_) => setState(() => _selectedCategoryId = c.id),
                      ),
                    ))
                .toList(),
          ),
        ),
        const Divider(height: 1, color: NinoTokens.surfaceDivider),
        Expanded(
          child: GridView.builder(
            padding: const EdgeInsets.all(NinoTokens.spaceLG),
            gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
              maxCrossAxisExtent: 220,
              childAspectRatio: 0.82,
              crossAxisSpacing: NinoTokens.spaceMD,
              mainAxisSpacing: NinoTokens.spaceMD,
            ),
            itemCount: _visibleItems.length,
            itemBuilder: (context, i) => _MenuItemCard(
              item: _visibleItems[i],
              onTap: () => _openItem(_visibleItems[i]),
            ),
          ),
        ),
      ],
    );
  }
}

class _MenuItemCard extends StatelessWidget {
  const _MenuItemCard({required this.item, required this.onTap});
  final MenuItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final hasImage = item.imageUrl != null && item.imageUrl!.isNotEmpty;

    return Opacity(
      opacity: item.isAvailable ? 1 : 0.4,
      child: Material(
        color: NinoTokens.surfaceCard,
        borderRadius: BorderRadius.circular(NinoTokens.radiusLG),
        child: InkWell(
          borderRadius: BorderRadius.circular(NinoTokens.radiusLG),
          onTap: item.isAvailable ? onTap : null,
          child: Padding(
            padding: const EdgeInsets.all(NinoTokens.spaceMD),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(NinoTokens.radiusMD),
                  child: AspectRatio(
                    aspectRatio: 1.5,
                    child: hasImage
                        ? Image.network(
                            item.imageUrl!,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => _buildFallbackImage(),
                          )
                        : _buildFallbackImage(),
                  ),
                ),
                const SizedBox(height: NinoTokens.spaceSM),
                Expanded(
                  child: Text(
                    item.name,
                    style: const TextStyle(
                        fontSize: NinoTokens.fontSizeBody, fontWeight: FontWeight.w600),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (!item.isAvailable)
                  const Text('Tạm hết hôm nay',
                      style: TextStyle(
                          color: NinoTokens.semanticDanger, fontSize: NinoTokens.fontSizeCaption))
                else
                  Text(formatVnd(item.basePrice),
                      style: const TextStyle(
                          color: NinoTokens.brandPrimary,
                          fontWeight: FontWeight.w700,
                          fontSize: NinoTokens.fontSizeH3)),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildFallbackImage() => Container(
        color: NinoTokens.surfaceBackground,
        child: const Center(
          child: Icon(Icons.restaurant_outlined, color: NinoTokens.textTertiary, size: 28),
        ),
      );
}

/// Bảng chọn số lượng, topping và ghi chú cho một món trước khi thêm vào giỏ.
class _ItemOptionsSheet extends StatefulWidget {
  const _ItemOptionsSheet({required this.item, required this.availableToppings});
  final MenuItem item;
  final List<Topping> availableToppings;

  @override
  State<_ItemOptionsSheet> createState() => _ItemOptionsSheetState();
}

class _ItemOptionsSheetState extends State<_ItemOptionsSheet> {
  int _quantity = 1;
  final Set<String> _selectedToppingIds = {};
  final _noteController = TextEditingController();

  @override
  void dispose() {
    _noteController.dispose();
    super.dispose();
  }

  void _confirm() {
    final toppings =
        widget.availableToppings.where((t) => _selectedToppingIds.contains(t.id)).toList();
    final line = CartLine(
      // Sinh UUID v4 NGAY khi thêm vào giỏ — không đợi tới lúc "Gửi Bếp".
      orderDetailId: _uuid.v4(),
      item: widget.item,
      quantity: _quantity,
      note: _noteController.text.trim().isEmpty ? null : _noteController.text.trim(),
      toppings: toppings,
    );
    Navigator.of(context).pop(line);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        initialChildSize: 0.65,
        maxChildSize: 0.92,
        expand: false,
        builder: (context, scrollController) => ListView(
          controller: scrollController,
          padding: const EdgeInsets.all(NinoTokens.spaceLG),
          children: [
            Center(
              child: Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                  color: NinoTokens.surfaceDivider,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: NinoTokens.spaceLG),
            Text(widget.item.name,
                style: const TextStyle(fontSize: NinoTokens.fontSizeH2, fontWeight: FontWeight.w700)),
            const SizedBox(height: NinoTokens.spaceXS),
            Text(formatVnd(widget.item.basePrice),
                style: const TextStyle(color: NinoTokens.brandPrimary, fontWeight: FontWeight.w700)),
            const SizedBox(height: NinoTokens.spaceLG),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Số lượng', style: TextStyle(fontWeight: FontWeight.w600)),
                Row(
                  children: [
                    _StepIconButton(
                      icon: Icons.remove,
                      onPressed: _quantity > 1 ? () => setState(() => _quantity--) : null,
                    ),
                    SizedBox(
                      width: 40,
                      child: Text('$_quantity',
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontSize: NinoTokens.fontSizeH3, fontWeight: FontWeight.w700)),
                    ),
                    _StepIconButton(icon: Icons.add, onPressed: () => setState(() => _quantity++)),
                  ],
                ),
              ],
            ),
            if (widget.availableToppings.isNotEmpty) ...[
              const SizedBox(height: NinoTokens.spaceLG),
              const Text('Topping / tuỳ chọn', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: NinoTokens.spaceXS),
              Wrap(
                spacing: NinoTokens.spaceSM,
                runSpacing: NinoTokens.spaceSM,
                children: widget.availableToppings.map((t) {
                  final selected = _selectedToppingIds.contains(t.id);
                  return FilterChip(
                    label: Text(t.extraPrice > 0
                        ? '${t.name} (+${formatVnd(t.extraPrice)})'
                        : t.name),
                    selected: selected,
                    onSelected: (v) => setState(
                        () => v ? _selectedToppingIds.add(t.id) : _selectedToppingIds.remove(t.id)),
                  );
                }).toList(),
              ),
            ],
            const SizedBox(height: NinoTokens.spaceLG),
            const Text('Ghi chú', style: TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: NinoTokens.spaceXS),
            TextField(
              controller: _noteController,
              maxLines: 2,
              decoration: const InputDecoration(
                hintText: 'Ví dụ: ít đường, không đá',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: NinoTokens.spaceXL),
            SizedBox(
              height: NinoTokens.touchTargetLarge,
              child: ElevatedButton(
                onPressed: _confirm,
                child: const Text('Thêm vào giỏ'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StepIconButton extends StatelessWidget {
  const _StepIconButton({required this.icon, required this.onPressed});
  final IconData icon;
  final VoidCallback? onPressed;

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
            child: Icon(icon,
                size: 20,
                color: onPressed == null ? NinoTokens.textTertiary : NinoTokens.brandPrimary),
          ),
        ),
      );
}
