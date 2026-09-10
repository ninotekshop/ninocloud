# Đưa Ninotek PoS lên Hostinger — ninotekpos.com

Tài liệu này gồm hai phần tách rời nhau:

1. **Cấu hình Hostinger Connector** — nối Claude Code với tài khoản Hostinger để
   xem và sửa DNS, VPS bằng câu lệnh thay vì bấm tay trong hPanel.
2. **Triển khai thật** — các bước đưa `ninotekpos.com` lên chạy.

Làm được phần 2 mà không cần phần 1; connector chỉ để đỡ phải bấm tay.

> **Nguyên tắc về khoá và mật khẩu.** Tôi không nhập khoá API, mật khẩu hay
> thông tin thanh toán của bạn vào bất cứ đâu, và bạn cũng đừng dán chúng vào
> khung chat. Những bước cần khoá đều ghi rõ là *bạn tự làm*.

---

## 0. Hiện trạng (đọc từ tài khoản Hostinger ngày 20/08/2026)

| Thứ | Giá trị thật | Tình trạng |
|---|---|---|
| VPS | `srv1917625.hstgr.cloud` · KVM 1 · Ubuntu 24.04 LTS | Đang chạy |
| Cấu hình | 1 CPU · 4 GB RAM · 50 GB đĩa | Đủ dùng |
| IP của VPS | `187.52.122.31` | Đây là IP cần trỏ DNS về |
| DNS `@` | A → `187.52.122.31` TTL 3600 | ✅ Đã sửa 20/08/2026 |
| DNS `*` (wildcard) | A → `187.52.122.31` TTL 3600 | ✅ Đã thêm 20/08/2026 |
| DNS `www` | CNAME → `ninotekpos.com.` | Giữ nguyên |

**DNS đã xong và đã lan ra ngoài** — `ninotekpos.com`, `www`, và mọi tên miền
con (đã thử `caphesang`, `bat-ky-ten-nao`) đều phân giải về `187.52.122.31`.

Giá trị trước khi sửa, phòng khi cần hoàn tác: `@ A 2.57.91.91 TTL 50`.

Còn lại: VPS mới dựng, chưa cài gì — làm tiếp từ mục 3.2.

---

## 1. Trước khi bắt đầu — kiểm tra bạn đang có gì

Ninotek PoS là ứng dụng Node.js chạy thường trú, cần **VPS**. Gói *Web Hosting*
(shared) của Hostinger chỉ chạy PHP tĩnh, **không chạy được** ứng dụng này.

| Thứ cần có | Kiểm ở đâu | Ghi chú |
|---|---|---|
| Tên miền `ninotekpos.com` | hPanel › Domains | Đã có |
| VPS (KVM 1 trở lên) | hPanel › VPS | Cần ≥ 1 GB RAM, Ubuntu 22.04/24.04 |
| Quyền sửa DNS | hPanel › Domains › DNS / Nameservers | Tên miền phải trỏ về nameserver của Hostinger |

Chưa có VPS thì mua gói KVM 1; hai bản ghi DNS ở mục 3.1 vẫn tạo được ngay từ bây giờ.

---

## 2. Cấu hình Hostinger Connector

Hostinger có sẵn máy chủ MCP chính thức: `hostinger-api-mcp`
([github.com/hostinger/api-mcp-server](https://github.com/hostinger/api-mcp-server)).
Nối vào rồi thì Claude Code đọc và sửa được DNS, VPS, tường lửa của bạn.

### 2.1. Cài đặt

Cần Node.js 24 trở lên — máy bạn đang chạy v24.19, đủ điều kiện.

```bash
npm install -g hostinger-api-mcp
```

Gói này cài nhiều lệnh tách theo phạm vi, **chọn hẹp nhất đủ dùng**:

| Lệnh | Phạm vi | Có cần cho việc này không |
|---|---|---|
| `hostinger-dns-mcp` | Bản ghi DNS | **Có** — tạo A và wildcard |
| `hostinger-vps-mcp` | Máy chủ ảo, tường lửa, ảnh chụp | **Có** — dựng và trông máy chủ |
| `hostinger-domains-mcp` | Mua, gia hạn, chuyển tên miền | Không |
| `hostinger-api-mcp` | Tất cả, gồm cả **thanh toán** | Không nên — rộng quá mức cần |

### 2.2. Đăng nhập

Có hai cách. **Nên dùng cách 1.**

**Cách 1 — đăng nhập qua trình duyệt (khuyến nghị).**

```bash
hostinger-dns-mcp --login
```

Lệnh này mở trình duyệt để bạn đăng nhập Hostinger, rồi cất thông tin đăng nhập
vào `%APPDATA%\hostinger-mcp\credentials.json`. **Không có khoá nào nằm trong
file cấu hình của dự án**, nên không sợ lỡ tay commit lên Git. Thông tin đăng
nhập dùng chung cho mọi lệnh `hostinger-*-mcp`.

Gỡ bỏ khi cần: `hostinger-dns-mcp --logout`

**Cách 2 — khoá API.** Vào hPanel › **API** để tạo khoá, rồi đặt vào biến môi
trường `HOSTINGER_API_TOKEN`. Chỉ dùng khi máy chủ không mở được trình duyệt.
Khoá nằm trong file văn bản là khoá có thể bị lộ theo file — nếu chọn cách này,
nhớ để `.mcp.json` trong `.gitignore`.

### 2.3. Khai vào dự án

> **Đã làm xong ngày 20/08/2026.** File `.mcp.json` ở gốc dự án đang giữ đúng
> nội dung dưới đây; `.gitignore` đã chặn nên nó không lên Git.

```json
{
  "mcpServers": {
    "hostinger-dns": { "command": "hostinger-dns-mcp" },
    "hostinger-vps": { "command": "hostinger-vps-mcp" }
  }
}
```

Khởi động lại Claude Code, chấp thuận máy chủ MCP mới khi được hỏi.

**Khai ở đâu.** Ba chỗ khai được, chọn một:

| Chỗ khai | Phạm vi | Khi nào nên dùng |
|---|---|---|
| `.mcp.json` ở gốc dự án | Chỉ dự án này | **Đang dùng** — connector chỉ bật khi làm việc với Ninotek PoS |
| `%USERPROFILE%\.claude.json` → `mcpServers` | Toàn máy, mọi dự án | Khi quản nhiều dự án trên cùng tài khoản Hostinger |
| `.claude/settings.local.json` | Chỉ dự án, chỉ máy này | Khi không muốn khai này đi theo mã nguồn |

**Đừng để khoá API trong bất kỳ file nào ở trên.** Đăng nhập bằng OAuth (mục
2.2) thì khoá nằm ngoài dự án, không lo lỡ tay commit.

### 2.4. Kiểm tra đã nối được chưa

Bảo Claude: *"Liệt kê bản ghi DNS của ninotekpos.com"*. Ra được danh sách là xong.

### 2.5. Cần cân nhắc trước khi bật

Connector này cho phép **sửa** hạ tầng thật, không chỉ đọc. Vài điều nên biết:

- Xoá nhầm một bản ghi DNS là cả `*.ninotekpos.com` chết theo, mọi cửa hàng
  của khách mất địa chỉ cho tới khi DNS lan lại.
- Khởi động lại hay dựng lại VPS làm gián đoạn việc bán hàng của khách đang dùng.
- Tôi sẽ luôn hỏi lại trước khi làm những việc kiểu đó, nhưng chốt chặn cuối
  vẫn là bạn đọc kỹ trước khi đồng ý.
- Chỉ bật `hostinger-api-mcp` (gói đầy đủ, có cả thanh toán) khi thật sự cần.

---

## 3. Triển khai `ninotekpos.com`

### 3.1. Hai bản ghi DNS

hPanel › **Domains › ninotekpos.com › DNS / Nameservers**:

> **Bước này đã làm xong ngày 20/08/2026.** Giữ lại phần dưới để tham khảo khi
> đổi máy chủ hoặc dựng lại từ đầu.

| Kiểu | Tên | Trỏ về | TTL |
|---|---|---|---|
| `A` | `@` | `187.52.122.31` | 3600 |
| `A` | `*` | `187.52.122.31` | 3600 |
| `CNAME` | `www` | `ninotekpos.com.` | 300 |

Bản ghi `*` (wildcard) là thứ khiến mọi tên miền con của khách —
`caphesang.ninotekpos.com`, `tiemsach.ninotekpos.com` — chạy được mà không phải
khai từng cái.

Bản ghi `@` hiện trỏ `2.57.91.91` — đó là máy chủ parking của Hostinger, không
phải VPS của anh. **Sửa** nó thành IP VPS chứ đừng thêm bản ghi `A` thứ hai:
hai bản ghi `A` cùng tên khiến trình duyệt lúc vào máy này lúc vào máy kia.

Sửa bằng Hostinger Connector thì nhớ đặt `overwrite: true`. Để mặc định
(`false`) thì bản ghi cũ **được giữ lại và thêm bản ghi mới vào**, thành hai bản
ghi `A` cùng tên trỏ hai nơi khác nhau — đúng cái bẫy nói ở trên.

Kiểm sau 5–30 phút:

```bash
nslookup ninotekpos.com
nslookup caphesang.ninotekpos.com
```

Cả hai phải ra cùng IP của VPS.

### 3.2. Dựng VPS

VPS đã cài sẵn Ubuntu 24.04 LTS và đang chạy, không phải dựng lại. SSH vào
bằng `ssh root@187.52.122.31` rồi cài phần mềm cần thiết:

```bash
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs nginx certbot git sqlite3 ufw
node -v    # phải ra v24.x
```

Hoặc chạy thẳng script làm hết phần này — xem mục 3.2b.

### 3.2b. Hoặc dùng script cho nhanh

Hai script làm thay các bước 3.2, 3.4, 3.6, 3.7, 3.8. Chạy lại nhiều lần không
sao — mỗi bước đều kiểm tra trước khi làm, và **không bao giờ ghi đè cấu hình
hay dữ liệu đã có**.

```bash
# Trên VPS, chạy một lần: cài Node 24, Nginx, certbot, bật tường lửa
bash vps-1-chuan-bi.sh
```

Chép mã nguồn lên (mục 3.3), xin chứng chỉ (mục 3.5), rồi:

```bash
bash /var/www/ninotek-pos/server/scripts/vps-2-trien-khai.sh
```

Script thứ hai hỏi số tài khoản ngân hàng và hộp thư, **tự sinh** mật khẩu quản
trị và `SIGNUP_SECRET` (đừng tự nghĩ — mật khẩu tự nghĩ thường yếu), dựng Nginx
và dịch vụ systemd, rồi tự gọi thử API để chắc là chạy được thật chứ không chỉ
"đã khởi động".

Mật khẩu quản trị **chỉ hiện một lần** lúc chạy — chép ra chỗ an toàn ngay.

Chưa có chứng chỉ thì script dựng tạm cấu hình HTTP để còn thử được; xin chứng
chỉ xong chạy lại là nó tự chuyển sang HTTPS.

### 3.3. Chép mã nguồn lên

```bash
mkdir -p /var/www && cd /var/www
git clone <kho-git-cua-ban> ninotek-pos
cd ninotek-pos
npm run install:all
npm run build
```

Chưa đưa lên Git thì nén thư mục dự án rồi `scp` lên, **trừ** `node_modules`,
`server/data`, `product_img`.

### 3.4. Khai cấu hình

```bash
nano /var/www/ninotek-pos/server/.env.cloud
```

```
MULTI_TENANT=1
ROOT_DOMAIN=ninotekpos.com
PLATFORM_ADMIN_PASSWORD=<đặt mật khẩu mạnh, không dùng mật khẩu mẫu>
SIGNUP_SECRET=<chuỗi ngẫu nhiên 64 ký tự>

TRIAL_DAYS=14
GRACE_DAYS=7
SIGNUP_MAX_PER_IP=3
SIGNUP_MAX_PER_DAY=50

BILLING_BIN=<mã BIN 6 số của ngân hàng, vd MB Bank là 970422>
BILLING_BANK=Vietcombank
BILLING_ACCOUNT=<số tài khoản nhận tiền>
BILLING_HOLDER=<tên chủ tài khoản>
# Khoá webhook SePay báo tiền gia hạn về — dán URL kèm khoá này vào cấu hình
# Webhook trên trang quản trị SePay: https://ninotekpos.com/api/platform/webhooks/billing?key=<khoá>
# Chưa khai thì máy chủ tự sinh một khoá ngẫu nhiên mỗi lần khởi động và in
# ra log — không kích hoạt tự động được nếu khoá đổi liên tục, nên PHẢI đặt
# cố định trước khi khai trên SePay.
BILLING_WEBHOOK_KEY=<chuỗi ngẫu nhiên dài, khó đoán>

PLATFORM_SMTP_HOST=smtp.hostinger.com
PLATFORM_SMTP_PORT=465
PLATFORM_SMTP_SECURE=1
PLATFORM_SMTP_USER=cskh@ninotekpos.com
PLATFORM_SMTP_PASS=<mật khẩu hộp thư>
```

Không có `PLATFORM_MAIL_FROM` / `PLATFORM_MAIL_FROM_NAME`: người gửi cố định là
`NINOTEK PoS - ninotekpos.com <cskh@ninotekpos.com>`, khai trong mã
(`server/src/tenancy/congTy.js`). Hộp thư SMTP ở trên phải được phép gửi dưới
danh nghĩa địa chỉ đó — dùng luôn chính hộp `cskh@` là gọn nhất.

Sinh `SIGNUP_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Hostinger có sẵn dịch vụ email theo tên miền (hPanel › Emails) — tạo hộp
`cskh@ninotekpos.com` rồi dùng chính thông tin đó cho `PLATFORM_SMTP_*`.

Khoá lại quyền đọc file, vì nó chứa mật khẩu:

```bash
chmod 600 /var/www/ninotek-pos/server/.env.cloud
```

### 3.5. Chứng chỉ HTTPS wildcard

`*.ninotekpos.com` bắt buộc xác thực qua DNS (DNS-01), không dùng được cách
thông thường. Có ba đường, **chọn một**:

> **Đính chính.** Bản trước của tài liệu này viết rằng dùng Cloudflare thì
> "không phải cài certbot". **Điều đó sai với trường hợp của chúng ta.** Gói
> Cloudflare miễn phí **không proxy được bản ghi wildcard** — đó là tính năng
> Enterprise. Bản ghi `*` buộc phải để DNS-only, nên tên miền con của khách đi
> thẳng vào VPS và VPS vẫn phải tự có chứng chỉ wildcard.

#### Cách A — Cloudflare + plugin chính thức

Đổi nameserver của `ninotekpos.com` sang Cloudflare (miễn phí). Được gì và
không được gì:

- ✔ Trang chủ `ninotekpos.com` được Cloudflare che (chống DDoS, CDN)
- ✘ **Tên miền con của khách KHÔNG được che** — `*` phải để DNS-only
- ✔ Plugin certbot cho Cloudflare là của **chính Certbot Project (EFF)**, không
  phải bên thứ ba
- ✘ Phải khai lại DNS bên Cloudflare, và Hostinger Connector hết quản được DNS

```bash
apt install -y python3-certbot-dns-cloudflare
# Không có trong kho thì: pip3 install --break-system-packages certbot-dns-cloudflare

mkdir -p /root/.secrets && chmod 700 /root/.secrets
cat > /root/.secrets/cloudflare.ini <<'EOF'
dns_cloudflare_api_token = <API token của Cloudflare, quyền Zone:DNS:Edit>
EOF
chmod 600 /root/.secrets/cloudflare.ini

certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  -d ninotekpos.com -d '*.ninotekpos.com' \
  --agree-tos -m hotro@ninotekpos.com
```

Đặt chế độ SSL bên Cloudflare là **Full (strict)**. Đừng chọn **Flexible** —
Cloudflare sẽ gọi vào VPS bằng HTTP, mà cấu hình Nginx ở mục 3.6 lại chuyển
hướng HTTP sang HTTPS, thành vòng lặp chuyển hướng vô tận.

#### Cách B — plugin certbot cho Hostinger

Có gói `certbot-dns-hostinger` trên PyPI, gia hạn tự động được:

```bash
apt install -y python3-pip
pip3 install --break-system-packages certbot-dns-hostinger

mkdir -p /root/.secrets && chmod 700 /root/.secrets
cat > /root/.secrets/hostinger.ini <<'EOF'
dns_hostinger_api_key = <khoá API mới của bạn>
EOF
chmod 600 /root/.secrets/hostinger.ini

certbot certonly \
  --authenticator dns-hostinger \
  --dns-hostinger-credentials /root/.secrets/hostinger.ini \
  -d ninotekpos.com -d '*.ninotekpos.com' \
  --agree-tos -m hotro@ninotekpos.com
```

**Cần biết trước:** đây là gói của **bên thứ ba** (BackBenchDevs), không phải
của Hostinger cũng không phải của EFF, mới có 5 bản phát hành. Nó sẽ đọc được
khoá API có quyền sửa toàn bộ hạ tầng của bạn. Không có gói `apt` chính thức nào
tên `python3-certbot-dns-hostinger` — đừng tìm.

Nếu dùng cách này, hãy tạo khoá API **riêng cho việc này** ở hPanel, đừng dùng
chung với khoá của Connector.

#### Cách C — làm tay, không cần khoá cho ai cả

```bash
certbot certonly --manual --preferred-challenges dns \
  -d ninotekpos.com -d '*.ninotekpos.com' \
  --agree-tos -m hotro@ninotekpos.com
```

Certbot in ra một chuỗi, bạn thêm bản ghi `TXT` tên `_acme-challenge` vào DNS
(bấm tay trong hPanel, hoặc nhờ tôi thêm qua Connector), chờ lan rồi nhấn Enter.

Đổi lại: **phải làm lại mỗi 90 ngày**, quên là cả trang báo lỗi chứng chỉ. Chỉ
nên chọn khi muốn chạy thử ngay và tính đổi sang cách A sau.

---

#### Cách D — hook tự viết, gọi thẳng API Hostinger (khuyến nghị)

Giữ nguyên DNS ở Hostinger, gia hạn tự động, và **không đưa khoá cho gói của bên
thứ ba nào**: script `server/scripts/certbot-hostinger-hook.sh` chỉ dùng `curl`,
dài chưa tới 60 dòng, đọc hết trong hai phút.

```bash
mkdir -p /root/.secrets && chmod 700 /root/.secrets
nano /root/.secrets/hostinger-token          # dán khoá API vào, lưu lại
chmod 600 /root/.secrets/hostinger-token
chmod +x /var/www/ninotek-pos/server/scripts/certbot-hostinger-hook.sh

certbot certonly --manual --preferred-challenges dns \
  --manual-auth-hook    "/var/www/ninotek-pos/server/scripts/certbot-hostinger-hook.sh them" \
  --manual-cleanup-hook "/var/www/ninotek-pos/server/scripts/certbot-hostinger-hook.sh xoa" \
  -d ninotekpos.com -d '*.ninotekpos.com' \
  --agree-tos -m hotro@ninotekpos.com
```

Certbot tự gọi lại hook mỗi lần gia hạn, không phải làm gì thêm.

Dùng khoá API **riêng cho việc này**, đừng dùng chung với khoá của Connector.

#### So sánh

| | A. Cloudflare | B. Plugin PyPI | C. Làm tay | **D. Hook tự viết** |
|---|---|---|---|---|
| Vẫn cần certbot | Có | Có | Có | Có |
| Gia hạn tự động | ✔ | ✔ | ✘ 90 ngày/lần | ✔ |
| Ai giữ khoá API | plugin EFF | gói bên thứ ba | không ai | script tự đọc được |
| Đổi nameserver | **Phải đổi** | Không | Không | Không |
| Connector còn quản DNS | ✘ | ✔ | ✔ | ✔ |
| Chống DDoS | Chỉ trang chủ | ✘ | ✘ | ✘ |

Xong cách nào thì kiểm:

```bash
certbot certificates
```

Phải thấy `ninotekpos.com` và `*.ninotekpos.com` trong cùng một chứng chỉ.

### 3.6. Nginx

```bash
nano /etc/nginx/sites-available/ninotekpos
```

```nginx
server {
  listen 443 ssl;
  http2 on;
  server_name ninotekpos.com *.ninotekpos.com;

  ssl_certificate     /etc/letsencrypt/live/ninotekpos.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/ninotekpos.com/privkey.pem;

  client_max_body_size 12M;          # đủ cho ảnh sản phẩm và file sao kê

  root /var/www/ninotek-pos/client/dist;
  index index.html;
  location / { try_files $uri /index.html; }

  location ~ ^/(api|product_img|store_img) {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;              # BẮT BUỘC — nhận cửa hàng theo Host
    proxy_set_header X-Real-IP $remote_addr;  # BẮT BUỘC — chống đăng ký rác theo IP
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

server {
  listen 80;
  server_name ninotekpos.com *.ninotekpos.com;
  return 301 https://$host$request_uri;
}
```

```bash
ln -s /etc/nginx/sites-available/ninotekpos /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Hai dòng `proxy_set_header` đánh dấu **BẮT BUỘC** không được bỏ:

- Thiếu `Host`: mọi yêu cầu thành "tên miền gốc", không cửa hàng nào vào được.
- Thiếu `X-Real-IP`: mọi khách mang chung một IP, giới hạn 3 bản đăng ký mỗi
  ngày trên một IP thành vô nghĩa.

### 3.7. Chạy thường trú

```bash
nano /etc/systemd/system/ninotek.service
```

```ini
[Unit]
Description=Ninotek PoS API
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/ninotek-pos/server
ExecStart=/usr/bin/node --env-file=.env.cloud src/index.js
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now ninotek
systemctl status ninotek
```

### 3.8. Tường lửa

hPanel › VPS › **Firewall**, hoặc trên máy:

```bash
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
```

Cổng **4000 không được mở ra ngoài** — chỉ Nginx gọi vào qua `127.0.0.1`.

### 3.9. Đưa cửa hàng của bạn lên

```bash
cd /var/www/ninotek-pos
# chép server/data/ninotek.sqlite từ máy bạn lên trước
npm run adopt:shop ninotek "NINOTEK"
systemctl restart ninotek
```

### 3.10. Kiểm tra lần cuối

| Mở | Phải thấy |
|---|---|
| `https://ninotekpos.com` | Trang giới thiệu và đăng ký |
| `https://ninotekpos.com/quan-tri` | Trang quản trị nền tảng |
| `https://ninotek.ninotekpos.com` | Cửa hàng của bạn, đủ 9.834 đơn |

Rồi tự đăng ký thử một cửa hàng để chạy hết một vòng: nhận thư xác minh, bấm
đường dẫn, vào cửa hàng mới, phát hành hoá đơn gia hạn.

---

## 4. Sao lưu

```bash
cat > /root/sao-luu.sh <<'EOF'
#!/bin/bash
NGAY=$(date +%F)
DICH=/root/backup/$NGAY
mkdir -p "$DICH"
cd /var/www/ninotek-pos/server/data
sqlite3 tenants.sqlite ".backup '$DICH/tenants.sqlite'"
sqlite3 ninotek.sqlite ".backup '$DICH/ninotek.sqlite'"
mkdir -p "$DICH/shops"
for f in shops/*.sqlite; do sqlite3 "$f" ".backup '$DICH/$f'"; done
tar czf "$DICH/anh.tar.gz" -C /var/www/ninotek-pos product_img store_img
find /root/backup -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
EOF
chmod +x /root/sao-luu.sh
(crontab -l 2>/dev/null; echo "0 2 * * * /root/sao-luu.sh") | crontab -
```

Dùng `.backup` của sqlite3 chứ không `cp`: chép thẳng file đang mở có thể ra bản
sao dở dang. Nhớ đem bản sao ra khỏi VPS — hỏng ổ đĩa thì bản sao nằm cùng ổ
cũng mất theo.

---

## 5. Việc còn lại sau khi lên sóng

- Đổi `PLATFORM_ADMIN_PASSWORD` khỏi giá trị mẫu (nếu chưa).
- Khai `BILLING_ACCOUNT` — chưa có thì hoá đơn của khách không hiện số tài khoản.
- Gửi thử một thư từ trang quản trị để chắc SMTP chạy.
- Cân nhắc bật Cloudflare đứng trước để chống tấn công và có sẵn chứng chỉ
  wildcard; nếu dùng thì đổi nameserver và bỏ bước 3.5.
