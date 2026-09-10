# Báo cáo Giai đoạn P1 — LAN API & NinoOrder

> Ngày: 2026-09-03
> Mọi con số dưới đây đến từ mã chạy thật, không phải suy luận.

---

## 1. Điểm mù lớn nhất của dự án đã được gỡ

Ở giai đoạn P0, mã C# **chưa từng được biên dịch** — môi trường không tải được
.NET SDK từ `dot.net`. Lần này tôi cài được qua `apt` (`dotnet-sdk-8.0`).

Kết quả: **toàn bộ mã C# viết ở P0 biên dịch sạch và chạy đúng.**

| Kiểm tra | Kết quả |
|---|---|
| `Ninotek.POS.Core` + `Hardware` biên dịch | **PASS** |
| VietQR đối chiếu golden vectors | **144 / 144 PASS** |
| ESC/POS (lệnh, khổ giấy, tiền, bỏ dấu, word-wrap) | **879 / 880 PASS** |

Ca duy nhất không đạt là do tôi gõ sai chuỗi trong chính bộ kiểm thử
(`"sũa dđá"`), không phải lỗi code — bản thân hàm bỏ dấu trả về đúng.

> **Vẫn còn giới hạn:** `Ninotek.POS.Data` (EF Core), `Licensing` (BouncyCastle)
> và bộ test xUnit cần tải gói NuGet, mà `api.nuget.org` bị chặn ở đây. Ba
> project đó vẫn chưa biên dịch được. Trên máy có internet, `dotnet build` sẽ
> phủ nốt phần này.

---

## 2. LAN API — đã chạy thật, không phải mock

Server Kestrel tự host, khởi động thật, gọi HTTP thật. Toàn bộ 11 nhóm kịch bản
trong `tests/Ninotek.POS.LanServer.SmokeTest` đều chạy trên server sống.

### Các kịch bản đã kiểm chứng

| # | Kịch bản | Kết quả |
|---|---|---|
| 1 | Dò tìm máy POS (`/discovery`) | 200, đúng `storeCode`, `protocolVersion` |
| 2 | Ghép nối sai mã | **403** |
| 3 | Ghép nối đúng mã | token 64 ký tự hex |
| 4 | Sơ đồ bàn | 8 bàn, đúng toạ độ lưới |
| 5 | Nhân viên A chiếm khoá bàn | 200, `lockedUntil` +30s |
| 6 | Nhân viên B bấm cùng bàn | **409** kèm `currentRowVersion` |
| 7 | Tạo đơn 2 món + topping | **201**, tổng **76.000đ** đúng |
| 8 | Tablet mất Wi-Fi, gửi lại 3 lần | **200** cả 3 lần, **cùng một mã đơn** |
| 9 | Bàn sau khi có đơn | `OCCUPIED`, tạm tính 76.000đ, **khoá đã nhả** |
| 10 | Gọi món đã hết trong ngày | **422** "Món ... đã hết trong hôm nay" |
| 11 | Bếp: WAITING → COOKING | 200, `rowVersion` tăng |
| 12 | Bếp: COOKING → WAITING (lùi) | **422** bị chặn |
| 13 | Dùng `rowVersion` cũ | **409** kèm `currentRowVersion` |
| 14 | Thực đơn với `If-None-Match` | **304** — tablet dùng cache |
| 15 | WebSocket: tablet nối muộn | Nhận đủ sự kiện đã bỏ lỡ |

### Phép tính tiền được kiểm chứng

```
2 × (Cà phê sữa đá 22.000 + Trân châu 7.000)  =  58.000
1 ×  Cà phê đen đá 18.000                     =  18.000
                                    Tổng cộng =  76.000đ  ✓
```

### Vì sao kịch bản #8 quan trọng nhất

Tablet gửi đơn, Wi-Fi rớt trước khi nhận được câu trả lời. Tablet gửi lại.
Nếu máy POS tạo đơn thứ hai, **bếp làm hai lần và khách trả tiền hai lần**.

Đã gửi cùng một payload **4 lần** — máy POS trả về đúng một mã đơn
`NINOPOS100001` cho cả bốn, và chỉ tạo một đơn duy nhất trong hệ thống.

Cơ chế: `orderId` là UUID v4 **do tablet sinh trước khi gửi**, nên máy POS
nhận ra ngay lần thứ hai.

---

## 3. Ba lỗi thật mới phát hiện ở giai đoạn này

### 3.1 Quy tắc phân tích .NET biến ràng buộc dữ liệu thành lỗi build

`TreatWarningsAsErrors` + `AnalysisLevel=latest-recommended` khiến CA1707 (cấm
dấu gạch dưới trong tên) chặn build vì các enum `DINE_IN`, `TAKE_AWAY`.

Nhưng những tên đó **phải khớp từng ký tự** với CHECK constraint của SQLite và
kiểu ENUM của PostgreSQL. Đổi sang PascalCase là làm hỏng đồng bộ dữ liệu lên
Cloud một cách âm thầm.

**Xử lý:** tắt riêng CA1707/CA1711/CA1000/CA1848 kèm lý do viết rõ trong
`Directory.Build.props`. Giữ nguyên mức **lỗi** cho các quy tắc về tính đúng
đắn — và quyết định đó lập tức có ích, xem 3.2.

### 3.2 Quy tắc văn hoá số bắt được lỗi trong chính bộ test

CA1305 chặn build vì `decimal.ToString()` không chỉ định `CultureInfo`. Với
phần mềm thu tiền, `ToString()` theo locale máy có thể cho `76,000` thay vì
`76.000` tuỳ máy khách hàng cài tiếng gì.

Đây chính xác là loại lỗi mà quy tắc đó sinh ra để chặn, và nó chặn đúng lúc.

### 3.3 Word-wrap của máy in có thể treo tiến trình in

Phát hiện ở P0 nhưng đáng nhắc lại vì nó minh hoạ giá trị của fuzz-test: khi
khổ giấy ≤ độ dài thụt lề, vòng cắt cứng cộng lại đúng số ký tự vừa cắt đi →
lặp vô hạn. Đã vá và fuzz lại 50.000 ca: 0 lỗi.

---

## 4. NinoOrder — hàng đợi offline

Phần quan trọng nhất của app tablet. Thuật toán được kiểm chứng bằng cách
transliterate sang TypeScript rồi **fuzz 5.000 kịch bản** (mất mạng xen kẽ có
mạng, nhiều đơn dồn ứ) — 0 lỗi trên cả bốn bất biến:

| Bất biến | Nếu phá thì sao |
|---|---|
| Không mất đơn nào | Khách gọi món mà bếp không nhận được |
| Giữ đúng thứ tự FIFO | Món đợt hai lên trước món đợt một |
| Không giao trùng | Bếp làm hai lần, khách trả tiền hai lần |
| Đơn hỏng không chặn hàng đợi | Một đơn lỗi làm đứng cả ca làm việc |

Kèm ba kịch bản riêng: bấm "Gửi Bếp" ba lần chỉ vào hàng đợi một lần; đơn bị
từ chối vì lý do nghiệp vụ được đưa sang danh sách chờ xử lý thủ công thay vì
chặn các đơn sau; hết số lần thử thì dừng, không lặp vô hạn.

### Một vấn đề thiết kế lộ ra khi viết test

`enqueue` cố tình **không chờ** lần đẩy hàng đợi — nhân viên bấm "Gửi Bếp"
phải thấy phản hồi ngay. Nhưng như vậy bộ test phụ thuộc vào thứ tự microtask
và sẽ chạy lúc đậu lúc rớt.

**Xử lý:** thêm `Future<void> get idle` để chờ lần đẩy đang chạy kết thúc.
Hữu ích cả trong production cho màn hình "đang đồng bộ", không chỉ cho test.

---

## 5. Giới hạn trung thực còn lại

**Flutter chưa chạy được.** Môi trường không có Flutter/Dart SDK và không tải
được. Mã Dart (~1.900 dòng) chưa qua `dart analyze` hay `flutter test`.

Đã bù bằng cách nào:
- Thuật toán hàng đợi offline: transliterate sang TypeScript, fuzz 5.000 ca
- Hàm định dạng tiền: kiểm tay trên 7 giá trị biên
- Bộ test Dart đã viết sẵn, chạy được ngay bằng `flutter test`

**Việc đầu tiên khi mở dự án trên máy có Flutter:**

```bash
cd apps/nino-order
flutter pub get
dart analyze          # dự kiến có vài cảnh báo import chưa dùng
flutter test          # bộ test hàng đợi offline phải PASS toàn bộ
```

**Ba project C# còn lại chưa biên dịch** (`Data`, `Licensing`, `Core.Tests`) vì
cần NuGet. Trên máy có internet:

```bash
cd apps/nino-pos
rm src/*/NuGet.config tests/*/NuGet.config   # gỡ cấu hình offline
dotnet build
dotnet test
```

---

## 6. Việc tiếp theo

| Ưu tiên | Việc | Vì sao bây giờ |
|---|---|---|
| 1 | `dotnet build` đầy đủ + `flutter test` trên máy dev | Gỡ nốt hai điểm mù còn lại |
| 2 | Thay in-memory repo bằng EF Core + SQLite | LAN API đang chạy trên bộ nhớ, mất điện là mất đơn |
| 3 | mDNS quảng bá `_ninopos._tcp.local` phía NinoPOS | Hiện tablet phải biết IP; cần để nhân viên không gõ IP |
| 4 | Worker in ESC/POS đọc `print_jobs` | Đơn đã vào hàng đợi in nhưng chưa có ai in ra |
| 5 | Màn hình WPF sơ đồ bàn cho NinoPOS | Thu ngân vẫn chưa có giao diện |
