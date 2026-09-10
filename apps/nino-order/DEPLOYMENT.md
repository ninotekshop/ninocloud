# Quy trình Triển khai Ứng dụng NinoOrder (Tablet / Android / iOS)

> **Ninotek NinoOrder — App Gọi Món Tại Bàn Cho Nhân Viên Phục Vụ**  
> Tài liệu hướng dẫn chi tiết quy trình đóng gói, biên dịch, lắp đặt và ghép nối ứng dụng NinoOrder từ mã nguồn tới thiết bị thực tế.

---

## 1. Yêu cầu Môi trường & Chuẩn bị

### Máy tính đóng gói (Build Machine)
- **Flutter SDK**: Phiên bản `3.47.3` trở lên (đặt tại `D:\flutter`).
- **Java Development Kit (JDK)**: JDK 17 (Microsoft JDK 17 hoặc Android Studio JBR).
- **Android SDK**: Android API 35/36, Build-Tools `35.0.0`.
- **Hệ điều hành**: Windows 10/11 x64.

### Thiết bị đầu cuối (Target Devices)
- **Thiết bị**: Máy tính bảng (Tablet) Android/iOS hoặc điện thoại thông minh Android (Android 8.0 / API 26 trở lên).
- **Kết nối mạng**: Kết nối chung dải mạng Wi-Fi LAN nội bộ với máy thu ngân `NinoPOS`.

---

## 2. Quy trình 1 — Chuẩn bị Tài nguyên & Logo Thương hiệu

Logo biểu tượng ứng dụng chính thức nằm tại:
`D:\Projects\NinoPOS\resources\UI - Logo - Mockup\Logo\NinoOrder_logo_nobkg.png`

### Cập nhật App Launcher Icons (Android Mipmap)
Chạy script Python để sinh đầy đủ bộ biểu tượng ứng dụng chuẩn kích thước Android:

```powershell
python scratch/generate_app_icons.py
```

*Các kích thước tự động sinh ra:*
- `mipmap-mdpi/ic_launcher.png` (48x48 px)
- `mipmap-hdpi/ic_launcher.png` (72x72 px)
- `mipmap-xhdpi/ic_launcher.png` (96x96 px)
- `mipmap-xxhdpi/ic_launcher.png` (144x144 px)
- `mipmap-xxxhdpi/ic_launcher.png` (192x192 px)

### Cập nhật Logo Giao diện (`assets/images/logo.png`)
Logo giao diện hiển thị tại màn hình ghép nối khởi chạy được sao chép vào:
`apps/nino-order/assets/images/logo.png` và khai báo trong `pubspec.yaml`.

---

## 3. Quy trình 2 — Kiểm thử Mã nguồn & Hàng đợi Offline

Trước khi đóng gói, thực hiện kiểm thử tự động để đảm bảo 100% logic hàng đợi offline và giao tiếp LAN không bị lỗi:

```powershell
# 1. Chuyển vào thư mục ứng dụng
cd D:\Projects\NinoPOS\apps\nino-order

# 2. Tải dependencies
D:\flutter\bin\flutter.bat pub get

# 3. Chạy toàn bộ Unit Tests
D:\flutter\bin\flutter.bat test
```

*Tiêu chuẩn đạt*: **9/9 test cases PASS** (xác minh 4 bất biến offline queue: không mất đơn, giữ thứ tự FIFO, không giao trùng, đơn hỏng không tắc hàng đợi).

---

## 4. Quy trình 3 — Biên dịch Gói ứng dụng (Build Release APK / Bundle)

### Biên dịch APK Debug (Kiểm thử nhanh tại quán)
```powershell
D:\flutter\bin\flutter.bat build apk --debug
```
*Tệp đầu ra*: `build/app/outputs/flutter-apk/app-debug.apk`

### Biên dịch APK Release (Phân phối chính thức)
Thực hiện làm rối mã nguồn (Obfuscation) bảo mật theo tiêu chuẩn bản quyền Ninotek:

```powershell
D:\flutter\bin\flutter.bat build apk --release --obfuscate --split-debug-info=symbols/
```
*Tệp đầu ra*: `build/app/outputs/flutter-apk/app-release.apk`

---

## 5. Quy trình 4 — Lắp đặt Ứng dụng lên Tablet / Điện thoại

### Cách 1: Nạp qua Cáp USB Debugging
1. Bật **Cài đặt cho nhà phát triển** và **Gỡ lỗi USB** trên tablet.
2. Cắm cáp kết nối tablet với máy tính.
3. Chạy lệnh nạp APK:
   ```powershell
   adb install -r build/app/outputs/flutter-apk/app-release.apk
   ```

### Cách 2: Nạp qua Wi-Fi Debugging (Không cần cáp)
1. Kết nối tablet và máy tính cùng mạng Wi-Fi.
2. Bật **Gỡ lỗi không dây (Wireless Debugging)** trên Android.
3. Kết nối ADB qua IP:
   ```powershell
   adb connect <IP_TABLET>:5555
   adb install -r build/app/outputs/flutter-apk/app-release.apk
   ```

---

## 6. Quy trình 5 — Cấu hình Ghép nối với Trạm Thu Ngân (NinoPOS)

1. **Bật Trạm Thu Ngân `NinoPOS`**:
   - Mở ứng dụng `NinoPOS` trên máy tính thu ngân.
   - Đảm bảo LAN Server đang hoạt động ngầm tại địa chỉ IP máy tính (ví dụ: `192.168.1.77`, Cổng `8080`).

2. **Cấu hình trên Tablet `NinoOrder`**:
   - Mở app `NinoOrder` vừa nạp trên tablet.
   - Tại màn hình **Bước 1 — Tìm máy thu ngân**: Nhập IP `192.168.1.77` -> Bấm **Kiểm tra**.
   - Tại màn hình **Bước 2 — Ghép nối thiết bị**:
     - Nhập Tên thiết bị: `Tablet Tầng 1`
     - Nhập Mã ghép nối 6 số: **`123456`**
     - Bấm **Ghép nối**.

3. **Xác nhận trạng thái hoạt động**:
   - Màn hình tự động chuyển tới **Sơ đồ bàn thời gian thực**.
   - Quan sát chip kết nối trên AppBar: Hiển thị chấm xanh kèm độ trễ round-trip (ví dụ: `12 ms`).
   - Mọi thao tác chọn món, ghi chú (`ít đường`, `không cay`...), chuyển bàn, gộp bàn lập tức đồng bộ về POS và máy in bếp.
