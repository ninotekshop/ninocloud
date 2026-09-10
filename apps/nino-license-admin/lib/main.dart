import 'dart:convert';
import 'package:crypto/crypto.dart' as crypto;
import 'package:cryptography/cryptography.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const NinoLicenseAdminApp());
}

// --- BẢNG MÀU HIỆN ĐẠI (SLATE & INDIGO) ---
const Color kBgApp = Color(0xFFF1F5F9);
const Color kBgCard = Color(0xFFFFFFFF);
const Color kPrimary = Color(0xFF2563EB);
const Color kPrimaryHover = Color(0xFF1D4ED8);
const Color kTextMain = Color(0xFF0F172A);
const Color kTextMuted = Color(0xFF64748B);
const Color kBorderColor = Color(0xFFE2E8F0);
const Color kDanger = Color(0xFFEF4444);
const Color kSuccess = Color(0xFF10B981);

// RAW ED25519 PRIVATE KEY SEED FOR NINOTEK
const String kPrivateSeedHex =
    'c6a4a8ee5c25b1e1a7489cb2d8149eba1ddbf83ce89af4dac09043b6e867085c';

class NinoLicenseAdminApp extends StatelessWidget {
  const NinoLicenseAdminApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'NinoPOS License Admin',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        scaffoldBackgroundColor: kBgApp,
        colorScheme: ColorScheme.fromSeed(
          seedColor: kPrimary,
          primary: kPrimary,
          surface: kBgCard,
        ),
        fontFamily: 'Segoe UI',
      ),
      home: const AuthGuardWrapper(),
    );
  }
}

// --- ĐĂNG NHẬP BẢO MẬT ---
class AuthGuardWrapper extends StatefulWidget {
  const AuthGuardWrapper({super.key});

  @override
  State<AuthGuardWrapper> createState() => _AuthGuardWrapperState();
}

class _AuthGuardWrapperState extends State<AuthGuardWrapper> {
  bool _isAuthenticated = false;
  final TextEditingController _pwdController = TextEditingController();
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _checkDefaultAuth();
  }

  Future<void> _checkDefaultAuth() async {
    final prefs = await SharedPreferences.getInstance();
    if (!prefs.containsKey('admin_password_hash')) {
      final defaultHash =
          crypto.sha256.convert(utf8.encode('ninotek2026')).toString();
      await prefs.setString('admin_password_hash', defaultHash);
    }
  }

  Future<void> _doLogin() async {
    final prefs = await SharedPreferences.getInstance();
    final savedHash = prefs.getString('admin_password_hash');
    final enteredHash =
        crypto.sha256.convert(utf8.encode(_pwdController.text)).toString();

    if (savedHash == enteredHash) {
      setState(() {
        _isAuthenticated = true;
        _errorMessage = null;
      });
    } else {
      setState(() {
        _errorMessage = '✕ Mật khẩu không chính xác!';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isAuthenticated) {
      return const MainAdminNavigation();
    }

    return Scaffold(
      backgroundColor: kBgApp,
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Container(
            constraints: const BoxConstraints(maxWidth: 400),
            decoration: BoxDecoration(
              color: kBgCard,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: kBorderColor),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.05),
                  blurRadius: 20,
                  offset: const Offset(0, 10),
                )
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 24),
                  decoration: const BoxDecoration(
                    color: kPrimary,
                    borderRadius:
                        BorderRadius.vertical(top: Radius.circular(16)),
                  ),
                  child: Column(
                    children: [
                      Image.asset('assets/logo.png', width: 54, height: 54),
                      const SizedBox(height: 8),
                      const Text(
                        'NinoPOS License Admin',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const Text(
                        'Xác thực quyền Quản trị viên',
                        style: TextStyle(color: Color(0xFFDBEAFE), fontSize: 12),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Mật khẩu Quản trị (Master Password)',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: kTextMain,
                        ),
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _pwdController,
                        obscureText: true,
                        decoration: InputDecoration(
                          hintText: 'Nhập mật khẩu...',
                          filled: true,
                          fillColor: const Color(0xFFF8FAFC),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                            borderSide: const BorderSide(color: kBorderColor),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                            borderSide: const BorderSide(color: kBorderColor),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                            borderSide: const BorderSide(color: kPrimary, width: 2),
                          ),
                        ),
                        onSubmitted: (_) => _doLogin(),
                      ),
                      if (_errorMessage != null) ...[
                        const SizedBox(height: 8),
                        Text(
                          _errorMessage!,
                          style: const TextStyle(color: kDanger, fontSize: 12),
                        ),
                      ],
                      const SizedBox(height: 12),
                      const Text(
                        '💡 Mật khẩu mặc định lần đầu: ninotek2026',
                        style: TextStyle(
                          color: kTextMuted,
                          fontSize: 11,
                          fontStyle: FontStyle.italic,
                        ),
                      ),
                      const SizedBox(height: 20),
                      SizedBox(
                        width: double.infinity,
                        height: 48,
                        child: ElevatedButton(
                          onPressed: _doLogin,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: kPrimary,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(8),
                            ),
                            elevation: 0,
                          ),
                          child: const Text(
                            'ĐĂNG NHẬP HỆ THỐNG',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// --- MÀN HÌNH CHÍNH TÍCH HỢP TAB ---
class MainAdminNavigation extends StatefulWidget {
  const MainAdminNavigation({super.key});

  @override
  State<MainAdminNavigation> createState() => _MainAdminNavigationState();
}

class _MainAdminNavigationState extends State<MainAdminNavigation> {
  int _currentIndex = 0;

  final List<Widget> _screens = const [
    IssueLicenseScreen(),
    TransactionHistoryScreen(),
    SettingsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Image.asset('assets/logo.png', width: 28, height: 28),
            const SizedBox(width: 8),
            const Text(
              'NinoPOS License Studio',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(width: 8),
            const Chip(
              label: Text(
                'v2.4 Mobile',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                  color: kPrimary,
                ),
              ),
              backgroundColor: Color(0xFFDBEAFE),
              padding: EdgeInsets.zero,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
          ],
        ),
        backgroundColor: kBgCard,
        elevation: 0,
        surfaceTintColor: kBgCard,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(color: kBorderColor, height: 1),
        ),
      ),
      body: IndexedStack(
        index: _currentIndex,
        children: _screens,
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentIndex,
        onTap: (index) => setState(() => _currentIndex = index),
        backgroundColor: kBgCard,
        selectedItemColor: kPrimary,
        unselectedItemColor: kTextMuted,
        selectedLabelStyle:
            const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.flash_on),
            label: 'Cấp Key',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.history),
            label: 'Lịch sử',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.settings),
            label: 'Cấu hình',
          ),
        ],
      ),
    );
  }
}

// --- TAB 1: FORM CẤP KEY & HIỂN THỊ KEY ---
class IssueLicenseScreen extends StatefulWidget {
  const IssueLicenseScreen({super.key});

  @override
  State<IssueLicenseScreen> createState() => _IssueLicenseScreenState();
}

class _IssueLicenseScreenState extends State<IssueLicenseScreen> {
  final _ownerController = TextEditingController();
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _machineController = TextEditingController();
  final _devicesController = TextEditingController(text: '3');
  final _yearsController = TextEditingController(text: '1');
  final _amountController = TextEditingController(text: '0');
  final _replacementController = TextEditingController();
  final _noteController = TextEditingController();

  String _selectedPackage = 'PRO';
  String? _lastGeneratedKey;
  String? _lastTxId;
  bool _isGenerating = false;

  List<int> _hexToBytes(String hex) {
    final bytes = <int>[];
    for (int i = 0; i < hex.length; i += 2) {
      bytes.add(int.parse(hex.substring(i, i + 2), radix: 16));
    }
    return bytes;
  }

  String _base32Encode(List<int> bytes) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    final buffer = StringBuffer();
    int bits = 0;
    int value = 0;

    for (int byte in bytes) {
      value = (value << 8) | (byte & 0xFF);
      bits += 8;
      while (bits >= 5) {
        buffer.write(alphabet[(value >> (bits - 5)) & 31]);
        bits -= 5;
      }
    }

    if (bits > 0) {
      buffer.write(alphabet[(value << (5 - bits)) & 31]);
    }

    return buffer.toString();
  }

  String _formatKey(String raw) {
    final clean = raw.replaceAll('-', '').toUpperCase();
    final buffer = StringBuffer('NINO');
    for (int i = 0; i < clean.length; i += 5) {
      buffer.write('-');
      buffer.write(clean.substring(i, i + 5 < clean.length ? i + 5 : clean.length));
    }
    return buffer.toString();
  }

  Future<void> _generateLicense() async {
    final machineId = _machineController.text.trim();
    if (machineId.length < 8) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Mã máy (Hardware ID) không hợp lệ (tối thiểu 8 ký tự).'),
          backgroundColor: kDanger,
        ),
      );
      return;
    }

    setState(() => _isGenerating = true);

    try {
      final years = int.tryParse(_yearsController.text) ?? 1;
      final devices = int.tryParse(_devicesController.text) ?? 3;
      final today = DateTime.now();
      final expiry = years == 0
          ? null
          : DateFormat('yyyy-MM-dd').format(today.add(Duration(days: 365 * years)));
      final issued = DateFormat('yyyy-MM-dd').format(today);

      final payloadMap = {
        "dev": devices,
        "exp": expiry,
        "iss": issued,
        "mid": machineId,
        "nonce": crypto.sha256.convert(utf8.encode(DateTime.now().toIso8601String())).toString().substring(0, 8).toUpperCase(),
        "pkg": _selectedPackage,
        "sid": ""
      };

      final compactJson = jsonEncode(payloadMap);
      final seedBytes = _hexToBytes(kPrivateSeedHex);

      final algorithm = Ed25519();
      final keyPair = await algorithm.newKeyPairFromSeed(seedBytes);
      final signature = await algorithm.sign(
        utf8.encode(compactJson),
        keyPair: keyPair,
      );

      final rawBytes = [...utf8.encode(compactJson), ...signature.bytes];
      final b32 = _base32Encode(rawBytes);
      final licenseKey = _formatKey(b32);

      final txId = 'TX-${DateFormat('yyyyMMdd').format(today)}-${crypto.sha256.convert(utf8.encode(DateTime.now().toIso8601String())).toString().substring(0, 8).toUpperCase()}';

      // Save Transaction to SharedPreferences
      final prefs = await SharedPreferences.getInstance();
      final recordsJson = prefs.getString('tx_records') ?? '[]';
      final List<dynamic> records = jsonDecode(recordsJson);

      final record = {
        'transaction_id': txId,
        'created_at': issued,
        'owner': _ownerController.text.trim(),
        'phone': _phoneController.text.trim(),
        'email': _emailController.text.trim(),
        'machine_id': machineId,
        'package': _selectedPackage,
        'expiry': expiry ?? 'LIFETIME',
        'max_devices': devices,
        'amount': _amountController.text.trim(),
        'replacement_of': _replacementController.text.trim(),
        'note': _noteController.text.trim(),
        'license_key': licenseKey,
        'revoked': false,
      };

      records.insert(0, record);
      await prefs.setString('tx_records', jsonEncode(records));

      setState(() {
        _lastGeneratedKey = licenseKey;
        _lastTxId = txId;
        _isGenerating = false;
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Đã cấp key thành công! Mã giao dịch: $txId'),
            backgroundColor: kSuccess,
          ),
        );
      }
    } catch (e) {
      setState(() => _isGenerating = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Lỗi khi sinh key: $e'),
            backgroundColor: kDanger,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // KEY DISPLAY CARD
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFF0F172A),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: kBorderColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.vpn_key, color: Color(0xFF38BDF8), size: 18),
                    SizedBox(width: 8),
                    Text(
                      'LICENSE KEY VỪA CẤP',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                SelectableText(
                  _lastGeneratedKey != null
                      ? '${_lastTxId!}\n${_lastGeneratedKey!}'
                      : 'Chưa có key nào vừa được cấp',
                  style: const TextStyle(
                    fontFamily: 'Consolas',
                    color: Color(0xFF38BDF8),
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                if (_lastGeneratedKey != null) ...[
                  const SizedBox(height: 12),
                  Align(
                    alignment: Alignment.centerRight,
                    child: ElevatedButton.icon(
                      onPressed: () {
                        Clipboard.setData(
                            ClipboardData(text: _lastGeneratedKey!));
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Đã sao chép License Key!'),
                            duration: Duration(seconds: 2),
                          ),
                        );
                      },
                      icon: const Icon(Icons.copy, size: 16),
                      label: const Text('Sao chép'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: kPrimary,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 8),
                      ),
                    ),
                  )
                ]
              ],
            ),
          ),
          const SizedBox(height: 16),

          // FORM CẤP KEY
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: kBgCard,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: kBorderColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'THÔNG TIN CẤP MỚI / TÁI CẤP KEY',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.bold,
                    color: kTextMain,
                  ),
                ),
                const SizedBox(height: 16),
                _buildInput('Chủ sở hữu / Đơn vị', _ownerController),
                _buildInput('Số điện thoại', _phoneController),
                _buildInput('Email nhận key', _emailController),
                _buildInput('Mã máy mới (Hardware ID)', _machineController),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Gói bản quyền',
                            style: TextStyle(fontSize: 12, color: kTextMuted),
                          ),
                          const SizedBox(height: 4),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF8FAFC),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: kBorderColor),
                            ),
                            child: DropdownButtonHideUnderline(
                              child: DropdownButton<String>(
                                value: _selectedPackage,
                                isExpanded: true,
                                items: ['PRO', 'BASIC', 'ENTERPRISE']
                                    .map((pkg) => DropdownMenuItem(
                                          value: pkg,
                                          child: Text(pkg),
                                        ))
                                    .toList(),
                                onChanged: (val) {
                                  if (val != null) {
                                    setState(() => _selectedPackage = val);
                                  }
                                },
                              ),
                            ),
                          )
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _buildInput('Thiết bị tối đa', _devicesController),
                    ),
                  ],
                ),
                Row(
                  children: [
                    Expanded(
                      child: _buildInput('Số năm (0 = vĩnh viễn)', _yearsController),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _buildInput('Giá trị (VNĐ)', _amountController),
                    ),
                  ],
                ),
                _buildInput('Cấp lại từ mã giao dịch (nếu có)', _replacementController),
                _buildInput('Ghi chú', _noteController),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _isGenerating ? null : _generateLicense,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: kPrimary,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    child: _isGenerating
                        ? const CircularProgressIndicator(color: Colors.white)
                        : const Text(
                            '⚡ CẤP KEY / TÁI CẤP KEY',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                  ),
                )
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildInput(String label, TextEditingController controller) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: kTextMuted)),
          const SizedBox(height: 4),
          TextField(
            controller: controller,
            decoration: InputDecoration(
              filled: true,
              fillColor: const Color(0xFFF8FAFC),
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: const BorderSide(color: kBorderColor),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: const BorderSide(color: kBorderColor),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// --- TAB 2: LỊCH SỬ GIAO DỊCH ---
class TransactionHistoryScreen extends StatefulWidget {
  const TransactionHistoryScreen({super.key});

  @override
  State<TransactionHistoryScreen> createState() =>
      _TransactionHistoryScreenState();
}

class _TransactionHistoryScreenState extends State<TransactionHistoryScreen> {
  List<dynamic> _records = [];

  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  Future<void> _loadHistory() async {
    final prefs = await SharedPreferences.getInstance();
    final jsonStr = prefs.getString('tx_records') ?? '[]';
    setState(() {
      _records = jsonDecode(jsonStr);
    });
  }

  Future<void> _revokeRecord(int index) async {
    final item = _records[index];
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Xác nhận hủy Key'),
        content: Text('Bạn có chắc muốn hủy key của ${item['owner']}?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Hủy bỏ'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: kDanger),
            child: const Text('Xác nhận Hủy', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirm == true) {
      item['revoked'] = true;
      item['revoked_at'] = DateFormat('yyyy-MM-dd').format(DateTime.now());
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('tx_records', jsonEncode(_records));
      _loadHistory();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_records.isEmpty) {
      return const Center(
        child: Text('Chưa có lịch sử giao dịch nào.', style: TextStyle(color: kTextMuted)),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _records.length,
      itemBuilder: (context, index) {
        final item = _records[index];
        final isRevoked = item['revoked'] == true;

        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          color: kBgCard,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
            side: const BorderSide(color: kBorderColor),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      item['transaction_id'] ?? '',
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        color: kPrimary,
                        fontSize: 13,
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: isRevoked ? const Color(0xFFFEE2E2) : const Color(0xFFD1FAE5),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        isRevoked ? '✕ Đã hủy' : '● Hiệu lực',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          color: isRevoked ? kDanger : kSuccess,
                        ),
                      ),
                    )
                  ],
                ),
                const SizedBox(height: 8),
                Text('Chủ sở hữu: ${item['owner'] ?? "N/A"}', style: const TextStyle(fontSize: 13, color: kTextMain)),
                Text('Mã máy: ${item['machine_id'] ?? "N/A"}', style: const TextStyle(fontSize: 12, color: kTextMuted)),
                Text('Gói: ${item['package']}  |  Hết hạn: ${item['expiry']}', style: const TextStyle(fontSize: 12, color: kTextMuted)),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.copy, size: 18, color: kPrimary),
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: item['license_key']));
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Đã sao chép License Key!')),
                        );
                      },
                    ),
                    if (!isRevoked)
                      TextButton.icon(
                        onPressed: () => _revokeRecord(index),
                        icon: const Icon(Icons.cancel, size: 16, color: kDanger),
                        label: const Text('Hủy Key', style: TextStyle(color: kDanger, fontSize: 12)),
                      ),
                  ],
                )
              ],
            ),
          ),
        );
      },
    );
  }
}

// --- TAB 3: CẤU HÌNH & HỆ THỐNG ---
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _oldPwdController = TextEditingController();
  final _newPwdController = TextEditingController();

  Future<void> _changePassword() async {
    final prefs = await SharedPreferences.getInstance();
    final savedHash = prefs.getString('admin_password_hash');
    final oldHash = crypto.sha256.convert(utf8.encode(_oldPwdController.text)).toString();

    if (savedHash != oldHash) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Mật khẩu hiện tại không đúng!'), backgroundColor: kDanger),
        );
      }
      return;
    }

    if (_newPwdController.text.length < 4) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Mật khẩu mới tối thiểu 4 ký tự!'), backgroundColor: kDanger),
        );
      }
      return;
    }

    final newHash = crypto.sha256.convert(utf8.encode(_newPwdController.text)).toString();
    await prefs.setString('admin_password_hash', newHash);

    _oldPwdController.clear();
    _newPwdController.clear();

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Đã cập nhật mật khẩu mới!'), backgroundColor: kSuccess),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: kBgCard,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: kBorderColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '🔒 ĐỔI MẬT KHẨU QUẢN TRỊ',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: kTextMain),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _oldPwdController,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'Mật khẩu hiện tại',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _newPwdController,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'Mật khẩu mới',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  height: 44,
                  child: ElevatedButton(
                    onPressed: _changePassword,
                    style: ElevatedButton.styleFrom(backgroundColor: kPrimary),
                    child: const Text('Cập nhật Mật khẩu', style: TextStyle(color: Colors.white)),
                  ),
                )
              ],
            ),
          )
        ],
      ),
    );
  }
}
