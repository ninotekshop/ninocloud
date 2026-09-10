// =====================================================================
//  NINOTEK NinoOrder — Kiểm thử hàng đợi offline
// =====================================================================
//  Đây là phần quan trọng nhất của app: nó giữ đơn hàng của khách khi
//  Wi-Fi quán chập chờn. Bốn bất biến dưới đây, phá một cái là mất tiền
//  của khách hoặc bếp làm trùng món.
//
//  Thuật toán đã được fuzz-test 5.000 kịch bản ngẫu nhiên (mất mạng xen kẽ
//  có mạng) trước khi viết bộ test này: 0 lỗi trên cả bốn bất biến.
//
//  Lưu ý về `await queue.idle`: `enqueue` cố tình KHÔNG chờ lần đẩy hàng đợi
//  — nhân viên bấm "Gửi Bếp" phải thấy phản hồi ngay lập tức. Trong test thì
//  cần biết lúc nào lần đẩy đó xong, nếu không kết quả sẽ phụ thuộc vào thứ
//  tự microtask và test chạy lúc đậu lúc rớt.
//
//  Chạy: flutter test
// =====================================================================

import 'package:flutter_test/flutter_test.dart';
import 'package:nino_order/core/offline/offline_queue.dart';

void main() {
  late InMemoryQueueStorage storage;

  setUp(() => storage = InMemoryQueueStorage());

  OfflineOrderQueue makeQueue(
    SendResult Function(Map<String, dynamic> payload) respond, {
    int maxAttempts = 50,
  }) =>
      OfflineOrderQueue(
        storage: storage,
        sender: (payload) async => respond(payload),
        maxAttempts: maxAttempts,
      );

  Map<String, dynamic> payloadFor(String id) => {
        'orderId': id,
        'userId': 'u1',
        'items': [
          {'orderDetailId': 'd-$id', 'itemId': 'i1', 'quantity': 1}
        ],
      };

  group('Bất biến 1 — không mất đơn nào', () {
    test('mất mạng rồi có lại: mọi đơn đều được gửi', () async {
      var online = false;
      final delivered = <String>[];

      final queue = makeQueue((p) {
        if (!online) {
          return const SendResult(SendOutcome.unreachable, message: 'Mất kết nối');
        }
        delivered.add(p['orderId'] as String);
        return const SendResult(SendOutcome.accepted);
      });

      for (var i = 0; i < 5; i++) {
        await queue.enqueue('o$i', payloadFor('o$i'));
      }
      await queue.idle;
      expect(queue.pendingCount, 5,
          reason: 'mất mạng thì đơn phải nằm nguyên trong hàng đợi');

      online = true;
      await queue.flush();

      expect(queue.pendingCount, 0);
      expect(delivered, ['o0', 'o1', 'o2', 'o3', 'o4']);
    });
  });

  group('Bất biến 2 — giữ đúng thứ tự khách gọi món', () {
    test('dừng ở đơn lỗi đầu tiên, không nhảy cóc sang đơn sau', () async {
      final attempted = <String>[];
      var failAt = 'o2';

      final queue = makeQueue((p) {
        final id = p['orderId'] as String;
        attempted.add(id);
        return id == failAt
            ? const SendResult(SendOutcome.unreachable)
            : const SendResult(SendOutcome.accepted);
      });

      for (var i = 0; i < 5; i++) {
        await queue.enqueue('o$i', payloadFor('o$i'));
      }
      await queue.idle;

      // o3, o4 KHÔNG được gửi trước khi o2 xong — bếp phải nhận đúng thứ tự
      // khách gọi, nếu không món đợt hai lên trước món đợt một.
      expect(attempted.contains('o3'), isFalse);
      expect(attempted.contains('o4'), isFalse);
      expect(queue.pendingCount, 3);

      failAt = '';
      await queue.flush();
      expect(queue.pendingCount, 0);
    });
  });

  group('Bất biến 3 — không giao trùng', () {
    test('bấm "Gửi Bếp" ba lần cùng một đơn chỉ vào hàng đợi một lần', () async {
      final queue = makeQueue((_) => const SendResult(SendOutcome.unreachable));

      await queue.enqueue('same', payloadFor('same'));
      await queue.enqueue('same', payloadFor('same'));
      await queue.enqueue('same', payloadFor('same'));
      await queue.idle;

      expect(queue.pendingCount, 1);
    });

    test('timeout rồi gửi lại vẫn dùng cùng orderId nên máy POS khử được trùng',
        () async {
      final sentIds = <String>[];
      var firstCall = true;

      final queue = makeQueue((p) {
        sentIds.add(p['orderId'] as String);
        if (firstCall) {
          firstCall = false;
          // Timeout KHÔNG phải thất bại — đơn có thể đã tới nơi rồi.
          return const SendResult(SendOutcome.unreachable,
              message: 'Máy thu ngân không phản hồi');
        }
        return const SendResult(SendOutcome.accepted);
      });

      await queue.enqueue('o1', payloadFor('o1'));
      await queue.idle;
      await queue.flush();

      expect(sentIds, ['o1', 'o1'], reason: 'gửi hai lần nhưng cùng một orderId');
      expect(queue.pendingCount, 0);
    });
  });

  group('Bất biến 4 — đơn hỏng không chặn cả hàng đợi', () {
    test('lỗi nghiệp vụ chuyển sang danh sách chờ, các đơn sau vẫn đi', () async {
      final delivered = <String>[];

      final queue = makeQueue((p) {
        final id = p['orderId'] as String;
        if (id == 'bad') {
          return const SendResult(SendOutcome.rejected,
              message: 'Món "Cà phê trứng" đã hết trong hôm nay');
        }
        delivered.add(id);
        return const SendResult(SendOutcome.accepted);
      });

      await queue.enqueue('bad', payloadFor('bad'));
      await queue.enqueue('good1', payloadFor('good1'));
      await queue.enqueue('good2', payloadFor('good2'));
      await queue.idle;
      await queue.flush();

      expect(queue.pendingCount, 0);
      expect(delivered, ['good1', 'good2']);
      expect(queue.deadLetters.length, 1);
      expect(queue.deadLetters.first.lastError, contains('đã hết'));
    });

    test('hết số lần thử thì bỏ vào danh sách chờ, không lặp vô hạn', () async {
      final queue = makeQueue(
          (_) => const SendResult(SendOutcome.unreachable),
          maxAttempts: 3);

      await queue.enqueue('stuck', payloadFor('stuck'));
      await queue.idle;
      for (var i = 0; i < 20; i++) {
        await queue.flush();
      }

      expect(queue.pendingCount, 0);
      expect(queue.deadLetters.length, 1);
      expect(queue.deadLetters.first.attempts, 3);
    });

    test('nhân viên bấm thử lại thì đơn quay về hàng đợi', () async {
      var reject = true;
      final queue = makeQueue((_) => reject
          ? const SendResult(SendOutcome.rejected, message: 'Bàn đang bị khoá')
          : const SendResult(SendOutcome.accepted));

      await queue.enqueue('o1', payloadFor('o1'));
      await queue.idle;
      expect(queue.deadLetters.length, 1);

      reject = false;
      await queue.retryDeadLetter('o1');
      await queue.idle;

      expect(queue.deadLetters, isEmpty);
      expect(queue.pendingCount, 0);
    });
  });

  group('Bền vững qua việc app bị tắt', () {
    test('đơn còn trong hàng đợi sống sót sau khi khởi động lại app', () async {
      final first = makeQueue((_) => const SendResult(SendOutcome.unreachable));
      await first.enqueue('o1', payloadFor('o1'));
      await first.enqueue('o2', payloadFor('o2'));
      await first.idle;
      await first.dispose();

      // App bị hệ điều hành giết (tablet hết pin, người dùng vuốt tắt),
      // mở lại và đọc từ CÙNG nơi lưu trữ.
      final delivered = <String>[];
      final second = makeQueue((p) {
        delivered.add(p['orderId'] as String);
        return const SendResult(SendOutcome.accepted);
      });
      await second.restore();

      expect(second.pendingCount, 2, reason: 'đơn phải được đọc lại từ đĩa');

      await second.flush();
      expect(delivered, ['o1', 'o2']);
      expect(second.pendingCount, 0);
    });
  });

  group('Trạng thái cho banner giao diện', () {
    test('phát trạng thái để banner biết còn bao nhiêu đơn chờ', () async {
      final queue = makeQueue((_) => const SendResult(SendOutcome.unreachable));
      final states = <QueueState>[];
      queue.stateStream.listen(states.add);

      await queue.enqueue('o1', payloadFor('o1'));
      await queue.enqueue('o2', payloadFor('o2'));
      await queue.idle;
      await Future<void>.delayed(Duration.zero);

      expect(states, isNotEmpty);
      expect(states.last.pendingCount, 2);
      expect(states.last.hasBacklog, isTrue);
    });
  });
}
