Bảng ma trận phân quyền chi tiết cho tài khoản Thu ngân (Cashier) và Nhân viên phục vụ (Waiter) theo chuẩn vận hành nhà hàng, quán nhậu, cafe:

| Nhóm nghiệp vụ | Quyền hạn / Thao tác chi tiết | Nhân viên phục vụ (Waiter) | Thu ngân (Cashier) | Quản trị viên (Admin) |
| :---- | :---- | :---- | :---- | :---- |
| 1\. Sơ đồ bàn & Đặt bàn | Xem trạng thái bàn (trống, có khách, chờ bill) | Cho phép | Cho phép | Cho phép |
|  | Mở bàn mới / Đổi trạng thái bàn | Cho phép | Cho phép | Cho phép |
|  | Nhận đặt cọc / Giữ bàn trước (Reservation) | ❌ Không | Cho phép | Cho phép |
|  | Thêm / Xóa / Đổi vị trí cấu hình bàn | ❌ Không | ❌ Không | Cho phép |
| 2\. Bán hàng & Gọi món (Order) | Tìm kiếm món, thêm món vào bàn | Cho phép | Cho phép | Cho phép |
|  | Thêm ghi chú bếp (ít đường, không cay, làm nhanh) | Cho phép | Cho phép | Cho phép |
|  | Báo chế biến xuống Bếp / Bar | Cho phép | Cho phép | Cho phép |
|  | Tự ý xóa món chưa gửi bếp | Cho phép | Cho phép | Cho phép |
|  | Hủy món / Giảm số lượng sau khi đã gửi bếp | ❌ Cần Admin duyệt | ❌ Cần Admin duyệt | Cho phép |
|  | Chuyển bàn (Move Table) | Cho phép | Cho phép | Cho phép |
|  | Gộp bàn / Tách đơn (Merge/Split) | Cho phép | Cho phép | Cho phép |
| 3\. Thanh toán & Hóa đơn | In phiếu tạm tính (Pre-print Bill / F8) | Cho phép | Cho phép | Cho phép |
|  | Áp dụng chiết khấu / Giảm giá (%) / Voucher | ❌ Không | Cho phép (theo hạn mức) | Cho phép |
|  | Chỉnh sửa giá bán trực tiếp trên đơn | ❌ Không | ❌ Không | Cho phép |
|  | Thu tiền (Tiền mặt, Quét VietQR, Quẹt thẻ) | ❌ Không | Cho phép | Cho phép |
|  | Lệnh mở két tiền thu ngân (F10 / Kích xung RJ11) | ❌ Không | Cho phép | Cho phép |
|  | Hủy hóa đơn đã hoàn tất thanh toán (Void Bill) | ❌ Không | ❌ Không | Cho phép |
|  | In lại hóa đơn cũ (Re-print Bill) | ❌ Không | Cho phép | Cho phép |
| 4\. Quản lý ca (Shifts) | Đăng nhập nhanh bằng mã PIN cá nhân | Cho phép | Cho phép | Cho phép |
|  | Khai báo tiền quỹ đầu ca | ❌ Không | Cho phép | Cho phép |
|  | Kết ca, kiểm đếm tiền mặt & bàn giao doanh thu | ❌ Không | Cho phép | Cho phép |
| 5\. Kho hàng & Báo cáo | Xem giá vốn / Giá nhập hàng | ❌ Không | ❌ Không | Cho phép |
|  | Thêm / Sửa / Xóa thực đơn & định mức tồn kho | ❌ Không | ❌ Không | Cho phép |
|  | Xem báo cáo doanh thu theo ngày / tháng / năm | ❌ Không | ❌ Chỉ xem ca hiện tại | Cho phép |
|  | Xuất dữ liệu báo cáo ra file Excel | ❌ Không | ❌ Không | Cho phép |
| 6\. Cấu hình hệ thống | Thiết lập máy in K80, máy in Bếp | ❌ Không | ❌ Không | Cho phép |
|  | Cấu hình tài khoản nhận tiền VietQR | ❌ Không | ❌ Không | Cho phép |
|  | Quản lý, cấp mã PIN, khóa tài khoản nhân viên | ❌ Không | ❌ Không | Cho phép |

Các điểm chốt chặn kiểm soát gian lận (Anti-fraud Controls) cần lưu ý:

* Hủy món sau khi gửi bếp: Phục vụ không được quyền tự hủy món đã xuống bếp để tránh việc đem món cho khách dùng nhưng xóa món nhằm biển thủ tiền. Muốn hủy bắt buộc nhập mã PIN duyệt của Admin/Quản lý.  
* Két tiền tự động: Két tiền RJ11 chỉ được mở tự động khi Thu ngân bấm xác nhận thanh toán hoặc bấm phím tắt F10 (hành động mở két thủ công phải được ghi lại trong nhật ký lịch sử).  
* Giảm giá/Chiết khấu: Nên giới hạn Thu ngân chỉ được chiết khấu tối đa (ví dụ ≤ 10%), vượt quá định mức này phải chuyển quyền cho Admin phê duyệt.  
* Tích hợp cửa sổ pop-up yêu cầu Nhập mã PIN Quản lý (Admin Override) mỗi khi Thu ngân hoặc Phục vụ thao tác vào các hành động bị cấm (như Hủy món đã gửi bếp hay Sửa hóa đơn).