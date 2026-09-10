# Khoá công khai xác thực License

Thư mục này phải chứa **`ninotek_public.pem`** — khoá công khai Ed25519 được
nhúng thẳng vào `NinoPOS.exe` để xác thực License Key offline.

## Cách tạo (chỉ làm MỘT LẦN, trên máy công ty)

```bash
cd tools/license-generator
python ninotek_license.py genkeys --passphrase "<mật khẩu mạnh>"
cp keys/ninotek_public.pem ../../apps/nino-pos/src/Ninotek.POS.Licensing/Keys/
```

## Ba điều bắt buộc

1. **`ninotek_private.pem` không bao giờ rời khỏi server Ninotek.**
   Đã chặn trong `.gitignore`. Lộ file này = toàn bộ sản phẩm bị crack, và
   không có cách nào thu hồi các key giả đã bị tạo ra.

2. **Backup private key vào két sắt hoặc password manager của công ty.**
   Mất nó = không cấp được key cho bất kỳ khách hàng mới nào nữa, và phải
   phát hành lại toàn bộ license cũ.

3. **Sinh lại cặp khoá sẽ vô hiệu hoá MỌI license đã bán.**
   Chỉ làm khi private key thực sự bị lộ, và phải có kế hoạch cấp lại key
   cho toàn bộ khách hàng hiện hữu trước khi làm.

> Repository này cố ý **không** chứa sẵn cặp khoá nào. Một public key đi kèm
> sẵn sẽ tương ứng với private key mà bạn không giữ — vô dụng, và tệ hơn là
> dễ khiến người ta tưởng hệ thống đã cấu hình xong.
