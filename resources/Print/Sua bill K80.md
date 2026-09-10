Nếu bạn đang xây dựng một ứng dụng POS hoàn toàn mới từ đầu, việc chọn kiến trúc HTML/CSS Template \+ Microsoft WebView2 là hướng đi hiện đại, linh hoạt và tiết kiệm thời gian nhất hiện nay. Nó vượt trội hoàn toàn so với các engine cũ (như Crystal Reports hay viết tay mã GDI+).  
Dưới đây là bản thiết kế kiến trúc chuẩn cho module quản lý & in bill K80 bạn nên áp dụng:

### **1\. Sơ đồ kiến trúc Module In Bill**

Plaintext  
┌────────────────────────────────────────────────────────┐  
│                   ỨNG DỤNG DESKTOP                     │  
│                                                        │  
│  \[Màn hình Quản trị Mẫu in\]                           │  
│     │                                                  │  
│     ├── Trình Editor WYSIWYG (TinyMCE)                 │  
│     │   └─ Giới hạn khung hình chuẩn 72mm              │  
│     │   └─ Nút bấm chèn "Biến động" (Token)            │  
│     │                                                  │  
│     └── \[Database / File JSON\] (Lưu template HTML)     │  
│                                                        │  
│  \[Khi bấm Thanh toán / In Bill\]                        │  
│     │                                                  │  
│     ├── 1\. Lấy dữ liệu đơn hàng (JSON/Object)          │  
│     ├── 2\. Render Template (Scriban / Handlebars)      │  
│     └── 3\. Đưa HTML vào WebView2 ẩn (Silent Print)    │  
│                                       │                │  
└───────────────────────────────────────┼────────────────┘  
                                        ▼  
                             \[Máy in hóa đơn K80\]

### **2\. Chọn Template Engine phía Backend (C\# / .NET)**

Để người dùng vừa có thể sửa chữ tĩnh (như "Cảm ơn quý khách", "Wifi") vừa lặp danh sách món ăn một cách an toàn mà không làm lỗi cú pháp, giải pháp chuẩn nhất là dùng Scriban hoặc Handlebars.Net (cài qua NuGet).  
Ví dụ đoạn template lưu trong database:

HTML  
\<div class="header"\>  
    \<h3\>{{ store\_name }}\</h3\>  
    \<p\>{{ store\_address }}\</p\>  
\</div\>  
\<div class="divider"\>\</div\>  
\<table\>  
    {{ for item in items }}  
    \<tr\>  
        \<td\>{{ item.name }}\</td\>  
        \<td class="center"\>{{ item.quantity }}\</td\>  
        \<td class="right"\>{{ item.total | math.format "N0" }}\</td\>  
    \</tr\>  
    {{ end }}  
\</table\>  
\<div class="divider"\>\</div\>  
\<p class="total"\>TỔNG CỘNG: {{ total\_amount | math.format "N0" }} đ\</p\>

### **3\. Thiết kế màn hình Editor (UX tối ưu cho Bill K80)**

Khi nhúng trình soạn thảo vào ứng dụng, bạn nên xây dựng giao diện gồm 2 cột:

1. Cột trái (Danh sách biến \- Tokens): Liệt kê các nút bấm:  
2. \[+ Tên quán\] ({{ store\_name }})  
3. \[+ Bảng món ăn\] (Bảng mẫu chứa vòng lặp)  
4. \[+ Tổng tiền\] ({{ total\_amount }})  
5. \[+ Mã VietQR\] ({{ qr\_code\_url }})  
6. Khi người dùng click vào nút, chèn trực tiếp thẻ biến đó vào vị trí con trỏ chuột trong Editor.  
7. Cột phải (Khung soạn thảo TinyMCE):  
8. Đặt khung viền màu trắng mô phỏng cuộn giấy, chiều rộng cố định đúng 72mm.  
9. Người dùng gõ text, đổi font, căn giữa tiêu đề, chỉnh dòng kẻ nét đứt giống hệt như đang dùng Word.

### **4\. Triển khai In ngầm (Silent Print) qua WebView2**

Khi thanh toán xong, ứng dụng cần đẩy lệnh in ngay lập tức mà không làm gián đoạn hay hiện popup chọn máy in của Windows:

C\#  
using Microsoft.Web.WebView2.Core;

public async Task SilentPrintBill(string finalHtml, string printerName)  
{  
    // Tạo một WebView2 ngầm hoặc dùng một instance đã khởi tạo sẵn  
    var webView \= new Microsoft.Web.WebView2.WinForms.WebView2();  
    await webView.EnsureCoreWebView2Async();

    // Nạp HTML hoàn chỉnh đã trộn dữ liệu  
    webView.NavigateToString(finalHtml);

    // Đợi trang nạp xong DOM  
    webView.NavigationCompleted \+= async (s, e) \=\>  
    {  
        var printSettings \= webView.CoreWebView2.Environment.CreatePrintSettings();  
        printSettings.PrinterName \= printerName; // Tên máy in K80 (USB / LAN)  
        printSettings.ShouldPrintBackgrounds \= true;  
        printSettings.HeaderAndFooter \= false;  // Tắt header/footer mặc định của trình duyệt (URL, ngày tháng)  
          
        // Căn lề \= 0 để đầu in nhiệt in hết mép giấy  
        printSettings.MarginTop \= 0;  
        printSettings.MarginBottom \= 0;  
        printSettings.MarginLeft \= 0;  
        printSettings.MarginRight \= 0;

        // In trực tiếp không hiện hộp thoại Windows  
        await webView.CoreWebView2.PrintAsync(printSettings);  
          
        webView.Dispose();  
    };  
}

### **5\. Gợi ý công nghệ bạn nên chốt cho dự án**

| Thành phần | Đề xuất tối ưu | Lý do |
| :---- | :---- | :---- |
| Desktop Framework | .NET 8 / 9 (WPF hoặc WinForms) | Nhẹ, tương thích cao với Windows 10/11 trên các máy POS cảm ứng. |
| Trình duyệt nhúng | Microsoft WebView2 | Tận dụng nhân Chromium có sẵn trên Windows, tốc độ render HTML/CSS cực nhanh. |
| Trình sửa HTML | TinyMCE (Self-hosted) | Giao diện thân thiện, dễ tùy biến thanh công cụ, hỗ trợ bàn phím ảo tốt. |
| Template Engine | Scriban (.NET) | Tốc độ phân tích chuỗi cực nhanh, cú pháp thân thiện, an toàn không gây crash app. |

