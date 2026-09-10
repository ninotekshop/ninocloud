#!/usr/bin/env python3
"""NinoPOS License Studio v2.4 - Quản lý chủ sở hữu, cấp key và lưu hồ sơ giao dịch nội bộ.

Chạy: python license_admin.py
Private key chỉ được đọc cục bộ, không được gửi cho khách hàng hoặc commit.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import smtplib
import sys
import urllib.request
import uuid
from datetime import date, timedelta
from email.message import EmailMessage
from pathlib import Path
import tkinter as tk
from tkinter import messagebox, ttk

if getattr(sys, "frozen", False):
    APP_DIR = Path(sys.executable).parent
else:
    APP_DIR = Path(__file__).resolve().parent
    ROOT = Path(__file__).resolve().parents[1] / "license-generator"
    sys.path.insert(0, str(ROOT))

from ninotek_license import create_license_key, load_private_key  # noqa: E402

DATA_PATH = APP_DIR / "transactions.json"
SMTP_PATH = APP_DIR / "smtp_settings.json"
REVOCATION_PATH = APP_DIR / "revocations.json"
AUTH_PATH = APP_DIR / "admin_auth.json"
ICO_PATH = Path(__file__).resolve().parent / "LicenseAdmin.ico"

# --- BẢNG MÀU HIỆN ĐẠI (SLATE & INDIGO) ---
BG_APP = "#F1F5F9"        # Nền chính xám sáng sạch sẽ
BG_CARD = "#FFFFFF"       # Nền card trắng
PRIMARY = "#2563EB"       # Xanh dương chính
PRIMARY_HOVER = "#1D4ED8"
TEXT_MAIN = "#0F172A"     # Chữ chính Slate đậm
TEXT_MUTED = "#64748B"    # Chữ phụ / nhãn
BORDER_COLOR = "#E2E8F0"  # Viền ngăn cách nhẹ
DANGER = "#EF4444"        # Đỏ cảnh báo
SUCCESS = "#10B981"       # Xanh lá thành công


# --- CƠ CHẾ BẢO MẬT & MÃ HÓA MẬT KHẨU ---
def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    if not salt:
        salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000).hex()
    return hashed, salt


def verify_password(password: str) -> bool:
    if not AUTH_PATH.exists():
        # Tạo mật khẩu mặc định "ninotek2026" cho lần đầu khởi chạy
        hashed, salt = hash_password("ninotek2026")
        AUTH_PATH.write_text(json.dumps({"hash": hashed, "salt": salt}), encoding="utf-8")
    data = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
    calc_hash, _ = hash_password(password, data["salt"])
    return calc_hash == data["hash"]


def update_master_password(old_password: str, new_password: str) -> bool:
    if not verify_password(old_password):
        return False
    hashed, salt = hash_password(new_password)
    AUTH_PATH.write_text(json.dumps({"hash": hashed, "salt": salt}), encoding="utf-8")
    return True


def load_records():
    if not DATA_PATH.exists():
        return []
    return json.loads(DATA_PATH.read_text(encoding="utf-8"))


def format_amount(value):
    digits = "".join(character for character in str(value or "") if character.isdigit())
    return f"{int(digits):,}".replace(",", ".") if digits else "0"


def normalize_amount(value):
    return str(value or "").replace(".", "").replace(",", "").strip() or "0"


def save_records(records):
    DATA_PATH.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")


def save_revocation_manifest(records):
    revoked = [
        {
            "transaction_id": record["transaction_id"],
            "machine_id": record["machine_id"],
            "key_sha256": hashlib.sha256(record["license_key"].encode()).hexdigest().upper(),
            "revoked_at": record["revoked_at"],
            "reason": record.get("revocation_reason", ""),
        }
        for record in records if record.get("revoked")
    ]
    payload = {"revoked": revoked, "updated_at": date.today().isoformat()}
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    signature = load_private_key().sign(encoded)
    REVOCATION_PATH.write_text(json.dumps({
        "payload": payload,
        "signature": base64.b64encode(signature).decode("ascii"),
    }, ensure_ascii=False, indent=2), encoding="utf-8")


def load_smtp_settings():
    if SMTP_PATH.exists():
        return json.loads(SMTP_PATH.read_text(encoding="utf-8"))
    return {
        "host": os.getenv("NINOPOS_SMTP_HOST", ""),
        "port": os.getenv("NINOPOS_SMTP_PORT", "587"),
        "username": os.getenv("NINOPOS_SMTP_USERNAME", ""),
        "password": os.getenv("NINOPOS_SMTP_PASSWORD", ""),
        "sender": os.getenv("NINOPOS_SMTP_SENDER", ""),
        "use_tls": True,
        "revocation_url": os.getenv("NINOPOS_REVOCATION_URL", ""),
        "revocation_token": os.getenv("NINOPOS_REVOCATION_TOKEN", ""),
    }


def publish_revocation_manifest(settings):
    url = settings.get("revocation_url", "").strip()
    token = settings.get("revocation_token", "").strip()
    if not url or not token:
        return False
    if not url.startswith("https://"):
        raise ValueError("URL danh sách thu hồi phải dùng HTTPS.")
    request = urllib.request.Request(
        url, data=REVOCATION_PATH.read_bytes(), method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status not in (200, 204):
            raise ValueError(f"Máy chủ thu hồi trả về HTTP {response.status}.")
    return True


def send_license_email(record, settings):
    recipient = record["email"]
    if not recipient or "@" not in recipient:
        raise ValueError("Email khách hàng không hợp lệ.")
    if not settings.get("host") or not settings.get("sender"):
        raise ValueError("Chưa cấu hình SMTP máy chủ và email người gửi.")
    message = EmailMessage()
    message["Subject"] = f"NinoPOS - Thông tin bản quyền {record['transaction_id']}"
    message["From"] = settings["sender"]
    message["To"] = recipient
    expiry = record["expiry"]
    message.set_content(
        f"Kính gửi {record['owner'] or 'Quý khách'},\n\n"
        "Cảm ơn Quý khách đã mua bản quyền NinoPOS.\n\n"
        f"Mã giao dịch: {record['transaction_id']}\n"
        f"Gói bản quyền: {record['package']}\n"
        f"Mã máy: {record['machine_id']}\n"
        f"Số thiết bị tối đa: {record['max_devices']}\n"
        f"Thời hạn: {expiry}\n"
        f"Giá trị giao dịch: {format_amount(record['amount'])} VNĐ\n\n"
        "License key:\n"
        f"{record['license_key']}\n\n"
        "Vui lòng lưu key và chỉ kích hoạt trên đúng máy đã đăng ký.\n"
        "Trân trọng,\nNINOTEK Technology & Solution"
    )
    with smtplib.SMTP(settings["host"], int(settings.get("port") or 587), timeout=20) as server:
        server.ehlo()
        if settings.get("use_tls", True):
            server.starttls()
            server.ehlo()
        if settings.get("username"):
            server.login(settings["username"], settings.get("password", ""))
        server.send_message(message)


class ModernLicenseStudio(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("NinoPOS License Studio v2.4")
        self.geometry("1200x720")
        self.minsize(1050, 650)
        self.configure(bg=BG_APP)

        # Mở ứng dụng mặc định ở chế độ Maximize
        try:
            self.state("zoomed")
            if ICO_PATH.exists():
                self.iconbitmap(str(ICO_PATH))
        except Exception:
            pass

        # Flag trạng thái đăng nhập
        self.authenticated = False

        # Reactive Variables
        self.vars = {
            name: tk.StringVar() for name in (
                "owner", "phone", "email", "machine_id", "package", "years",
                "devices", "amount", "note", "replacement_of",
            )
        }
        self.vars["package"].set("PRO")
        self.vars["years"].set("1")
        self.vars["devices"].set("3")
        self.vars["amount"].set("0")
        self.current_key = ""

        self._setup_theme()
        self._build_header()
        self._build_main_content()

        # Hiển thị màn hình đăng nhập bảo mật
        self.withdraw()  # Ẩn cửa sổ chính cho đến khi đăng nhập thành công
        self._show_login_dialog()

    def _setup_theme(self):
        style = ttk.Style(self)
        style.theme_use("clam")

        # Config Treeview (Bảng lịch sử)
        style.configure(
            "Custom.Treeview",
            background=BG_CARD,
            foreground=TEXT_MAIN,
            fieldbackground=BG_CARD,
            rowheight=34,
            font=("Segoe UI", 9),
            borderwidth=0
        )
        style.configure(
            "Custom.Treeview.Heading",
            background="#F8FAFC",
            foreground=TEXT_MUTED,
            font=("Segoe UI", 9, "bold"),
            relief="flat",
            padding=(8, 8)
        )
        style.map("Custom.Treeview", background=[("selected", "#EFF6FF")], foreground=[("selected", PRIMARY)])

        # Config Combobox
        style.configure("Custom.TCombobox", padding=5, font=("Segoe UI", 10))

    def _show_login_dialog(self):
        login_win = tk.Toplevel()
        login_win.title("Đăng nhập Admin - NinoPOS")
        login_win.geometry("420x360")
        login_win.resizable(False, False)
        login_win.configure(bg=BG_CARD)
        if ICO_PATH.exists():
            try:
                login_win.iconbitmap(str(ICO_PATH))
            except Exception:
                pass

        # Căn giữa màn hình
        login_win.update_idletasks()
        width = login_win.winfo_width()
        height = login_win.winfo_height()
        x = (login_win.winfo_screenwidth() // 2) - (width // 2)
        y = (login_win.winfo_screenheight() // 2) - (height // 2)
        login_win.geometry(f"{width}x{height}+{x}+{y}")

        # Xử lý đóng cửa sổ đăng nhập -> thoát app
        def on_close():
            login_win.destroy()
            self.destroy()

        login_win.protocol("WM_DELETE_WINDOW", on_close)

        # Header card đăng nhập
        header_frame = tk.Frame(login_win, bg=PRIMARY, height=80)
        header_frame.pack(fill="x")
        header_frame.pack_propagate(False)

        tk.Label(
            header_frame, text="🔒 NinoPOS License Admin",
            font=("Segoe UI", 13, "bold"), fg="white", bg=PRIMARY
        ).pack(pady=(18, 2))
        tk.Label(
            header_frame, text="Vui lòng xác thực quyền truy cập Quản trị viên",
            font=("Segoe UI", 8), fg="#DBEAFE", bg=PRIMARY
        ).pack()

        # Body form đăng nhập
        body = tk.Frame(login_win, bg=BG_CARD, padx=25, pady=20)
        body.pack(fill="both", expand=True)

        tk.Label(
            body, text="Mật khẩu Quản trị (Master Password)",
            font=("Segoe UI", 9, "bold"), fg=TEXT_MAIN, bg=BG_CARD
        ).pack(anchor="w", pady=(5, 5))

        pwd_var = tk.StringVar()
        txt_pwd = tk.Entry(
            body, textvariable=pwd_var, show="•", font=("Segoe UI", 11),
            bg="#F8FAFC", fg=TEXT_MAIN, relief="flat", highlightthickness=1,
            highlightbackground=BORDER_COLOR, highlightcolor=PRIMARY
        )
        txt_pwd.pack(fill="x", ipady=6, ipadx=8)
        txt_pwd.focus_set()

        lbl_error = tk.Label(body, text="", font=("Segoe UI", 8), fg=DANGER, bg=BG_CARD)
        lbl_error.pack(anchor="w", pady=(4, 0))

        # Gợi ý mật khẩu mặc định nếu chưa đổi
        if not AUTH_PATH.exists():
            tk.Label(
                body, text="💡 Mật khẩu mặc định lần đầu: ninotek2026",
                font=("Segoe UI", 8, "italic"), fg=TEXT_MUTED, bg=BG_CARD
            ).pack(anchor="w", pady=(2, 10))

        def do_login(_event=None):
            entered = pwd_var.get()
            if verify_password(entered):
                self.authenticated = True
                login_win.destroy()
                self.deiconify()  # Hiện cửa sổ chính
                self.update_idletasks()
                try:
                    self.state("zoomed")
                except Exception:
                    pass
                self.after(50, lambda: self.state("zoomed"))
                self.refresh()
            else:
                lbl_error.configure(text="✕ Mật khẩu không chính xác. Vui lòng thử lại!")
                txt_pwd.config(highlightbackground=DANGER)

        txt_pwd.bind("<Return>", do_login)

        btn_login = tk.Button(
            body, text="ĐĂNG NHẬP HỆ THỐNG", font=("Segoe UI", 10, "bold"),
            bg=PRIMARY, fg="white", activebackground=PRIMARY_HOVER, activeforeground="white",
            relief="flat", cursor="hand2", pady=8, command=do_login
        )
        btn_login.pack(fill="x", pady=(15, 0))

    def _build_header(self):
        header = tk.Frame(self, bg=BG_CARD, height=60, highlightthickness=1, highlightbackground=BORDER_COLOR)
        header.pack(fill="x", side="top")
        header.pack_propagate(False)

        # Title & Subtitle
        title_box = tk.Frame(header, bg=BG_CARD)
        title_box.pack(side="left", padx=20, pady=10)

        lbl_brand = tk.Label(title_box, text="NinoPOS License Studio", font=("Segoe UI", 13, "bold"), fg=TEXT_MAIN, bg=BG_CARD)
        lbl_brand.pack(side="left")

        badge_ver = tk.Label(title_box, text="v2.4", font=("Segoe UI", 8, "bold"), fg=PRIMARY, bg="#DBEAFE", padx=6, pady=1)
        badge_ver.pack(side="left", padx=8)

        lbl_desc = tk.Label(title_box, text="|  Quản trị & Cấp mã bản quyền", font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_CARD)
        lbl_desc.pack(side="left", padx=5)

        # Right actions
        right_box = tk.Frame(header, bg=BG_CARD)
        right_box.pack(side="right", padx=20)

        lbl_corp = tk.Label(right_box, text="NINOTEK Technology & Solution", font=("Segoe UI", 9, "bold"), fg=TEXT_MUTED, bg=BG_CARD)
        lbl_corp.pack(side="left", padx=15)

        btn_pwd = tk.Button(
            right_box, text="🔒 Đổi mật khẩu", font=("Segoe UI", 9),
            bg=BG_CARD, fg=TEXT_MAIN, relief="flat", bd=1,
            highlightbackground=BORDER_COLOR, highlightthickness=1,
            padx=10, pady=4, cursor="hand2", command=self.change_password_dialog
        )
        btn_pwd.pack(side="left", padx=(0, 6))

        btn_smtp = tk.Button(
            right_box, text="⚙ Cấu hình SMTP", font=("Segoe UI", 9),
            bg=BG_CARD, fg=TEXT_MAIN, relief="flat", bd=1,
            highlightbackground=BORDER_COLOR, highlightthickness=1,
            padx=10, pady=4, cursor="hand2", command=self.configure_email
        )
        btn_smtp.pack(side="left")

    def _build_main_content(self):
        body = tk.Frame(self, bg=BG_APP)
        body.pack(fill="both", expand=True, padx=20, pady=20)
        body.grid_columnconfigure(0, weight=4)  # Form cột trái (40%)
        body.grid_columnconfigure(1, weight=6)  # Output + Bảng cột phải (60%)
        body.grid_rowconfigure(0, weight=1)

        # === CỘT TRÁI: FORM CẤP KEY ===
        left_card = tk.Frame(body, bg=BG_CARD, bd=1, highlightthickness=1, highlightbackground=BORDER_COLOR)
        left_card.grid(row=0, column=0, sticky="nsew", padx=(0, 10))

        tk.Label(
            left_card, text="THÔNG TIN CẤP MỚI / TÁI CẤP KEY",
            font=("Segoe UI", 10, "bold"), fg=TEXT_MAIN, bg=BG_CARD
        ).pack(anchor="w", padx=20, pady=(18, 12))

        form_frame = tk.Frame(left_card, bg=BG_CARD)
        form_frame.pack(fill="both", expand=True, padx=20)

        # Hàm tiện ích tạo input field gắn với StringVar
        def create_field(parent, label_text, var_key):
            box = tk.Frame(parent, bg=BG_CARD)
            box.pack(fill="x", pady=4)
            tk.Label(box, text=label_text, font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_CARD).pack(anchor="w", pady=(0, 2))
            entry = tk.Entry(
                box, textvariable=self.vars[var_key], font=("Segoe UI", 10), bg="#F8FAFC", fg=TEXT_MAIN,
                relief="flat", highlightthickness=1, highlightbackground=BORDER_COLOR,
                highlightcolor=PRIMARY
            )
            entry.pack(fill="x", ipady=5, ipadx=8)
            return entry

        self.txt_owner = create_field(form_frame, "Chủ sở hữu / Đơn vị", "owner")
        self.txt_phone = create_field(form_frame, "Số điện thoại", "phone")
        self.txt_email = create_field(form_frame, "Email nhận key", "email")
        self.txt_machine = create_field(form_frame, "Mã máy mới (Hardware ID)", "machine_id")

        # Hàng đôi: Gói & Số máy
        row_opts = tk.Frame(form_frame, bg=BG_CARD)
        row_opts.pack(fill="x", pady=4)
        row_opts.columnconfigure(0, weight=1)
        row_opts.columnconfigure(1, weight=1)

        box_pkg = tk.Frame(row_opts, bg=BG_CARD)
        box_pkg.grid(row=0, column=0, sticky="ew", padx=(0, 5))
        tk.Label(box_pkg, text="Gói bản quyền", font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_CARD).pack(anchor="w", pady=(0, 2))
        self.cb_pkg = ttk.Combobox(box_pkg, textvariable=self.vars["package"], values=["PRO", "BASIC", "ENTERPRISE"], style="Custom.TCombobox", state="readonly")
        self.cb_pkg.pack(fill="x")

        box_limit = tk.Frame(row_opts, bg=BG_CARD)
        box_limit.grid(row=0, column=1, sticky="ew", padx=(5, 0))
        tk.Label(box_limit, text="Thiết bị tối đa", font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_CARD).pack(anchor="w", pady=(0, 2))
        self.txt_limit = tk.Entry(box_limit, textvariable=self.vars["devices"], font=("Segoe UI", 10), bg="#F8FAFC", relief="flat", highlightthickness=1, highlightbackground=BORDER_COLOR)
        self.txt_limit.pack(fill="x", ipady=5, ipadx=8)

        # Hàng đôi: Thời hạn & Giá trị
        row_billing = tk.Frame(form_frame, bg=BG_CARD)
        row_billing.pack(fill="x", pady=4)
        row_billing.columnconfigure(0, weight=1)
        row_billing.columnconfigure(1, weight=1)

        box_years = tk.Frame(row_billing, bg=BG_CARD)
        box_years.grid(row=0, column=0, sticky="ew", padx=(0, 5))
        tk.Label(box_years, text="Số năm (0 = vĩnh viễn)", font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_CARD).pack(anchor="w", pady=(0, 2))
        self.txt_years = tk.Entry(box_years, textvariable=self.vars["years"], font=("Segoe UI", 10), bg="#F8FAFC", relief="flat", highlightthickness=1, highlightbackground=BORDER_COLOR)
        self.txt_years.pack(fill="x", ipady=5, ipadx=8)

        box_price = tk.Frame(row_billing, bg=BG_CARD)
        box_price.grid(row=0, column=1, sticky="ew", padx=(5, 0))
        tk.Label(box_price, text="Giá trị (VNĐ)", font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_CARD).pack(anchor="w", pady=(0, 2))
        self.txt_price = tk.Entry(box_price, textvariable=self.vars["amount"], font=("Segoe UI", 10), bg="#F8FAFC", relief="flat", highlightthickness=1, highlightbackground=BORDER_COLOR)
        self.txt_price.pack(fill="x", ipady=5, ipadx=8)
        self.txt_price.bind("<FocusOut>", self.format_amount_field)

        self.txt_replacement = create_field(form_frame, "Cấp lại từ mã giao dịch (nếu có)", "replacement_of")
        self.txt_note = create_field(form_frame, "Ghi chú", "note")

        # Nút hành động
        btn_action_box = tk.Frame(left_card, bg=BG_CARD)
        btn_action_box.pack(fill="x", padx=20, pady=15, side="bottom")

        btn_generate = tk.Button(
            btn_action_box, text="⚡  CẤP KEY / TÁI CẤP KEY",
            font=("Segoe UI", 10, "bold"), bg=PRIMARY, fg="white",
            activebackground=PRIMARY_HOVER, activeforeground="white",
            relief="flat", cursor="hand2", pady=8, command=self.issue
        )
        btn_generate.pack(fill="x", pady=(0, 6))

        btn_cancel = tk.Button(
            btn_action_box, text="Hủy key đã chọn",
            font=("Segoe UI", 9), bg="#FEE2E2", fg=DANGER,
            activebackground="#FECACA", activeforeground=DANGER,
            relief="flat", cursor="hand2", pady=5, command=self.revoke_selected
        )
        btn_cancel.pack(fill="x")

        # === CỘT PHẢI: DISPLAY KEY & DATA TABLE ===
        right_col = tk.Frame(body, bg=BG_APP)
        right_col.grid(row=0, column=1, sticky="nsew", padx=(10, 0))
        right_col.grid_rowconfigure(1, weight=1)
        right_col.grid_columnconfigure(0, weight=1)

        # Card 1: Key vừa cấp
        key_card = tk.Frame(right_col, bg=BG_CARD, bd=1, highlightthickness=1, highlightbackground=BORDER_COLOR)
        key_card.grid(row=0, column=0, sticky="ew", pady=(0, 15))

        tk.Label(
            key_card, text="LICENSE KEY VỪA CẤP",
            font=("Segoe UI", 10, "bold"), fg=TEXT_MAIN, bg=BG_CARD
        ).pack(anchor="w", padx=20, pady=(15, 8))

        key_display_box = tk.Frame(key_card, bg="#0F172A", padx=12, pady=12)
        key_display_box.pack(fill="x", padx=20, pady=(0, 15))

        self.lbl_key_val = tk.Label(
            key_display_box,
            text="Chưa có key nào vừa được cấp",
            font=("Consolas", 11, "bold"), fg="#38BDF8", bg="#0F172A",
            wraplength=480, justify="left"
        )
        self.lbl_key_val.pack(side="left", fill="x", expand=True)

        btn_copy = tk.Button(
            key_display_box, text="Sao chép", font=("Segoe UI", 9, "bold"),
            bg=PRIMARY, fg="white", activebackground=PRIMARY_HOVER,
            activeforeground="white", relief="flat", cursor="hand2", padx=12, pady=5,
            command=self.copy_key
        )
        btn_copy.pack(side="right")

        # Card 2: Lịch sử giao dịch
        table_card = tk.Frame(right_col, bg=BG_CARD, bd=1, highlightthickness=1, highlightbackground=BORDER_COLOR)
        table_card.grid(row=1, column=0, sticky="nsew")

        tk.Label(
            table_card, text="LỊCH SỬ GIAO DỊCH / CẤP LẠI",
            font=("Segoe UI", 10, "bold"), fg=TEXT_MAIN, bg=BG_CARD
        ).pack(anchor="w", padx=20, pady=(15, 10))

        # Table Treeview
        tree_container = tk.Frame(table_card, bg=BG_CARD)
        tree_container.pack(fill="both", expand=True, padx=15, pady=(0, 15))

        cols = ("tx_id", "owner", "machine", "pkg", "expiry", "status", "replacement", "action")
        self.tree = ttk.Treeview(tree_container, columns=cols, show="headings", style="Custom.Treeview")

        self.tree.heading("tx_id", text="MÃ GIAO DỊCH", anchor="w")
        self.tree.heading("owner", text="CHỦ SỞ HỮU", anchor="w")
        self.tree.heading("machine", text="MÃ MÁY", anchor="w")
        self.tree.heading("pkg", text="GÓI", anchor="center")
        self.tree.heading("expiry", text="HẾT HẠN", anchor="center")
        self.tree.heading("status", text="TRẠNG THÁI", anchor="center")
        self.tree.heading("replacement", text="CẤP LẠI TỪ", anchor="w")
        self.tree.heading("action", text="THAO TÁC", anchor="center")

        self.tree.column("tx_id", width=140, anchor="w")
        self.tree.column("owner", width=130, anchor="w")
        self.tree.column("machine", width=110, anchor="w")
        self.tree.column("pkg", width=60, anchor="center")
        self.tree.column("expiry", width=80, anchor="center")
        self.tree.column("status", width=90, anchor="center")
        self.tree.column("replacement", width=110, anchor="w")
        self.tree.column("action", width=80, anchor="center")

        scroll_y = ttk.Scrollbar(tree_container, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scroll_y.set)

        self.tree.pack(side="left", fill="both", expand=True)
        scroll_y.pack(side="right", fill="y")
        self.tree.bind("<Button-1>", self.handle_tree_click)

    # --- CHỨC NĂNG NGHIỆP VỤ ---
    def change_password_dialog(self):
        dialog = tk.Toplevel(self)
        dialog.title("Đổi Mật Khẩu Quản Trị")
        dialog.configure(bg=BG_CARD)
        dialog.geometry("400x320")
        dialog.transient(self)
        dialog.grab_set()

        # Căn giữa dialog
        dialog.update_idletasks()
        x = self.winfo_x() + (self.winfo_width() // 2) - (200)
        y = self.winfo_y() + (self.winfo_height() // 2) - (160)
        dialog.geometry(f"400x320+{x}+{y}")

        tk.Label(dialog, text="ĐỔI MẬT KHẨU QUẢN TRỊ", font=("Segoe UI", 11, "bold"), fg=TEXT_MAIN, bg=BG_CARD).pack(anchor="w", padx=20, pady=(15, 10))

        form = tk.Frame(dialog, bg=BG_CARD, padx=20)
        form.pack(fill="both", expand=True)

        tk.Label(form, text="Mật khẩu hiện tại", font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_CARD).pack(anchor="w", pady=(4, 2))
        txt_old = tk.Entry(form, show="•", font=("Segoe UI", 10), bg="#F8FAFC", fg=TEXT_MAIN, relief="flat", highlightthickness=1, highlightbackground=BORDER_COLOR)
        txt_old.pack(fill="x", ipady=4, ipadx=6)

        tk.Label(form, text="Mật khẩu mới", font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_CARD).pack(anchor="w", pady=(8, 2))
        txt_new = tk.Entry(form, show="•", font=("Segoe UI", 10), bg="#F8FAFC", fg=TEXT_MAIN, relief="flat", highlightthickness=1, highlightbackground=BORDER_COLOR)
        txt_new.pack(fill="x", ipady=4, ipadx=6)

        tk.Label(form, text="Xác nhận mật khẩu mới", font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_CARD).pack(anchor="w", pady=(8, 2))
        txt_confirm = tk.Entry(form, show="•", font=("Segoe UI", 10), bg="#F8FAFC", fg=TEXT_MAIN, relief="flat", highlightthickness=1, highlightbackground=BORDER_COLOR)
        txt_confirm.pack(fill="x", ipady=4, ipadx=6)

        def save_pwd():
            old_p = txt_old.get()
            new_p = txt_new.get()
            confirm_p = txt_confirm.get()

            if not new_p or len(new_p) < 4:
                messagebox.showerror("Lỗi", "Mật khẩu mới phải có tối thiểu 4 ký tự.", parent=dialog)
                return
            if new_p != confirm_p:
                messagebox.showerror("Lỗi", "Mật khẩu mới và xác nhận mật khẩu không khớp.", parent=dialog)
                return

            if update_master_password(old_p, new_p):
                dialog.destroy()
                messagebox.showinfo("Thành công", "Đã cập nhật mật khẩu Quản trị viên mới.")
            else:
                messagebox.showerror("Lỗi", "Mật khẩu hiện tại không chính xác.", parent=dialog)

        btn_save = tk.Button(
            dialog, text="Cập nhật mật khẩu", font=("Segoe UI", 9, "bold"),
            bg=PRIMARY, fg="white", activebackground=PRIMARY_HOVER, activeforeground="white",
            relief="flat", cursor="hand2", pady=6, command=save_pwd
        )
        btn_save.pack(fill="x", padx=20, pady=15)

    def issue(self):
        try:
            machine_id = self.vars["machine_id"].get().strip()
            if len(machine_id) < 8:
                raise ValueError("Mã máy (Hardware ID) không hợp lệ (tối thiểu 8 ký tự).")
            years = int(self.vars["years"].get())
            devices = int(self.vars["devices"].get())
            if years < 0 or devices < 1:
                raise ValueError("Số năm hoặc số thiết bị không hợp lệ.")
            expiry = None if years == 0 else (date.today() + timedelta(days=365 * years)).isoformat()
            key = create_license_key(load_private_key(), machine_id, self.vars["package"].get(), expiry, devices)
            transaction_id = f"TX-{date.today():%Y%m%d}-{uuid.uuid4().hex[:8].upper()}"
            record = {
                "transaction_id": transaction_id, "created_at": date.today().isoformat(),
                "owner": self.vars["owner"].get().strip(), "phone": self.vars["phone"].get().strip(),
                "email": self.vars["email"].get().strip(), "machine_id": machine_id,
                "package": self.vars["package"].get(), "expiry": expiry or "LIFETIME",
                "max_devices": devices, "amount": normalize_amount(self.vars["amount"].get()),
                "replacement_of": self.vars["replacement_of"].get().strip(),
                "note": self.vars["note"].get().strip(), "license_key": key,
            }
            records = load_records()
            records.append(record)
            save_records(records)

            self.lbl_key_val.configure(text=f"{transaction_id}\n{key}")
            self.current_key = key
            self.refresh()

            try:
                send_license_email(record, load_smtp_settings())
                messagebox.showinfo("Thành công", f"Đã cấp key và gửi email đến {record['email']}.\nMã giao dịch: {transaction_id}")
            except Exception as email_error:
                messagebox.showwarning("Đã cấp key, chưa gửi được email", f"Key đã được lưu thành công.\n\nLý do gửi email thất bại:\n{email_error}")
        except Exception as error:
            messagebox.showerror("Không thể cấp key", str(error))

    def format_amount_field(self, _event=None):
        self.vars["amount"].set(format_amount(self.vars["amount"].get()))

    def revoke_selected(self):
        selected = self.tree.selection()
        if not selected:
            messagebox.showwarning("Chưa chọn giao dịch", "Hãy chọn một giao dịch trong bảng lịch sử.")
            return
        transaction_id = self.tree.item(selected[0], "values")[0]
        records = load_records()
        record = next((item for item in records if item["transaction_id"] == transaction_id), None)
        if not record or record.get("revoked"):
            messagebox.showwarning("Không thể hủy", "Key này đã được hủy hoặc không tồn tại.")
            return
        if not messagebox.askyesno("Xác nhận hủy key", f"Hủy key của {record['owner']} ({transaction_id})?\nThiết bị sẽ bị khóa ở lần kiểm tra trực tuyến tiếp theo."):
            return
        record["revoked"] = True
        record["revoked_at"] = date.today().isoformat()
        record["revocation_reason"] = "Hủy bởi Admin"
        save_records(records)
        save_revocation_manifest(records)
        self.refresh()
        try:
            published = publish_revocation_manifest(load_smtp_settings())
            messagebox.showinfo("Đã hủy key", "Đã hủy key và tự động cập nhật URL thu hồi." if published else "Đã hủy key và tạo manifest thu hồi cục bộ.\nHãy cấu hình URL/token HTTPS để tự động tải lên.")
        except Exception as error:
            messagebox.showwarning("Đã hủy key, chưa tải lên được", f"Manifest đã tạo cục bộ nhưng tải lên thất bại:\n{error}")

    def handle_tree_click(self, event):
        row_id = self.tree.identify_row(event.y)
        column = self.tree.identify_column(event.x)
        if row_id and column == "#8":
            self.tree.selection_set(row_id)
            values = self.tree.item(row_id, "values")
            if len(values) > 5 and "Đã hủy" in values[5]:
                self.reissue_selected()

    def reissue_selected(self):
        selected = self.tree.selection()
        if not selected:
            return
        transaction_id = self.tree.item(selected[0], "values")[0]
        record = next((item for item in load_records() if item["transaction_id"] == transaction_id), None)
        if not record or not record.get("revoked"):
            messagebox.showwarning("Không thể cấp lại", "Chỉ có thể cấp lại key đã bị hủy.")
            return
        if not messagebox.askyesno("Xác nhận cấp lại key", f"Tái cấp key cho {record['owner']}?\nThông tin cũ sẽ được tự động điền vào biểu mẫu để nhập mã máy mới."):
            return
        values = {
            "owner": record.get("owner", ""), "phone": record.get("phone", ""),
            "email": record.get("email", ""), "machine_id": "",
            "package": record.get("package", "PRO"), "years": "0" if record.get("expiry") == "LIFETIME" else "1",
            "devices": str(record.get("max_devices", 3)), "amount": record.get("amount", "0"),
            "replacement_of": record["transaction_id"], "note": f"Cấp lại từ {record['transaction_id']}",
        }
        for key, value in values.items():
            self.vars[key].set(value)
        self.format_amount_field()

    def copy_key(self):
        key = getattr(self, "current_key", "")
        if not key:
            messagebox.showwarning("Chưa có key", "Hãy cấp key trước khi sao chép.")
            return
        self.clipboard_clear()
        self.clipboard_append(key)
        self.update()
        messagebox.showinfo("Đã sao chép", "License key đã được sao chép vào clipboard.")

    def configure_email(self):
        settings = load_smtp_settings()
        dialog = tk.Toplevel(self)
        dialog.title("Cấu hình Email SMTP & Revocation")
        dialog.configure(bg=BG_CARD)
        dialog.geometry("480x420")
        dialog.transient(self)
        dialog.grab_set()

        tk.Label(dialog, text="CẤU HÌNH SMTP & THU HỒI KEY", font=("Segoe UI", 11, "bold"), fg=TEXT_MAIN, bg=BG_CARD).pack(anchor="w", padx=20, pady=(15, 10))

        fields = ("host", "port", "username", "password", "sender", "revocation_url", "revocation_token")
        labels = {
            "host": "SMTP Server", "port": "Port", "username": "Tài khoản",
            "password": "Mật khẩu / App Password", "sender": "Email người gửi",
            "revocation_url": "URL thu hồi HTTPS", "revocation_token": "Token thu hồi"
        }
        variables = {key: tk.StringVar(value=str(settings.get(key, ""))) for key in fields}

        form_box = tk.Frame(dialog, bg=BG_CARD)
        form_box.pack(fill="both", expand=True, padx=20)

        for row, key in enumerate(fields):
            tk.Label(form_box, text=labels[key], font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_CARD).grid(row=row, column=0, padx=(0, 10), pady=4, sticky="w")
            entry = tk.Entry(
                form_box, textvariable=variables[key], font=("Segoe UI", 9), bg="#F8FAFC", fg=TEXT_MAIN,
                relief="flat", highlightthickness=1, highlightbackground=BORDER_COLOR,
                show="*" if key == "password" else "", width=30
            )
            entry.grid(row=row, column=1, padx=0, pady=4, sticky="ew")

        def save():
            try:
                values = {key: variables[key].get().strip() for key in fields}
                int(values["port"])
                values["use_tls"] = True
                SMTP_PATH.write_text(json.dumps(values, ensure_ascii=False, indent=2), encoding="utf-8")
                dialog.destroy()
                messagebox.showinfo("Đã lưu", "Đã lưu cấu hình SMTP & Revocation thành công.")
            except Exception as error:
                messagebox.showerror("Cấu hình không hợp lệ", str(error), parent=dialog)

        btn_save = tk.Button(
            dialog, text="Lưu cấu hình", font=("Segoe UI", 9, "bold"),
            bg=PRIMARY, fg="white", activebackground=PRIMARY_HOVER, activeforeground="white",
            relief="flat", cursor="hand2", pady=6, command=save
        )
        btn_save.pack(fill="x", padx=20, pady=15)

    def refresh(self):
        for item in self.tree.get_children():
            self.tree.delete(item)
        for record in reversed(load_records()):
            status_str = "✕ Đã hủy" if record.get("revoked") else "● Hiệu lực"
            action_str = "⚡ Cấp lại" if record.get("revoked") else ""
            self.tree.insert("", "end", values=(
                record["transaction_id"],
                record.get("owner", ""),
                record.get("machine_id", ""),
                record.get("package", "PRO"),
                record.get("expiry", "LIFETIME"),
                status_str,
                record.get("replacement_of", ""),
                action_str,
            ))


# Alias for compatibility
LicenseAdmin = ModernLicenseStudio

if __name__ == "__main__":
    app = ModernLicenseStudio()
    app.mainloop()
