// =====================================================================
//  NINOTEK NinoOrder — Điểm khởi động
// =====================================================================
//  App gọi món tại bàn cho nhân viên phục vụ.
//
//  Luồng khởi động:
//    1. Đọc cấu hình ghép nối đã lưu (SharedPreferences) — nếu có thì bỏ
//       qua bước ghép nối, vào thẳng sơ đồ bàn.
//    2. Chưa từng ghép nối? Hiện màn hình dò máy NinoPOS + nhập mã 6 số.
//    3. Đọc lại hàng đợi offline từ đĩa (đơn còn dở của ca trước) rồi mới
//       lo chuyện mạng — tablet hết pin giữa ca thì đơn của khách phải
//       được khôi phục ngay khi mở lại app, kể cả khi vẫn chưa có mạng.
// =====================================================================

import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';

import 'core/auth/role_policy.dart';
import 'core/network/connection_manager.dart';
import 'core/network/lan_client.dart';
import 'core/offline/offline_queue.dart';
import 'core/storage/device_storage.dart';
import 'core/theme/nino_theme.dart';
import 'data/models/models.dart';
import 'features/cart/view/cart_sheet.dart';
import 'features/connection_banner/view/connection_banner.dart';
import 'features/menu_picker/view/menu_picker_screen.dart';
import 'features/pairing/view/pairing_screen.dart';
import 'features/table_map/view/table_map_screen.dart';
import 'features/table_map/view/table_transfer_sheet.dart';

final _uuid = Uuid();

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const NinoOrderApp());
}

class NinoOrderApp extends StatelessWidget {
  const NinoOrderApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'NinoOrder',
        debugShowCheckedModeBanner: false,
        theme: buildNinoTheme(),
        home: const AppRoot(),
      );
}

/// Quyết định hiện màn hình ghép nối hay sơ đồ bàn, tuỳ đã có cấu hình
/// lưu cục bộ hay chưa.
class AppRoot extends StatefulWidget {
  const AppRoot({super.key});

  @override
  State<AppRoot> createState() => _AppRootState();
}

class _AppRootState extends State<AppRoot> {
  final _storage = DeviceStorage();
  late final LanClient _client;

  bool _loading = true;
  PairedDeviceConfig? _config;

  @override
  void initState() {
    super.initState();
    _client = LanClient();
    _restoreConfig();
  }

  Future<void> _restoreConfig() async {
    final config = await _storage.load();
    if (config != null) {
      _client.configure(config.server, config.deviceToken, deviceId: config.deviceId);
    }
    if (!mounted) return;
    setState(() {
      _config = config;
      _loading = false;
    });
  }

  Future<void> _handlePaired(
      LanServerInfo server, PairResult result, String deviceName) async {
    await _storage.save(
      server: server,
      deviceId: result.deviceId,
      deviceToken: result.deviceToken,
      deviceName: deviceName,
    );
    if (!mounted) return;
    setState(() {
      _config = PairedDeviceConfig(
        server: server,
        deviceId: result.deviceId,
        deviceToken: result.deviceToken,
        deviceName: deviceName,
      );
    });
  }

  /// Nhân viên/thu ngân bấm "Ghép nối lại máy khác" — xoá cấu hình cũ và
  /// quay về màn hình dò máy POS.
  Future<void> _handleRepair() async {
    await _storage.clear();
    _client.reset();
    if (!mounted) return;
    setState(() => _config = null);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_config == null) {
      return PairingScreen(client: _client, onPaired: _handlePaired);
    }
    return OrderShell(
      client: _client,
      deviceName: _config!.deviceName,
      onRepair: _handleRepair,
    );
  }
}

/// Khung ngoài: banner kết nối luôn ở trên cùng, nội dung ở dưới.
class OrderShell extends StatefulWidget {
  const OrderShell({
    super.key,
    required this.client,
    required this.deviceName,
    required this.onRepair,
  });

  final LanClient client;
  final String deviceName;
  final VoidCallback onRepair;

  @override
  State<OrderShell> createState() => _OrderShellState();
}

class _OrderShellState extends State<OrderShell> {
  late final ConnectionManager _connection;
  late final OfflineOrderQueue _queue;

  LanConnectionState _connectionState =
      const LanConnectionState(status: ConnectionStatus.connecting);
  QueueState? _queueState;

  static const _session = UserSession(
    userId: '33333333-3333-4333-8333-000000000003',
    displayName: 'Nhân viên phục vụ',
    role: AppRole.waiter,
  );

  List<TableStatus> _tables = const [];
  String? _selectedAreaId;
  final List<CartLine> _cart = [];
  bool _submitting = false;
  TableStatus? _selectedTable;

  LanClient get _client => widget.client;

  @override
  void initState() {
    super.initState();
    _connection = ConnectionManager(client: _client);
    _queue = OfflineOrderQueue(
      storage: SharedPrefsQueueStorage(),
      sender: _client.createOrder,
    );

    _connection.stateStream.listen((s) {
      if (!mounted) return;
      setState(() => _connectionState = s);
      // Có mạng lại thì đẩy ngay hàng đợi, không đợi tới nhịp sau.
      _queue.setOnline(s.isOnline);
      if (s.isOnline) _refreshTables();
    });

    _queue.stateStream.listen((s) {
      if (mounted) setState(() => _queueState = s);
    });

    _connection.events.listen(_onServerEvent);
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    // Khôi phục đơn còn dở TRƯỚC khi lo chuyện mạng.
    await _queue.restore();
    // Nhịp tự thử gửi lại cố định 3 giây theo Master SRS mục 4 — lớp bảo
    // hiểm thứ hai bên cạnh việc ConnectionManager cũng đẩy hàng đợi mỗi
    // khi phát hiện có mạng lại.
    _queue.startAutoRetry();
    await _connection.start();
  }

  /// Máy POS báo có thay đổi — cập nhật sơ đồ bàn tại chỗ thay vì tải lại
  /// toàn bộ. Wi-Fi quán yếu, tải lại cả danh sách mỗi lần là lãng phí.
  void _onServerEvent(Map<String, dynamic> event) {
    final type = event['event'];
    if (type != 'TABLE_STATUS_CHANGED' && type != 'TABLE_LOCKED') return;
    _refreshTables();
  }

  Future<void> _refreshTables() async {
    try {
      final raw = await _client.fetchTables();
      if (!mounted) return;
      setState(() => _tables = raw.map(TableStatus.fromJson).toList());
    } on Exception {
      // Mất mạng — giữ nguyên danh sách cũ. Nhân viên vẫn thấy sơ đồ bàn
      // lần cuối biết được, tốt hơn nhiều so với màn hình trống.
    }
  }

  Future<void> _submitOrder(TableStatus? table) async {
    if (_cart.isEmpty) return;
    setState(() => _submitting = true);

    try {
      // UUID sinh Ở ĐÂY, trước khi gửi. Gửi lại bao nhiêu lần cũng cùng ID
      // này, nên máy POS nhận ra và không tạo đơn thứ hai.
      final orderId = _uuid.v4();
      final payload = <String, dynamic>{
        'orderId': orderId,
        'userId': _session.userId,
        if (table != null) 'tableId': table.id,
        'orderType': table == null ? 'TAKE_AWAY' : 'DINE_IN',
        'guestCount': table?.guestCount ?? 1,
        'clientCreatedAt': DateTime.now().toUtc().toIso8601String(),
        'items': _cart.map((l) => l.toJson()).toList(),
      };

      // Đưa vào hàng đợi (đã ghi xuống đĩa) rồi báo thành công NGAY.
      // Không chờ máy POS — nhân viên đang đứng cạnh bàn khách.
      await _queue.enqueue(orderId, payload);

      if (!mounted) return;
      setState(() {
        _cart.clear();
        _selectedTable = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: NinoTokens.semanticSuccess,
          content: Text(_connectionState.isOnline
              ? 'Đã gửi bếp'
              : 'Đã lưu — sẽ tự gửi khi có mạng lại'),
        ),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  void dispose() {
    _connection.dispose();
    _queue.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_session.canUseOrder) {
      return const Scaffold(
        body: Center(child: Text('Tài khoản không được phép dùng NinoOrder')),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text('Sơ đồ bàn - ${_session.displayName}'),
        backgroundColor: NinoTokens.brandPrimary,
        foregroundColor: NinoTokens.textOnPrimary,
        actions: [
          // Luôn hiển thị trạng thái kết nối + độ trễ, không chỉ lúc mất
          // mạng — nhân viên và người giám sát cần biết Wi-Fi có đang yếu.
          Center(child: ConnectionStatusChip(connection: _connectionState)),
          PopupMenuButton<String>(
            onSelected: (value) {
              if (value == 'repair') widget.onRepair();
            },
            itemBuilder: (context) => const [
              PopupMenuItem(value: 'repair', child: Text('Ghép nối lại máy khác')),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          ConnectionBanner(connection: _connectionState, queue: _queueState),
          Expanded(
            child: TableMapScreen(
              tables: _tables,
              currentUserId: _session.userId,
              selectedAreaId: _selectedAreaId,
              onAreaSelected: (id) => setState(() => _selectedAreaId = id),
              onRefresh: _refreshTables,
              onTableTap: _onTableTap,
              onTransferTable: _onTransferTable,
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _submitting ? null : () => _openMenuPicker(null),
        icon: const Icon(Icons.shopping_bag_outlined),
        label: const Text('Đặt món mang về'),
      ),
      bottomNavigationBar: CartBottomBar(
        lines: _cart,
        isSubmitting: _submitting,
        onOpenCart: _openCart,
        onSubmit: () => _submitOrder(_selectedTable),
      ),
    );
  }

  Future<void> _onTableTap(TableStatus table) async {
    // Chiếm khoá mềm TRƯỚC khi mở màn hình chọn món. Nếu nhân viên khác
    // đang giữ, biết ngay thay vì soạn xong cả đơn rồi mới bị từ chối.
    try {
      await _client.lockTable(
        table.id,
        userId: _session.userId,
        userName: _session.displayName,
      );
    } on LanApiException catch (e) {
      if (!mounted) return;
      if (e.isConflict) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: NinoTokens.semanticWarning,
            content: Text(e.message),
          ),
        );
        return;
      }
    } on Exception {
      // Mất mạng: vẫn cho gọi món. Đơn vào hàng đợi, máy POS xử lý xung đột
      // khi nhận được. Chặn ở đây nghĩa là mất mạng thì quán ngừng bán hàng.
    }
    if (!mounted) return;
    setState(() => _selectedTable = table);
    await _openMenuPicker(table);
  }

  Future<void> _openMenuPicker(TableStatus? table) async {
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => MenuPickerScreen(
          client: _client,
          tableLabel: table?.name ?? 'Mang về',
          onAddToCart: (line) => setState(() => _cart.add(line)),
        ),
      ),
    );
  }

  /// Chuyển bàn / gộp bàn — khớp POST /api/v1/lan/orders/{orderId}/transfer.
  Future<void> _onTransferTable(TableStatus source) async {
    final orderId = source.currentOrderId;
    if (orderId == null) return;

    final request = await showModalBottomSheet<TableTransferRequest>(
      context: context,
      isScrollControlled: true,
      backgroundColor: NinoTokens.surfaceCard,
      builder: (_) => TableTransferSheet(sourceTable: source, candidateTables: _tables),
    );
    if (request == null) return;

    try {
      await _client.transferOrder(
        orderId,
        targetTableId: request.targetTableId,
        rowVersion: source.rowVersion,
        mergeIfOccupied: request.mergeIfOccupied,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          backgroundColor: NinoTokens.semanticSuccess,
          content: Text(request.mergeIfOccupied ? 'Đã gộp bàn' : 'Đã chuyển bàn'),
        ),
      );
      await _refreshTables();
    } on LanApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(backgroundColor: NinoTokens.semanticDanger, content: Text(e.message)),
      );
    } on Exception {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          backgroundColor: NinoTokens.semanticDanger,
          content: Text('Không gửi được yêu cầu chuyển bàn — kiểm tra lại mạng LAN'),
        ),
      );
    }
  }

  void _openCart() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: NinoTokens.surfaceCard,
      // StatefulBuilder để giỏ hàng cập nhật ngay khi đổi số lượng/ghi chú
      // mà không cần đóng rồi mở lại sheet.
      builder: (_) => StatefulBuilder(
        builder: (sheetContext, setSheetState) => CartSheet(
          lines: _cart,
          onChangeQuantity: (line, delta) {
            setState(() => line.quantity += delta);
            setSheetState(() {});
          },
          onRemove: (line) {
            setState(() => _cart.remove(line));
            setSheetState(() {});
          },
          onEditNote: (line) async {
            await _editNote(sheetContext, line);
            setState(() {});
            setSheetState(() {});
          },
        ),
      ),
    );
  }

  Future<void> _editNote(BuildContext dialogContext, CartLine line) async {
    final controller = TextEditingController(text: line.note ?? '');
    final result = await showDialog<String>(
      context: dialogContext,
      builder: (context) => AlertDialog(
        title: Text('Ghi chú — ${line.item.name}'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLines: 2,
          decoration: const InputDecoration(
            hintText: 'Ví dụ: ít đường, không đá',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Huỷ'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).pop(controller.text.trim()),
            child: const Text('Lưu'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (result != null) {
      line.note = result.isEmpty ? null : result;
    }
  }
}
