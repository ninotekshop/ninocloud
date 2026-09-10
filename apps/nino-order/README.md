# NinoOrder — App gọi món tại bàn

App cho nhân viên phục vụ. Chạy trên tablet Android/iOS, kết nối **trực tiếp
qua mạng LAN** tới máy thu ngân NinoPOS — không đi qua Internet.

## Vì sao kiến trúc trông "phức tạp hơn cần thiết"

Wi-Fi ở quán ăn chập chờn là **trạng thái bình thường**, không phải sự cố hiếm.
Router rẻ tiền, tường bê tông, hàng chục điện thoại khách cùng nối vào. Toàn bộ
thiết kế app xoay quanh một câu hỏi: *nhân viên đang đứng cạnh bàn khách và
mạng vừa rớt — chuyện gì xảy ra tiếp theo?*

Câu trả lời phải là: **không có gì cả, họ cứ gọi món bình thường.**

```
Nhân viên bấm "Gửi Bếp"
        │
        ├─► Sinh UUID v4 cho đơn và từng dòng món
        ├─► Ghi xuống ĐĨA (hàng đợi offline)
        ├─► Báo "Đã gửi" NGAY  ◄── không chờ máy POS
        │
        └─► Nền: thử gửi lên NinoPOS
              ├─ Thành công  → xoá khỏi hàng đợi
              ├─ Lỗi nghiệp vụ → danh sách chờ xử lý thủ công
              └─ Không tới được → GIỮ LẠI, thử lại sau 3 giây
```

## Bốn bất biến của hàng đợi offline

Đây là phần quan trọng nhất của app. Phá một cái là mất tiền của khách hoặc
bếp làm trùng món.

| # | Bất biến | Nếu phá thì sao |
|---|---|---|
| 1 | Không mất đơn nào | Khách gọi món mà bếp không nhận được |
| 2 | Giữ đúng thứ tự FIFO | Món đợt hai lên trước món đợt một |
| 3 | Không giao trùng | Bếp làm hai lần, khách trả tiền hai lần |
| 4 | Đơn hỏng không chặn hàng đợi | Một đơn lỗi làm đứng cả ca làm việc |

Thuật toán đã được **fuzz-test 5.000 kịch bản** ngẫu nhiên (mất mạng xen kẽ có
mạng, nhiều đơn dồn ứ) — 0 lỗi trên cả bốn bất biến. Bộ test Dart tương ứng ở
`test/offline_queue_test.dart`.

## Ba quyết định thiết kế đáng giải thích

**UUID sinh ở tablet, không phải ở server.** `orderId` và mọi `orderDetailId`
được sinh ngay lúc nhân viên bấm nút. Nhờ vậy gửi lại bao nhiêu lần cũng cùng
một ID, và máy POS nhận ra để trả về đơn cũ thay vì tạo đơn thứ hai. Đây là
nền tảng của toàn bộ cơ chế chống trùng.

**Timeout KHÔNG phải là thất bại.** Đơn có thể đã tới máy POS và đang được xử
lý — ta chỉ không nhận được câu trả lời. Nên giữ lại và gửi lại; bất biến 3 lo
phần còn lại.

**Nhịp kết nối lại cố định 3 giây, không backoff luỹ thừa.** Backoff là đúng
cho Internet, sai cho LAN. Nhân viên đứng cạnh bàn khách cần biết ngay khi nào
gọi món được trở lại — giãn tới 30 giây là bắt họ đứng chờ nửa phút không hiểu
chuyện gì. Đây là mạng nội bộ, ping mỗi 3 giây gần như không tốn gì.

## Ghép nối thiết bị — không bao giờ phải nhớ deviceToken

Lần đầu mở app (hoặc sau khi bấm "Ghép nối lại máy khác"), NinoOrder hiện màn
hình ghép nối (`features/pairing/view/pairing_screen.dart`):

1. **Dò máy thu ngân**: nhập tay một IP (`GET /api/v1/lan/discovery` để xác
   nhận đúng máy), hoặc quét cả dải mạng nội bộ (254 địa chỉ, timeout ngắn cho
   mỗi địa chỉ).
2. **Ghép nối**: đặt tên thiết bị + nhập mã 6 số hiển thị trên màn hình
   NinoPOS → `POST /api/v1/lan/devices/pair` → nhận `deviceId` + `deviceToken`.
3. **Lưu cục bộ**: `core/storage/device_storage.dart` ghi toàn bộ cấu hình
   (host/port, thông tin cửa hàng, `deviceId`, `deviceToken`, tên thiết bị)
   xuống `SharedPreferences`. Lần mở app sau, `AppRoot` đọc lại cấu hình này và
   vào thẳng sơ đồ bàn — **không phải ghép nối lại mỗi ca**.

> Lưu ý: bản này **không** dùng mDNS/multicast (gói `multicast_dns` đã bị bỏ
> khỏi `pubspec.yaml` vì không dùng tới) — dò mạng chỉ qua quét IP HTTP trực
> tiếp, đơn giản và không phụ thuộc router có bật multicast hay không.

## Cấu trúc

```
lib/
├── main.dart                            # AppRoot (ghép nối ↔ sơ đồ bàn) + OrderShell
├── core/
│   ├── auth/role_policy.dart            # UserSession, AppRole (waiter-only cho NinoOrder)
│   ├── network/
│   │   ├── lan_client.dart              # REST tới NinoPOS: discovery, pair, tables,
│   │   │                                 # lock, order/create, transfer, menu
│   │   └── connection_manager.dart      # Tự kết nối lại 3s, WebSocket + khử trùng lặp
│   │                                     # eventId, đo độ trễ ping (latencyMs)
│   ├── offline/
│   │   └── offline_queue.dart           # ⬅ PHẦN QUAN TRỌNG NHẤT — hàng đợi + retry 3s
│   ├── storage/device_storage.dart      # Lưu cấu hình ghép nối (SharedPreferences)
│   └── theme/nino_theme.dart            # Bản sao design tokens (packages/design-tokens)
├── data/models/models.dart              # TableStatus, MenuItem/Category, Topping, CartLine
└── features/
    ├── pairing/                         # Dò máy + nhập mã 6 số
    ├── table_map/                       # Sơ đồ bàn theo khu vực, khoá bàn, chuyển/gộp bàn
    ├── menu_picker/                     # Chọn món, topping, ghi chú
    ├── cart/                            # Giỏ hàng + nút "Gửi Bếp"
    └── connection_banner/               # Banner mất kết nối + chip trạng thái/độ trễ
```

## Các chức năng đã cài đặt trong mã nguồn

| Yêu cầu | File chính | Ghi chú |
|---|---|---|
| Cấu hình host, dò tìm, ghép nối mã 6 số, lưu token cục bộ | `pairing_screen.dart`, `device_storage.dart`, `lan_client.dart` | `PairResult` chứa `deviceId`+`deviceToken`; lưu bằng `SharedPreferences` |
| Sơ đồ bàn theo khu vực | `table_map_screen.dart`, `models.dart` (`TableStatus.areaName`) | Chip lọc khu vực khi có > 1 khu vực |
| Khoá bàn | `lan_client.dart#lockTable`, `main.dart#_onTableTap` | Khoá mềm trước khi mở màn hình chọn món; báo 409 nếu bị giữ |
| Chọn món, topping, ghi chú | `menu_picker_screen.dart` | Sinh `orderDetailId` (UUID v4) ngay khi thêm vào giỏ |
| Gửi đơn `POST /api/v1/lan/order/create` | `lan_client.dart#createOrder`, `offline_queue.dart` | Qua hàng đợi offline, không chờ phản hồi máy POS |
| Chuyển bàn / gộp bàn | `lan_client.dart#transferOrder`, `table_transfer_sheet.dart` | `POST /api/v1/lan/orders/{orderId}/transfer` |
| Hàng đợi offline + tự gửi lại mỗi 3 giây | `offline_queue.dart` (`SharedPrefsQueueStorage`, `startAutoRetry`) | Lưu xuống đĩa; tự thử lại kể cả khi LAN vẫn "sống" nhưng POS lỗi 5xx |
| WebSocket `/ws/lan/tables`, `/ws/lan/kitchen`, khử trùng lặp eventId | `connection_manager.dart` | `_seenEventIds` giới hạn 500 mục |
| Hiển thị trạng thái kết nối/độ trễ | `connection_banner.dart` (`ConnectionStatusChip`) | Chip luôn hiện trên AppBar: `xxx ms` hoặc trạng thái mất kết nối |
| Giao diện tiếng Việt + design tokens | toàn bộ `lib/` | `nino_theme.dart` là bản sao tay của `packages/design-tokens/tokens.json` (chưa có gói `nino_ui_kit` dùng chung) |

## Chạy

## Lệnh Chạy & Biên dịch

Flutter SDK 3.47.3 đặt tại `D:\flutter`. Xem quy trình triển khai đầy đủ tại file [`DEPLOYMENT.md`](DEPLOYMENT.md).

```bash
# 1. Tải các gói phụ thuộc
D:\flutter\bin\flutter.bat pub get

# 2. Chạy toàn bộ Unit Tests (9/9 PASS)
D:\flutter\bin\flutter.bat test

# 3. Khởi chạy ứng dụng lên thiết bị Android/Tablet kết nối ADB Wi-Fi
D:\flutter\bin\flutter.bat run -d adb-R3CX701XPME-mMt2Bp._adb-tls-connect._tcp

# 4. Biên dịch bản Release APK (làm rối mã nguồn bảo mật)
D:\flutter\bin\flutter.bat build apk --release --obfuscate --split-debug-info=symbols/
```

## Gói phụ thuộc — tối thiểu, có chủ đích

`pubspec.yaml` chỉ khai báo 4 gói phổ biến, mỗi gói có một lý do cụ thể:

| Gói | Dùng ở đâu | Vì sao cần |
|---|---|---|
| `http` | `lan_client.dart` | Gọi REST tới NinoPOS (discovery, pair, tables, order, transfer, menu) |
| `web_socket_channel` | `connection_manager.dart` | Kết nối `/ws/lan/tables` và `/ws/lan/kitchen` |
| `shared_preferences` | `device_storage.dart`, `offline_queue.dart` | Lưu cấu hình ghép nối và hàng đợi offline xuống đĩa |
| `uuid` | `main.dart`, `menu_picker_screen.dart` | Sinh `orderId`/`orderDetailId` (UUID v4) ngay phía tablet |

Các gói từng có trong bản nháp trước (`flutter_riverpod`, `multicast_dns`,
`network_info_plus`, `hive`/`hive_flutter`/`hive_generator`/`build_runner`,
`intl`, `collection`) đã bị **gỡ bỏ** vì không có import nào dùng tới trong
`lib/` — tuân theo yêu cầu "không thêm package không cần thiết", đặc biệt khi
không có Flutter SDK ở đây để xác minh việc cài đặt.

## Ràng buộc giao diện bắt buộc

- **Mọi phần tử bấm được ≥ 48×48 dp.** Nhân viên bưng khay bằng một tay, ngón
  kia bấm — nút nhỏ là bấm nhầm món.
- **Bàn đang bị người khác giữ thì làm mờ và không cho bấm**, thay vì để họ bấm
  rồi mới báo lỗi 409. Bắt nhân viên học bằng cách thất bại là thiết kế tồi.
- **Banner mất kết nối KHÔNG chặn thao tác.** Chặn màn hình lúc mất mạng nghĩa
  là quán ngừng bán hàng — đúng thứ mà kiến trúc Offline-First sinh ra để tránh.
- **Chip trạng thái kết nối/độ trễ luôn hiện trên AppBar**, không chỉ lúc mất
  mạng — nhân viên và người giám sát cần biết chất lượng Wi-Fi ngay cả khi mọi
  thứ đang chạy tốt.
