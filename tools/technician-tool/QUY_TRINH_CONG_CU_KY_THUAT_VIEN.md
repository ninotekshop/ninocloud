# Quy trình sử dụng Công cụ kỹ thuật viên NinoPOS

## 1. Mục đích

Công cụ kỹ thuật viên hỗ trợ:

- Xác thực kỹ thuật viên bằng khóa bí mật.
- Xem danh sách tài khoản ở dạng metadata không nhạy cảm.
- Tạo mã khôi phục mật khẩu Admin dùng một lần.

Công cụ **không hiển thị, không đọc và không khôi phục mật khẩu dạng rõ** của bất kỳ tài khoản nào.

## 2. Thông tin được hiển thị

Sau khi xác thực thành công, công cụ chỉ hiển thị:

- Họ tên.
- Tên tài khoản.
- Vai trò.
- Trạng thái.
- Ngày tạo tài khoản.

Mật khẩu và mã PIN không được trả về giao diện công cụ.

## 3. Chuẩn bị khóa kỹ thuật viên

Khóa được đọc từ biến môi trường:

```text
NINOPOS_TECHNICIAN_KEY
```

Không lưu khóa trong mã nguồn, file cấu hình của repository, ảnh chụp màn hình hoặc tin nhắn không an toàn.

### Cấu hình tạm thời cho phiên PowerShell hiện tại

```powershell
$env:NINOPOS_TECHNICIAN_KEY = "chuoi-bi-mat-dai-va-ngau-nhien"
```

### Cấu hình lâu dài cho tài khoản Windows hiện tại

```powershell
[Environment]::SetEnvironmentVariable(
  "NINOPOS_TECHNICIAN_KEY",
  "chuoi-bi-mat-dai-va-ngau-nhien",
  "User"
)
```

Sau khi cấu hình ở cấp `User`, phải đóng và mở lại PowerShell hoặc VS Code để tiến trình mới nhận biến môi trường.

Kiểm tra trạng thái mà không hiển thị giá trị khóa:

```powershell
$value = [Environment]::GetEnvironmentVariable(
  "NINOPOS_TECHNICIAN_KEY",
  "User"
)
if ([string]::IsNullOrEmpty($value)) {
  "Chưa cấu hình"
} else {
  "Đã cấu hình"
}
```

## 4. Khởi chạy công cụ

Mở PowerShell mới, chuyển đến thư mục công cụ và chạy:

```powershell
Set-Location "D:\Projects\NinoPOS\tools\technician-tool"
npm start
```

Nếu khóa đã lưu ở biến môi trường `User` nhưng phiên hiện tại chưa nhận biến, có thể nạp khóa vào phiên trước khi chạy mà không in khóa ra màn hình:

```powershell
$key = [Environment]::GetEnvironmentVariable(
  "NINOPOS_TECHNICIAN_KEY",
  "User"
)
if ([string]::IsNullOrEmpty($key)) {
  throw "NINOPOS_TECHNICIAN_KEY chưa được cấu hình ở cấp User."
}
$env:NINOPOS_TECHNICIAN_KEY = $key
Set-Location "D:\Projects\NinoPOS\tools\technician-tool"
npm start
```

## 5. Xác thực kỹ thuật viên

1. Mở cửa sổ **Công cụ kỹ thuật viên**.
2. Nhập đúng khóa kỹ thuật viên đã cấu hình.
3. Nhấn **Xác thực**.
4. Nếu thành công, danh sách tài khoản NinoPOS được tải tự động.

Nếu xuất hiện thông báo:

```text
Khóa kỹ thuật viên không đúng hoặc chưa được cấu hình.
```

hãy kiểm tra:

- Khóa nhập vào có đúng tuyệt đối không, bao gồm chữ hoa, chữ thường và ký tự đặc biệt.
- Biến có tồn tại trong đúng phiên chạy ứng dụng không.
- PowerShell/VS Code đã được mở lại sau khi lưu biến cấp `User` chưa.
- Công cụ có được chạy từ đúng thư mục không.

## 6. Xem danh sách tài khoản

Sau khi xác thực, công cụ tải danh sách tài khoản từ cơ sở dữ liệu NinoPOS đang dùng trên máy:

```text
%APPDATA%\ninopos-desktop\pos_data.db
```

Danh sách chỉ phục vụ nhận diện tài khoản và kiểm tra trạng thái. Không có chức năng xem mật khẩu.

## 7. Tạo mã reset Admin

Thực hiện khi Admin cần đặt lại mật khẩu:

1. Xác thực kỹ thuật viên.
2. Kiểm tra đúng tài khoản/khách hàng cần hỗ trợ.
3. Nhấn **Tạo mã reset Admin**.
4. Ghi nhận mã trong kênh hỗ trợ an toàn hoặc bàn giao trực tiếp cho người có thẩm quyền.
5. Không gửi mã qua kênh công khai hoặc lưu vào nơi không kiểm soát.

Đặc điểm mã:

- Được tạo ngẫu nhiên.
- Chỉ có hiệu lực trong **15 phút**.
- Chỉ sử dụng được **một lần**.
- Mã mới sẽ thay thế mã reset trước đó.
- Công cụ tự sao chép mã vào clipboard sau khi tạo.

## 8. Đặt lại mật khẩu Admin trong NinoPOS

1. Mở ứng dụng NinoPOS.
2. Tại màn hình đăng nhập, chọn **Quên mật khẩu Admin?**
3. Nhập mã reset vừa tạo.
4. Nhập mật khẩu Admin mới.
5. Gửi biểu mẫu đặt lại mật khẩu.
6. Đăng nhập lại bằng mật khẩu mới.

Mật khẩu mới phải có ít nhất 6 ký tự. Sau khi đặt lại thành công:

- Mã reset bị vô hiệu hóa ngay lập tức.
- Mã không thể dùng lại.
- Sự kiện được ghi vào audit log của NinoPOS.

## 9. Kết thúc phiên hỗ trợ

- Đóng Công cụ kỹ thuật viên.
- Xóa mã reset khỏi clipboard nếu đã sao chép.
- Không lưu khóa kỹ thuật viên hoặc mật khẩu khách hàng vào file log.
- Chỉ ghi nhận việc hỗ trợ theo quy trình ticket/audit nội bộ.

## 10. Quyền hạn và giới hạn kỹ thuật

Công cụ hiện dùng khóa bí mật trong biến môi trường để xác thực. Người có khóa có thể xem metadata tài khoản và tạo mã reset Admin, vì vậy khóa phải được bảo vệ như thông tin đặc quyền.

Công cụ không thay thế quy trình xác minh danh tính khách hàng. Trước khi tạo mã reset, kỹ thuật viên cần xác nhận yêu cầu hỗ trợ theo quy định nội bộ.

## 11. Lệnh chạy nhanh

```powershell
$key = [Environment]::GetEnvironmentVariable("NINOPOS_TECHNICIAN_KEY", "User")
if ([string]::IsNullOrEmpty($key)) {
  throw "Chưa cấu hình khóa kỹ thuật viên."
}
$env:NINOPOS_TECHNICIAN_KEY = $key
Set-Location "D:\Projects\NinoPOS\tools\technician-tool"
npm start
```
