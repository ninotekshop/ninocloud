// =====================================================================
//  NINOTEK NinoOrder — Màn hình cấu hình & ghép nối với máy NinoPOS
// =====================================================================
//  Mở lần đầu tiên tablet chạy app, hoặc khi nhân viên bấm "Ghép nối lại".
//  Luồng: nhập/dò địa chỉ máy POS → xác nhận đúng máy (GET /discovery) →
//  nhập tên thiết bị + mã ghép nối 6 số hiện trên màn hình NinoPOS →
//  POST /api/v1/lan/devices/pair → nhận deviceToken.
// =====================================================================

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/network/lan_client.dart';
import '../../../core/theme/nino_theme.dart';

class PairingScreen extends StatefulWidget {
  const PairingScreen({super.key, required this.client, required this.onPaired});

  final LanClient client;

  /// Gọi khi ghép nối thành công — tầng gọi chịu trách nhiệm lưu xuống
  /// [DeviceStorage] và chuyển sang màn hình sơ đồ bàn.
  final Future<void> Function(
    LanServerInfo server,
    PairResult pairResult,
    String deviceName,
  ) onPaired;

  @override
  State<PairingScreen> createState() => _PairingScreenState();
}

class _PairingScreenState extends State<PairingScreen> {
  final _hostController = TextEditingController();
  final _subnetController = TextEditingController(text: '192.168.1');
  final _deviceNameController = TextEditingController(text: 'Tablet order');
  final _pairingCodeController = TextEditingController();

  bool _isProbing = false;
  bool _isScanning = false;
  bool _isPairing = false;
  String? _errorMessage;
  LanServerInfo? _foundServer;
  List<LanServerInfo> _scanResults = const [];

  @override
  void dispose() {
    _hostController.dispose();
    _subnetController.dispose();
    _deviceNameController.dispose();
    _pairingCodeController.dispose();
    super.dispose();
  }

  Future<void> _probeManualHost() async {
    final host = _hostController.text.trim();
    if (host.isEmpty) return;
    setState(() {
      _isProbing = true;
      _errorMessage = null;
    });
    try {
      final server = await widget.client.probe(host);
      setState(() {
        _foundServer = server;
        _errorMessage = server == null
            ? 'Không tìm thấy máy NinoPOS tại $host. Kiểm tra lại IP và mạng Wi-Fi.'
            : null;
      });
    } on ProtocolMismatchException catch (e) {
      setState(() => _errorMessage = e.toString());
    } finally {
      if (mounted) setState(() => _isProbing = false);
    }
  }

  Future<void> _scanSubnet() async {
    final prefix = _subnetController.text.trim();
    if (prefix.isEmpty) return;
    setState(() {
      _isScanning = true;
      _errorMessage = null;
      _scanResults = const [];
    });
    try {
      final results = await widget.client.scanSubnet(prefix);
      setState(() {
        _scanResults = results;
        if (results.isEmpty) {
          _errorMessage =
              'Không dò thấy máy NinoPOS nào trong dải $prefix.1-254. '
              'Thử nhập IP thủ công ở trên.';
        }
      });
    } finally {
      if (mounted) setState(() => _isScanning = false);
    }
  }

  Future<void> _submitPairing() async {
    final server = _foundServer;
    if (server == null) return;
    final code = _pairingCodeController.text.trim();
    if (code.length != 6 || int.tryParse(code) == null) {
      setState(() => _errorMessage = 'Mã ghép nối phải gồm đúng 6 chữ số.');
      return;
    }
    final deviceName = _deviceNameController.text.trim();
    if (deviceName.isEmpty) {
      setState(() => _errorMessage = 'Vui lòng đặt tên cho thiết bị này.');
      return;
    }

    setState(() {
      _isPairing = true;
      _errorMessage = null;
    });
    try {
      widget.client.configure(server, null);
      final result = await widget.client.pair(
        deviceName: deviceName,
        deviceType: 'TABLET',
        pairingCode: code,
      );
      await widget.onPaired(server, result, deviceName);
    } on LanApiException catch (e) {
      setState(() => _errorMessage = e.isConflict
          ? e.message
          : (e.statusCode == 403
              ? 'Sai mã ghép nối, hoặc máy đã đạt giới hạn số thiết bị.'
              : e.message));
    } catch (_) {
      setState(() => _errorMessage = 'Không gửi được yêu cầu ghép nối. Kiểm tra lại mạng LAN.');
    } finally {
      if (mounted) setState(() => _isPairing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Kết nối máy thu ngân'),
        backgroundColor: NinoTokens.brandPrimary,
        foregroundColor: NinoTokens.textOnPrimary,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(NinoTokens.spaceLG),
          children: [
            Center(
              child: Image.asset(
                'assets/images/logo.png',
                height: 72,
                errorBuilder: (_, __, ___) => const SizedBox.shrink(),
              ),
            ),
            const SizedBox(height: NinoTokens.spaceMD),
            const Text(
              'Bước 1 — Tìm máy thu ngân NinoPOS',
              style: TextStyle(fontSize: NinoTokens.fontSizeH2, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: NinoTokens.spaceSM),
            const Text(
              'Máy tablet và máy thu ngân phải cùng một mạng Wi-Fi quán.',
              style: TextStyle(color: NinoTokens.textSecondary),
            ),
            const SizedBox(height: NinoTokens.spaceLG),
            _buildManualHostCard(),
            const SizedBox(height: NinoTokens.spaceLG),
            _buildSubnetScanCard(),
            if (_errorMessage != null) ...[
              const SizedBox(height: NinoTokens.spaceMD),
              _ErrorBanner(message: _errorMessage!),
            ],
            if (_foundServer != null) ...[
              const SizedBox(height: NinoTokens.spaceXL),
              _buildPairingForm(_foundServer!),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildManualHostCard() => Card(
        child: Padding(
          padding: const EdgeInsets.all(NinoTokens.spaceLG),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Nhập địa chỉ IP', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: NinoTokens.spaceSM),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _hostController,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        hintText: 'Ví dụ: 192.168.1.10',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                  const SizedBox(width: NinoTokens.spaceMD),
                  SizedBox(
                    height: NinoTokens.touchTargetMinimum,
                    child: ElevatedButton(
                      onPressed: _isProbing ? null : _probeManualHost,
                      child: _isProbing
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: NinoTokens.textOnPrimary))
                          : const Text('Kiểm tra'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      );

  Widget _buildSubnetScanCard() => Card(
        child: Padding(
          padding: const EdgeInsets.all(NinoTokens.spaceLG),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Hoặc dò quét cả dải mạng', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: NinoTokens.spaceXS),
              const Text(
                '3 số đầu của IP tablet, thường trùng với máy thu ngân',
                style: TextStyle(fontSize: NinoTokens.fontSizeCaption, color: NinoTokens.textSecondary),
              ),
              const SizedBox(height: NinoTokens.spaceSM),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _subnetController,
                      decoration: const InputDecoration(
                        hintText: '192.168.1',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                  const SizedBox(width: NinoTokens.spaceMD),
                  SizedBox(
                    height: NinoTokens.touchTargetMinimum,
                    child: ElevatedButton(
                      onPressed: _isScanning ? null : _scanSubnet,
                      child: _isScanning
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: NinoTokens.textOnPrimary))
                          : const Text('Dò tìm'),
                    ),
                  ),
                ],
              ),
              if (_scanResults.isNotEmpty) ...[
                const SizedBox(height: NinoTokens.spaceMD),
                ..._scanResults.map(
                  (s) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.dns_outlined, color: NinoTokens.brandPrimary),
                    title: Text(s.storeName),
                    subtitle: Text('${s.storeCode} · ${s.host}:${s.port}'),
                    onTap: () => setState(() {
                      _foundServer = s;
                      _errorMessage = null;
                    }),
                  ),
                ),
              ],
            ],
          ),
        ),
      );

  Widget _buildPairingForm(LanServerInfo server) => Card(
        color: NinoTokens.surfaceCard,
        shape: RoundedRectangleBorder(
          side: const BorderSide(color: NinoTokens.semanticSuccess, width: 1.5),
          borderRadius: BorderRadius.circular(NinoTokens.radiusLG),
        ),
        child: Padding(
          padding: const EdgeInsets.all(NinoTokens.spaceLG),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.check_circle, color: NinoTokens.semanticSuccess),
                  const SizedBox(width: NinoTokens.spaceSM),
                  Expanded(
                    child: Text('Đã tìm thấy: ${server.storeName} (${server.storeCode})',
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ],
              ),
              const SizedBox(height: NinoTokens.spaceLG),
              const Text('Bước 2 — Ghép nối thiết bị',
                  style: TextStyle(fontSize: NinoTokens.fontSizeH3, fontWeight: FontWeight.w700)),
              const SizedBox(height: NinoTokens.spaceSM),
              TextField(
                controller: _deviceNameController,
                decoration: const InputDecoration(
                  labelText: 'Tên thiết bị',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: NinoTokens.spaceMD),
              TextField(
                controller: _pairingCodeController,
                keyboardType: TextInputType.number,
                maxLength: 6,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                ],
                style: const TextStyle(fontSize: 28, letterSpacing: 8, fontWeight: FontWeight.w700),
                textAlign: TextAlign.center,
                decoration: const InputDecoration(
                  labelText: 'Mã 6 số hiển thị trên NinoPOS',
                  border: OutlineInputBorder(),
                  counterText: '',
                ),
              ),
              const SizedBox(height: NinoTokens.spaceLG),
              SizedBox(
                width: double.infinity,
                height: NinoTokens.touchTargetLarge,
                child: ElevatedButton(
                  onPressed: _isPairing ? null : _submitPairing,
                  child: _isPairing
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: NinoTokens.textOnPrimary))
                      : const Text('Ghép nối'),
                ),
              ),
            ],
          ),
        ),
      );
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(NinoTokens.spaceMD),
        decoration: BoxDecoration(
          color: NinoTokens.semanticDanger.withOpacity(0.1),
          borderRadius: BorderRadius.circular(NinoTokens.radiusMD),
          border: Border.all(color: NinoTokens.semanticDanger.withOpacity(0.4)),
        ),
        child: Row(
          children: [
            const Icon(Icons.error_outline, color: NinoTokens.semanticDanger),
            const SizedBox(width: NinoTokens.spaceSM),
            Expanded(child: Text(message, style: const TextStyle(color: NinoTokens.semanticDanger))),
          ],
        ),
      );
}
