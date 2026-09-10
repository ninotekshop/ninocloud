import 'dart:convert';
import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';

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

void main() {
  test('Test Ed25519 and Base32 License Generation', () async {
    const seedHex = 'c6a4a8ee5c25b1e1a7489cb2d8149eba1ddbf83ce89af4dac09043b6e867085c';
    final seed = _hexToBytes(seedHex);

    final payload = {
      "dev": 3,
      "exp": "2027-09-10",
      "iss": "2026-09-08",
      "mid": "BFEBFBFF000906EA-A0369F2C",
      "nonce": "TEST1234",
      "pkg": "PRO",
      "sid": ""
    };

    final compactJson = jsonEncode(payload);
    expect(compactJson, '{"dev":3,"exp":"2027-09-10","iss":"2026-09-08","mid":"BFEBFBFF000906EA-A0369F2C","nonce":"TEST1234","pkg":"PRO","sid":""}');

    final algorithm = Ed25519();
    final keyPair = await algorithm.newKeyPairFromSeed(seed);
    final signature = await algorithm.sign(
      utf8.encode(compactJson),
      keyPair: keyPair,
    );

    final rawBytes = [...utf8.encode(compactJson), ...signature.bytes];
    final b32 = _base32Encode(rawBytes);
    final formattedKey = _formatKey(b32);

    expect(formattedKey.startsWith('NINO-'), isTrue);
    print('Generated Key: $formattedKey');
  });
}
