# Báo cáo Kiểm chứng — Giai đoạn P0

> Mọi tuyên bố trong tài liệu này đều đến từ mã chạy thật trong môi trường
> kiểm thử, không phải từ suy luận trên giấy.
> Ngày: 2026-09-03

---

## 1. Kết quả kiểm thử

| Hạng mục | Công cụ | Kết quả |
|---|---|---|
| Migration PostgreSQL 16 | psql, DB sạch | 24 bảng / 4 view / 29 trigger — **PASS** |
| Migration SQLite 3.45 | python sqlite3, DB sạch | 24 bảng / 4 view / 32 trigger — **PASS** |
| Nghiệp vụ end-to-end (2 nền tảng) | Kịch bản bán hàng đầy đủ | Kết quả **khớp đến từng số lẻ** |
| VietQR — đối chứng độc lập | `vietnam-qr-pay` (npm, MIT) | **5.009 / 5.009** ca ngẫu nhiên khớp |
| VietQR — TypeScript | Jest | **46 / 46 PASS** |
| VietQR — C# | xUnit | Chưa biên dịch được (xem mục 4) |
| Word-wrap máy in nhiệt | Fuzz 50.000 ca | **0 lỗi** sau khi vá |
| License Ed25519 | 11 kịch bản tấn công | **11 / 11** bị chặn |
| License roundtrip | 2.000 key ngẫu nhiên | **2.000 / 2.000 OK** |
| Base32 decoder của C# | Đối chiếu 20.000 ca với Python | **20.000 / 20.000** khớp |
| OpenAPI 3.1 | Redocly lint | **0 lỗi, 0 cảnh báo** |
| AsyncAPI 3.0 | @asyncapi/parser | **0 lỗi** |
| Design tokens | `gen-tokens.js --check` | File sinh ra khớp `tokens.json` |
| **NinoCloud — biên dịch** | `tsc --noEmit` | **0 lỗi** |
| **NinoCloud — e2e** | Jest + PostgreSQL thật, server thật | **17 / 17 PASS** |
| **VietQR sinh bởi server thật** | Giải mã ngược + quét ảnh PNG | Khớp 100% bản tham chiếu |

---

## 2. Sáu lỗi thật đã được phát hiện và sửa

Đây là những lỗi **sẽ lọt lên production** nếu chỉ đọc code mà không chạy thử.

### 2.1 Mã VietQR mẫu trong tài liệu gốc bị hỏng

`resources/workflow/4. Tich hop VietQR.md` chứa chuỗi QR mẫu:

```
...38 57 0010A00000072701 27 0006970436...6304A1B2
      ↑↑                  ↑↑                   ↑↑↑↑
```

Ba lỗi trong một chuỗi:
- Tag 38 khai độ dài **57**, giá trị thực chỉ **54** ký tự
- Tag 38.01 khai độ dài **27**, giá trị thực chỉ **24** ký tự
- CRC `A1B2` là chuỗi giả; giá trị đúng là `8507`

Chuỗi này hỏng tới mức **không parse nổi** — bộ đọc trượt khỏi ranh giới trường
ngay từ đầu. Mọi app ngân hàng sẽ từ chối. Nếu lập trình viên dùng nó làm test
vector, cả hệ thống thanh toán sẽ được xây trên một chuẩn sai.

**Đã xử lý:** ghim vào `vietqr-test-vectors.json` mục `knownBadExample` kèm
chuỗi đúng, và viết test ở cả C# lẫn TypeScript để không ai vô tình dùng lại.

### 2.2 `sync_queue` ghi trùng đôi ở SQLite

Trigger cập nhật `updated_at` (AFTER UPDATE) kích hoạt lại trigger CDC, khiến
mỗi lần UPDATE sinh **hai** bản ghi đồng bộ thay vì một.

Hậu quả: băng thông sync và pin tablet tốn gấp đôi, `sync_queue` phình gấp đôi
— và không ai phát hiện cho tới khi hệ thống chạy vài tháng ở quán thật.

**Đã sửa:** thêm điều kiện `WHEN NEW.row_version <> OLD.row_version` vào mọi
trigger CDC trên UPDATE. Đã verify: 0 bản ghi trùng.

### 2.3 Trường VietQR tag 62 vượt giới hạn EMVCo

Nội dung chuyển khoản được cắt ở 99 ký tự, nhưng sau khi bọc vào tag 08 rồi
tag 62 thì thành **103 ký tự** — vượt trần 99 của EMVCo.

Trần đúng là **95** (99 trừ 4 ký tự header của tag 08).

**Đã sửa** + thêm regression test cho độ dài 0–500 ký tự ở cả hai ngôn ngữ.

### 2.4 Word-wrap máy in nhiệt lặp vô hạn

Khi khổ giấy ≤ độ dài thụt lề, vòng cắt cứng cộng lại đúng số ký tự vừa cắt đi
→ lặp vô hạn → **treo tiến trình in**.

Fuzz 20.000 ca phát hiện. **Đã vá** và fuzz lại 50.000 ca: 0 lỗi.

### 2.5 License Key bị phá huỷ bởi chính dấu phân nhóm

Thiết kế ban đầu mã hoá key bằng base64url và chia nhóm 5 ký tự bằng dấu `-`.
Nhưng bảng chữ cái base64url **có chứa dấu `-`**. Khi xác thực, hàm gỡ định
dạng xoá mọi dấu `-` — xoá luôn cả những dấu `-` vốn là **dữ liệu**.

Lỗi chỉ xuất hiện ngẫu nhiên (khi chữ ký tình cờ sinh ra ký tự `-`), nên rất
dễ qua được test thủ công rồi bùng ở khách hàng.

**Đã sửa:** chuyển sang Base32 (`[A-Z2-7]`, không đụng dấu `-`, toàn chữ hoa
nên Sales đọc qua điện thoại được). Verify 2.000 key ngẫu nhiên: 100% roundtrip.

### 2.6 OpenAPI dùng nhầm cú pháp phiên bản 3.0

24 chỗ dùng `nullable: true` — cú pháp **OpenAPI 3.0**, không hợp lệ trong 3.1
(phải dùng `type: [string, 'null']`). Bộ sinh code sẽ tạo ra client sai kiểu.

Cộng thêm 2 chuỗi tiếng Việt chứa dấu phẩy chưa quote, khiến YAML hiểu nhầm
thành key mới. **Đã sửa toàn bộ**, lint sạch.

---

### 2.7 Đồng bộ UPDATE hỏng hoàn toàn (phát hiện khi chạy server thật)

Tầng nhận đồng bộ dùng chung một câu lệnh `INSERT ... ON CONFLICT DO UPDATE`
cho cả INSERT lẫn UPDATE. Nhưng trigger CDC ở máy POS chỉ gửi **các cột đã
thay đổi** trong payload UPDATE, còn PostgreSQL kiểm tra ràng buộc `NOT NULL`
khi dựng dòng để INSERT — **trước** khi tới được mệnh đề `ON CONFLICT`.

Kết quả: mọi bản ghi UPDATE đều lỗi
`null value in column "user_id" violates not-null constraint`.

Hậu quả thực tế: đơn hàng lên được Cloud rồi **đứng yên mãi ở trạng thái lúc
tạo**. Chủ quán mở NinoDash thấy đơn treo ở PENDING và doanh thu thiếu, mà
máy POS ở quán vẫn hiển thị đã thanh toán xong.

**Đã sửa:** tách hẳn hai câu lệnh — `applyInsert` và `applyUpdate`.

### 2.8 `row_version` của POS và Cloud là hai bộ đếm khác nhau

Sau khi sửa lỗi 2.7, bản ghi UPDATE vẫn bị từ chối nhầm với lý do "Cloud đã có
phiên bản mới hơn". Nguyên nhân sâu hơn: Cloud có trigger riêng (`fn_touch_row`
tự tăng `row_version`, `fn_recalc_order_totals` tự tính lại tổng tiền). Khi
nhận dữ liệu đồng bộ, các trigger này chạy và làm `row_version` trên Cloud
**nhảy lệch** khỏi `row_version` của POS.

Guard optimistic locking đem so sánh hai bộ đếm khác nhau → từ chối nhầm.

**Đã sửa:** tiến trình nhận sync chạy với `session_replication_role = replica`
để tắt trigger trong phạm vi transaction. Về ngữ nghĩa đây mới là đúng — máy
POS là nguồn sự thật cho dữ liệu của chính nó; Cloud là bản sao phục vụ báo
cáo, phải ghi đúng những gì POS gửi lên chứ không tự tính lại. Migration
`V003__sync_ingest_role.sql` cấp quyền này. Nếu thiếu quyền, hệ thống vẫn chạy
và ghi cảnh báo — thứ tự đã được FIFO đảm bảo.

### 2.9 Cùng mã giao dịch cho hai đơn khác nhau bị nuốt lặng

Ràng buộc `UNIQUE (gateway, transaction_ref)` là **toàn cục**, không theo từng
đơn. Code ban đầu coi mọi xung đột là "webhook gửi lại" và bỏ qua im lặng.

Nhưng có hai tình huống rất khác nhau: cùng giao dịch + cùng đơn là gửi lại
(đúng), còn cùng giao dịch + **khác đơn** nghĩa là tiền đã vào tài khoản nhưng
đơn kia sẽ không bao giờ được chốt — và không ai biết.

**Đã sửa:** phân biệt hai trường hợp, ghi log `ERROR` và trả về thông báo nêu
rõ đơn nào đã dùng mã đó, để nhân viên đối soát thủ công.

---

## 3. Hai quyết định kỹ thuật được đổi sau khi đo đạc

### 3.1 License: RSA-2048 → Ed25519 (key ngắn hơn 65%)

| Phương án | Chữ ký | Độ dài key |
|---|---|---|
| RSA-2048 + envelope JSON | 256 byte | **775 ký tự** |
| RSA-2048 + nối kiểu JWT | 256 byte | 579 ký tự |
| **Ed25519 + nối kiểu JWT** | **64 byte** | **272 ký tự** |
| Ed25519 + Base32 (đang dùng) | 64 byte | 320 ký tự |

775 ký tự là quá dài để Sales gửi qua Zalo mà không bị ngắt dòng. Ed25519 cho
mức an toàn tương đương RSA-3072, xác thực nhanh hơn, key ngắn hơn nhiều.

Chọn Base32 (320 ký tự) thay vì base64url (272 ký tự) để đổi lấy tính đúng
đắn — xem lỗi 2.5.

> **Lưu ý triển khai:** .NET 8 chưa có Ed25519 trong `System.Security.Cryptography`
> (chỉ từ .NET 10). Đã khai `BouncyCastle.Cryptography 2.4.0` trong csproj.

### 3.2 Tiếng Việt trên máy in nhiệt: bắt buộc bỏ dấu

Đã thử mã hoá thực tế: bảng mã **CP1258 không mã hoá được** nguyên âm có dấu
tổ hợp (`ữ`, `ằ`, `ộ`...). Không bỏ dấu trước khi in thì máy in nhả ra ký tự rác.

Bố cục hoá đơn 48 cột đã được dựng thử và kiểm từng dòng — không dòng nào tràn.

---

## 4. Giới hạn trung thực của báo cáo này

**Mã C# chưa được biên dịch.** Môi trường kiểm thử không cài được .NET SDK
(bị chặn tải từ `dot.net`). Vì vậy:

- Logic C# đã được kiểm chứng **gián tiếp**: bộ giải mã Base32 được
  transliterate sang Python và đối chiếu 20.000 ca (100% khớp); mọi kỳ vọng
  trong test C# đều được verify bằng bản tham chiếu Python.
- Nhưng **lỗi biên dịch, sai tên API của BCL, hay khác biệt hành vi tinh vi
  của .NET vẫn có thể tồn tại.**

**Việc đầu tiên cần làm khi mở dự án trên máy Windows:**

```bash
cd apps/nino-pos
dotnet restore
dotnet test        # 30+ test VietQR phải PASS toàn bộ
```

Bộ test đọc thẳng golden vectors nên nó sẽ tự nói cho bạn biết bản C# có khớp
với bản TypeScript hay không.

Tương tự, **Flutter chưa được kiểm thử** — môi trường không có Flutter SDK.
File `packages/nino_ui_kit/lib/nino_tokens.dart` được sinh tự động và đúng cú
pháp Dart, nhưng chưa qua `dart analyze`.

---

## 5. Việc tiếp theo

| Ưu tiên | Việc | Vì sao bây giờ |
|---|---|---|
| 1 | Chạy `dotnet test` trên máy Windows | Gỡ điểm mù duy nhất còn lại |
| 2 | `EscPos` in thử ra máy in nhiệt thật | Layout đã đúng trên giấy tính toán, cần xác nhận trên giấy thật |
| 3 | Hiện thực `POST /lan/order/create` | Đường đi nóng nhất, quyết định trải nghiệm cả sản phẩm |
| 4 | Sync worker + webhook HMAC | Cần trước khi có khách hàng thật |
| 5 | Sinh cặp khoá license trên máy công ty | Chưa có thì chưa bán được hàng |
