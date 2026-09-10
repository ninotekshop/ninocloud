import 'package:flutter_test/flutter_test.dart';
import 'package:nino_dash/main.dart';

void main() {
  testWidgets('NinoDashApp renders correctly', (WidgetTester tester) async {
    await tester.pumpWidget(const NinoDashApp());
    await tester.pump(const Duration(seconds: 1));
    expect(find.textContaining('Ninotek'), findsWidgets);
  });
}
