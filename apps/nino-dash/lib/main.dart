import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';

import 'core/auth/role_policy.dart';
import 'core/network/cloud_api_client.dart';
import 'core/network/websocket_client.dart';
import 'core/notifications/fcm_push_service.dart';
import 'core/theme/nino_theme.dart';
import 'features/branch_switcher/branch_switcher.dart';
import 'features/charts/interactive_charts.dart';
import 'features/inventory_alert/inventory_alert_screen.dart';
import 'features/live_tables/live_tables_screen.dart';
import 'features/notifications/notifications_screen.dart';
import 'features/overview/widgets/kpi_cards.dart';
import 'models/dashboard_report.dart';
import 'models/live_table.dart';
import 'models/store_branch.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await initializeDateFormatting('vi_VN', null);
    Intl.defaultLocale = 'vi_VN';
  } catch (_) {}

  FlutterError.onError = (details) {
    FlutterError.presentError(details);
  };

  runZonedGuarded(() {
    runApp(const NinoDashApp());
  }, (error, stack) {
    debugPrint('Uncaught app error: $error\n$stack');
  });
}

class NinoDashApp extends StatelessWidget {
  const NinoDashApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'NinoDash - Ninotek F&B',
      debugShowCheckedModeBanner: false,
      theme: NinoDashTheme.lightTheme,
      home: const DashboardShellScreen(),
    );
  }
}

class DashboardShellScreen extends StatefulWidget {
  const DashboardShellScreen({super.key});

  @override
  State<DashboardShellScreen> createState() => _DashboardShellScreenState();
}

class _DashboardShellScreenState extends State<DashboardShellScreen> {
  static const userSession = UserSession(
    userId: '33333333-3333-4333-8333-000000000001',
    displayName: 'Chủ quán (Owner)',
    role: AppRole.owner,
  );

  final CloudApiClient _apiClient = CloudApiClient(
    baseUrl: 'http://127.0.0.1:3000/api/v1',
  );
  late DashboardWebSocketClient _wsClient;
  final FcmPushService _pushService = FcmPushService();

  StreamSubscription<RealtimeEvent>? _wsSubscription;

  int _currentTabIndex = 0;
  bool _loading = true;
  ConnectionTestResult? _lastConnectionStatus;

  DashboardReport _report = DashboardReport.mockData();
  List<LiveTable> _tables = LiveTable.mockTables();
  List<StoreBranch> _branches = StoreBranch.mockBranches();
  late StoreBranch _selectedBranch;

  DateFilterType _dateFilter = DateFilterType.today;

  @override
  void initState() {
    super.initState();
    _selectedBranch = _branches.first;
    _wsClient = DashboardWebSocketClient(
      wsUrl: 'ws://127.0.0.1:3000/ws/cloud/realtime-reports',
    );
    _loadData();
    _initWebSocket();
  }

  void _initWebSocket() {
    try {
      _wsClient.connect();
      _wsSubscription?.cancel();
      _wsSubscription = _wsClient.eventStream.listen((event) {
        if (!mounted) return;

        if (event.event == 'REVENUE_UPDATED') {
          final netRev = (event.data['netRevenue'] as num?)?.toDouble() ?? _report.netRevenue;
          final orders = (event.data['totalOrders'] as num?)?.toInt() ?? _report.totalOrders;

          setState(() {
            _report = DashboardReport(
              netRevenue: netRev,
              grossRevenue: _report.grossRevenue,
              totalDiscount: _report.totalDiscount,
              totalOrders: orders,
              totalGuests: _report.totalGuests,
              avgOrderValue: orders > 0 ? netRev / orders : _report.avgOrderValue,
              revenueChangePercent: _report.revenueChangePercent,
              tableOccupancyPercent: _report.tableOccupancyPercent,
              revenueByHour: _report.revenueByHour,
              topSellingItems: _report.topSellingItems,
              paymentBreakdown: _report.paymentBreakdown,
              lowStockAlerts: _report.lowStockAlerts,
              suspiciousActivities: _report.suspiciousActivities,
            );
          });

          _pushService.addNotification(
            title: '💰 Doanh thu cập nhật real-time',
            body: 'Giao dịch mới! Tổng doanh thu hiện tại đạt ${NumberFormat.currency(locale: "vi_VN", symbol: "đ", decimalDigits: 0).format(netRev)}.',
            type: NotificationType.payment,
          );
        } else if (event.event == 'LOW_STOCK_ALERT') {
          _pushService.addNotification(
            title: '⚠️ Cảnh báo kho: ${event.data['name'] ?? "Nguyên liệu"}',
            body: 'Tồn kho chỉ còn ${event.data['stockQuantity']} ${event.data['unit'] ?? "kg"}.',
            type: NotificationType.stock,
          );
        } else if (event.event == 'SUSPICIOUS_ACTIVITY') {
          _pushService.addNotification(
            title: '🚨 Cảnh báo thất thoát',
            body: 'Phát hiện thao tác bất thường của nhân viên ${event.data['userName'] ?? ""}.',
            type: NotificationType.security,
          );
        }
      }, onError: (_) {});
    } catch (_) {}
  }

  Future<void> _loadData() async {
    setState(() => _loading = true);

    try {
      final connTest = await _apiClient.testConnection();

      final today = DateTime.now().toIso8601String().substring(0, 10);

      final reportResult = await _apiClient.getDashboardReport(
        storeId: _selectedBranch.id,
        fromDate: today,
        toDate: today,
      );

      final tablesResult = await _apiClient.getLiveTables(
        storeId: _selectedBranch.id,
      );

      final branchesResult = await _apiClient.getStoreBranches();

      if (!mounted) return;

      setState(() {
        _lastConnectionStatus = connTest;
        _report = reportResult;
        _tables = tablesResult;
        _branches = branchesResult;
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  void _simulateRealtimePayment() {
    final now = DateTime.now();
    _wsClient.simulateEvent(
      RealtimeEvent(
        event: 'REVENUE_UPDATED',
        eventId: 'evt_${now.millisecondsSinceEpoch}',
        sentAt: now,
        data: {
          'storeId': _selectedBranch.id,
          'netRevenue': _report.netRevenue + 185000.0,
          'totalOrders': _report.totalOrders + 1,
        },
      ),
    );

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('⚡ Đã giả lập nhận giao dịch thanh toán VietQR mới (+185.000đ)!'),
        backgroundColor: NinoDashTheme.success,
        duration: Duration(seconds: 2),
      ),
    );
  }

  @override
  void dispose() {
    _wsSubscription?.cancel();
    _wsClient.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!userSession.canViewRevenue) {
      return const Scaffold(
        body: Center(
          child: Text('Tài khoản không có quyền truy cập NinoDash'),
        ),
      );
    }

    final isLive = _lastConnectionStatus?.isLive ?? false;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: InkWell(
          onTap: _openBranchSwitcher,
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 6),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.store, color: NinoDashTheme.brandPrimary, size: 20),
                const SizedBox(width: 8),
                Flexible(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        _selectedBranch.name,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.bold,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                      const Text(
                        'Nhấn để đổi chi nhánh ▾',
                        style: TextStyle(
                          fontSize: 11,
                          color: NinoDashTheme.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        actions: [
          // Connection Status indicator badge
          InkWell(
            onTap: _showConnectionSettingsDialog,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              margin: const EdgeInsets.only(right: 4),
              decoration: BoxDecoration(
                color: isLive
                    ? NinoDashTheme.success.withValues(alpha: 0.12)
                    : NinoDashTheme.warning.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: isLive
                      ? NinoDashTheme.success.withValues(alpha: 0.4)
                      : NinoDashTheme.warning.withValues(alpha: 0.4),
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.fiber_manual_record,
                    color: isLive ? NinoDashTheme.success : NinoDashTheme.warning,
                    size: 10,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    isLive ? 'LIVE SERVER' : 'CONNECT POS',
                    style: TextStyle(
                      color: isLive ? NinoDashTheme.success : NinoDashTheme.warning,
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Simulate payment WS button
          IconButton(
            tooltip: 'Giả lập thanh toán VietQR',
            icon: const Icon(Icons.flash_on, color: NinoDashTheme.warning),
            onPressed: _simulateRealtimePayment,
          ),

          // Settings / Server Config button
          IconButton(
            tooltip: 'Cấu hình kết nối Server / POS',
            icon: const Icon(Icons.settings_outlined),
            onPressed: _showConnectionSettingsDialog,
          ),

          // Refresh button
          IconButton(
            tooltip: 'Làm mới',
            icon: const Icon(Icons.refresh),
            onPressed: _loadData,
          ),
        ],
      ),
      body: Column(
        children: [
          // Connection status alert bar
          if (_lastConnectionStatus != null)
            InkWell(
              onTap: _showConnectionSettingsDialog,
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                color: isLive
                    ? NinoDashTheme.success.withValues(alpha: 0.15)
                    : NinoDashTheme.warning.withValues(alpha: 0.15),
                child: Row(
                  children: [
                    Icon(
                      isLive ? Icons.check_circle : Icons.wifi_off_outlined,
                      color: isLive ? NinoDashTheme.success : NinoDashTheme.warning,
                      size: 16,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        _lastConnectionStatus!.message,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: isLive ? NinoDashTheme.success : NinoDashTheme.warning,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const Text(
                      'Cấu hình ⚙️',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: NinoDashTheme.brandPrimary,
                      ),
                    ),
                  ],
                ),
              ),
            ),

          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : IndexedStack(
                    index: _currentTabIndex,
                    children: [
                      // Tab 0: Overview
                      RefreshIndicator(
                        onRefresh: _loadData,
                        child: ListView(
                          padding: const EdgeInsets.all(16),
                          children: [
                            KpiGrid(report: _report),
                          ],
                        ),
                      ),

                      // Tab 1: Live Tables
                      LiveTablesScreen(
                        tables: _tables,
                        onRefresh: _loadData,
                      ),

                      // Tab 2: Analytics & Interactive Charts
                      RefreshIndicator(
                        onRefresh: _loadData,
                        child: ListView(
                          padding: const EdgeInsets.all(16),
                          children: [
                            DateFilterBar(
                              selectedFilter: _dateFilter,
                              onFilterChanged: (f) => setState(() => _dateFilter = f),
                            ),
                            const SizedBox(height: 16),
                            RevenueHourInteractiveChart(data: _report.revenueByHour),
                            const SizedBox(height: 16),
                            TopSellingBarChart(items: _report.topSellingItems),
                          ],
                        ),
                      ),

                      // Tab 3: Inventory & Loss Prevention Alerts
                      InventoryAlertScreen(
                        stockAlerts: _report.lowStockAlerts,
                        suspiciousActivities: _report.suspiciousActivities,
                        onRefresh: _loadData,
                      ),

                      // Tab 4: Push Notifications
                      NotificationsScreen(pushService: _pushService),
                    ],
                  ),
          ),
        ],
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentTabIndex,
        onTap: (index) => setState(() => _currentTabIndex = index),
        items: [
          const BottomNavigationBarItem(
            icon: Icon(Icons.dashboard_outlined),
            activeIcon: Icon(Icons.dashboard),
            label: 'Tổng quan',
          ),
          BottomNavigationBarItem(
            icon: Badge(
              label: Text('${_tables.where((t) => t.status == "OCCUPIED" || t.status == "BILLING").length}'),
              backgroundColor: NinoDashTheme.brandPrimary,
              child: const Icon(Icons.table_restaurant_outlined),
            ),
            activeIcon: const Icon(Icons.table_restaurant),
            label: 'Bán hàng live',
          ),
          const BottomNavigationBarItem(
            icon: Icon(Icons.bar_chart_outlined),
            activeIcon: Icon(Icons.bar_chart),
            label: 'Biểu đồ',
          ),
          BottomNavigationBarItem(
            icon: Badge(
              label: Text('${_report.lowStockAlerts.length + _report.suspiciousActivities.length}'),
              backgroundColor: NinoDashTheme.warning,
              child: const Icon(Icons.warning_amber_outlined),
            ),
            activeIcon: const Icon(Icons.warning),
            label: 'Cảnh báo',
          ),
          BottomNavigationBarItem(
            icon: Badge(
              isLabelVisible: _pushService.unreadCount > 0,
              label: Text('${_pushService.unreadCount}'),
              child: const Icon(Icons.notifications_outlined),
            ),
            activeIcon: const Icon(Icons.notifications),
            label: 'Thông báo',
          ),
        ],
      ),
    );
  }

  void _openBranchSwitcher() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) {
        return BranchSwitcherBottomSheet(
          branches: _branches,
          selectedBranch: _selectedBranch,
          onBranchSelected: (branch) {
            setState(() {
              _selectedBranch = branch;
            });
            _loadData();
          },
        );
      },
    );
  }

  void _showConnectionSettingsDialog() {
    final urlController = TextEditingController(text: _apiClient.baseUrl);
    bool lanMode = _apiClient.isLanMode;
    ConnectionTestResult? testResult = _lastConnectionStatus;
    bool testing = false;
    bool scanning = false;
    List<DiscoveredPosStation> discoveredStations = [];
    String scanProgress = '';

    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              title: const Row(
                children: [
                  Icon(Icons.router, color: NinoDashTheme.brandPrimary),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Kết nối Máy Chủ / NinoPOS',
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
                    ),
                  ),
                ],
              ),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Cấu hình IP để kết nối dữ liệu thật. Bạn có thể nhấn nút "Tự động quét" để ứng dụng tự dò trạm thu ngân trong mạng Wi-Fi.',
                      style: TextStyle(fontSize: 12, color: NinoDashTheme.textSecondary),
                    ),
                    const SizedBox(height: 12),

                    // Auto-scan LAN Discovery Button
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: NinoDashTheme.brandPrimary.withValues(alpha: 0.12),
                          foregroundColor: NinoDashTheme.brandPrimary,
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                            side: const BorderSide(color: NinoDashTheme.brandPrimary),
                          ),
                        ),
                        onPressed: scanning
                            ? null
                            : () async {
                                setDialogState(() {
                                  scanning = true;
                                  scanProgress = 'Đang dò tìm trạm NinoPOS trong Wi-Fi...';
                                });

                                final stations = await CloudApiClient.discoverLanPosStations(
                                  onProgress: (cur, max) {
                                    setDialogState(() {
                                      scanProgress = 'Đang quét dải mạng Wi-Fi ($cur/$max)...';
                                    });
                                  },
                                );

                                setDialogState(() {
                                  scanning = false;
                                  discoveredStations = stations;
                                  if (stations.isEmpty) {
                                    scanProgress = 'Chưa thấy trạm POS trong Wi-Fi. Vui lòng bật NinoPOS hoặc thử nhập IP thủ công.';
                                  } else {
                                    scanProgress = 'Tìm thấy ${stations.length} trạm POS!';
                                  }
                                });
                              },
                        icon: scanning
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.search, size: 18),
                        label: Text(
                          scanning ? 'Đang dò quét mạng Wi-Fi...' : '🔍 Tự động quét tìm trạm POS',
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                        ),
                      ),
                    ),

                    if (scanProgress.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(
                        scanProgress,
                        style: TextStyle(
                          fontSize: 11,
                          color: discoveredStations.isNotEmpty ? NinoDashTheme.success : NinoDashTheme.textSecondary,
                          fontWeight: discoveredStations.isNotEmpty ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                    ],

                    // Discovered stations list
                    if (discoveredStations.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      const Text(
                        'Danh sách trạm POS tìm thấy:',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 6),
                      ...discoveredStations.map(
                        (st) => Padding(
                          padding: const EdgeInsets.only(bottom: 6),
                          child: InkWell(
                            onTap: () {
                              setDialogState(() {
                                urlController.text = st.baseUrl;
                                lanMode = true;
                              });
                            },
                            borderRadius: BorderRadius.circular(8),
                            child: Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: NinoDashTheme.success.withValues(alpha: 0.08),
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(color: NinoDashTheme.success),
                              ),
                              child: Row(
                                children: [
                                  const Icon(Icons.desktop_windows, color: NinoDashTheme.success, size: 20),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          st.storeName,
                                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                                        ),
                                        Text(
                                          'IP: ${st.ip}:${st.port} (v${st.posVersion})',
                                          style: const TextStyle(fontSize: 11, color: NinoDashTheme.textSecondary),
                                        ),
                                      ],
                                    ),
                                  ),
                                  const Icon(Icons.touch_app, color: NinoDashTheme.brandPrimary, size: 18),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],

                    const Divider(height: 20),

                    // Mode switch
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        ChoiceChip(
                          label: const Text('NinoCloud Server'),
                          selected: !lanMode,
                          selectedColor: NinoDashTheme.brandPrimary.withValues(alpha: 0.15),
                          labelStyle: TextStyle(
                            color: !lanMode ? NinoDashTheme.brandPrimary : NinoDashTheme.textSecondary,
                            fontWeight: !lanMode ? FontWeight.bold : FontWeight.normal,
                            fontSize: 12,
                          ),
                          onSelected: (val) {
                            setDialogState(() {
                              lanMode = false;
                              urlController.text = 'http://10.0.2.2:3000/api/v1';
                            });
                          },
                        ),
                        ChoiceChip(
                          label: const Text('NinoPOS LAN Direct'),
                          selected: lanMode,
                          selectedColor: NinoDashTheme.brandPrimary.withValues(alpha: 0.15),
                          labelStyle: TextStyle(
                            color: lanMode ? NinoDashTheme.brandPrimary : NinoDashTheme.textSecondary,
                            fontWeight: lanMode ? FontWeight.bold : FontWeight.normal,
                            fontSize: 12,
                          ),
                          onSelected: (val) {
                            setDialogState(() {
                              lanMode = true;
                              urlController.text = 'http://192.168.1.10:8080/api/v1';
                            });
                          },
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),

                    TextField(
                      controller: urlController,
                      style: const TextStyle(fontSize: 13),
                      decoration: const InputDecoration(
                        labelText: 'Địa chỉ Base URL (REST API)',
                        hintText: 'http://192.168.1.10:3000/api/v1',
                        border: OutlineInputBorder(),
                        contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      ),
                    ),
                    const SizedBox(height: 8),

                    // Quick IP preset chips
                    const Text('Gợi ý IP kết nối nhanh:', style: TextStyle(fontSize: 11, color: NinoDashTheme.textSecondary)),
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        ActionChip(
                          label: const Text('10.0.2.2:3000 (Giả lập)', style: TextStyle(fontSize: 11)),
                          onPressed: () {
                            setDialogState(() {
                              urlController.text = 'http://10.0.2.2:3000/api/v1';
                              lanMode = false;
                            });
                          },
                        ),
                        ActionChip(
                          label: const Text('192.168.1.10:3000 (Wi-Fi)', style: TextStyle(fontSize: 11)),
                          onPressed: () {
                            setDialogState(() {
                              urlController.text = 'http://192.168.1.10:3000/api/v1';
                              lanMode = false;
                            });
                          },
                        ),
                        ActionChip(
                          label: const Text('127.0.0.1:3000 (Desktop)', style: TextStyle(fontSize: 11)),
                          onPressed: () {
                            setDialogState(() {
                              urlController.text = 'http://127.0.0.1:3000/api/v1';
                              lanMode = false;
                            });
                          },
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),

                    if (testing)
                      const Center(
                        child: Padding(
                          padding: EdgeInsets.all(8.0),
                          child: CircularProgressIndicator(),
                        ),
                      )
                    else if (testResult != null)
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: testResult!.isLive
                              ? NinoDashTheme.success.withValues(alpha: 0.12)
                              : NinoDashTheme.danger.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(
                            color: testResult!.isLive ? NinoDashTheme.success : NinoDashTheme.danger,
                          ),
                        ),
                        child: Text(
                          testResult!.message,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            color: testResult!.isLive ? NinoDashTheme.success : NinoDashTheme.danger,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              actions: [
                OutlinedButton(
                  onPressed: () async {
                    setDialogState(() => testing = true);
                    final tempClient = CloudApiClient(
                      baseUrl: urlController.text.trim(),
                      isLanMode: lanMode,
                    );
                    final res = await tempClient.testConnection();
                    setDialogState(() {
                      testing = false;
                      testResult = res;
                    });
                  },
                  child: const Text('Kiểm tra PING'),
                ),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: NinoDashTheme.brandPrimary,
                    foregroundColor: Colors.white,
                  ),
                  onPressed: () {
                    setState(() {
                      _apiClient.baseUrl = urlController.text.trim();
                      _apiClient.isLanMode = lanMode;
                      if (lanMode || urlController.text.contains(':8080')) {
                        _wsClient = DashboardWebSocketClient(
                          wsUrl: urlController.text.replaceAll('/api/v1', '').replaceAll('http://', 'ws://').replaceAll('https://', 'wss://') + '/ws/lan/tables',
                        );
                      } else {
                        _wsClient = DashboardWebSocketClient(
                          wsUrl: urlController.text.replaceAll('/api/v1', '').replaceAll('http://', 'ws://').replaceAll('https://', 'wss://') + '/ws/cloud/realtime-reports',
                        );
                      }
                      _initWebSocket();
                    });
                    Navigator.pop(context);
                    _loadData();
                  },
                  child: const Text('Lưu & Kết nối'),
                ),
              ],
            );
          },
        );
      },
    );
  }
}
