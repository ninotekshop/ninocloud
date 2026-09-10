# NinoPOS License Admin

Ứng dụng nội bộ cho Admin/NINOTEK để quản lý chủ sở hữu, giao dịch, cấp key mới và cấp lại key khi khách hàng đổi máy.

```powershell
python tools\license-admin\license_admin.py
```

`transactions.json` chứa thông tin giao dịch nội bộ và license key, không gửi cho khách hàng. Private key nằm trong `tools\license-generator\keys` và đã được loại khỏi Git.

Sau khi cấp key, ứng dụng tự động gửi email đầy đủ thông tin bản quyền đến địa chỉ Email của khách hàng. Chọn **Cấu hình email SMTP** trước lần cấp đầu tiên; nên dùng App Password của Gmail/Outlook thay vì mật khẩu chính. Cấu hình được lưu cục bộ trong `smtp_settings.json` và đã được loại khỏi Git.

Để thu hồi key, chọn giao dịch trong bảng lịch sử rồi bấm **Hủy key đã chọn**. License Admin sẽ tạo `revocations.json` có chữ ký Ed25519. Đưa file này lên một URL HTTPS ổn định, sau đó nhập URL đó trong NinoPOS tại **Cấu hình > Bản quyền phần mềm**. NinoPOS sẽ kiểm tra danh sách đã ký khi có mạng; nếu key bị thu hồi, khách hàng sẽ bị khóa ở lần kiểm tra tiếp theo.
