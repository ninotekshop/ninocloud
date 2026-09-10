#!/usr/bin/env python3
"""
=====================================================================
 NINOTEK — License Key Generator (dành cho bộ phận Sales)
=====================================================================
Cơ chế: chữ ký số bất đối xứng Ed25519 (EdDSA trên đường cong Curve25519).

Vì sao Ed25519 chứ không phải RSA-2048?
  Chữ ký RSA-2048 dài 256 byte, làm License Key phồng lên ~579 ký tự.
  Chữ ký Ed25519 chỉ 64 byte  →  License Key còn ~272 ký tự (ngắn hơn 65%),
  Sales gửi qua Zalo/email ít bị ngắt dòng và kỹ thuật viên đỡ dán nhầm.
  Mức an toàn tương đương RSA-3072, lại nhanh hơn nhiều khi xác thực.

  ⚠️ Phía NinoPOS (.NET 8): System.Security.Cryptography CHƯA hỗ trợ
     Ed25519 (chỉ có từ .NET 10). Phải thêm gói NuGet:
         <PackageReference Include="BouncyCastle.Cryptography" Version="2.4.0" />
     Xem Ninotek.POS.Licensing/LicenseValidator.cs.

  • Private Key  → CHỈ nằm trên server Ninotek. Sales dùng để KÝ.
  • Public Key   → nhúng vào NinoPOS.exe. Client chỉ XÁC THỰC được,
                   không tạo được key giả.

⚠️ BẢO MẬT — ĐỌC KỸ:
  1. File private key (keys/ninotek_private.pem) TUYỆT ĐỐI KHÔNG commit.
     Đã chặn sẵn trong .gitignore. Lộ file này = toàn bộ sản phẩm bị crack.
  2. Sinh key một lần duy nhất, backup vào két/password manager của công ty.
     Mất private key = không cấp được key mới cho khách hàng nào nữa.
  3. Nên đặt passphrase cho private key khi chạy `genkeys` trên máy thật.

CÁCH DÙNG
  python ninotek_license.py genkeys
  python ninotek_license.py issue --machine-id BFEBFBFF000906EA-A0369F2C \
                                  --package PRO --years 1 --max-devices 5
  python ninotek_license.py verify --key "NINO-...." \
                                   --machine-id BFEBFBFF000906EA-A0369F2C
=====================================================================
"""
from __future__ import annotations

import argparse
import base64
import json
import secrets
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

KEY_DIR = Path(__file__).parent / "keys"
PRIVATE_KEY_PATH = KEY_DIR / "ninotek_private.pem"
PUBLIC_KEY_PATH = KEY_DIR / "ninotek_public.pem"

PREFIX = "NINO"
GROUP_SIZE = 5
VALID_PACKAGES = ("TRIAL", "BASIC", "PRO", "ENTERPRISE", "LIFETIME")
SIGNATURE_BYTES = 64  # Ed25519 luôn đúng 64 byte

# MÃ HOÁ: Base32 (RFC 4648) — KHÔNG dùng Base64.
#
# Lý do (một lỗi đã thực sự xảy ra và bị test bắt được):
#   Bảng chữ cái base64url là [A-Za-z0-9-_], tức CÓ CHỨA dấu '-'. Mà License
#   Key lại dùng '-' để chia nhóm 5 ký tự cho dễ đọc. Khi xác thực, hàm
#   _unformat_key xoá mọi dấu '-' → nó xoá luôn cả những dấu '-' vốn là DỮ
#   LIỆU, làm hỏng key. Lỗi này chỉ xuất hiện ngẫu nhiên (khi chữ ký tình cờ
#   sinh ra ký tự '-'), nên rất dễ lọt lên production rồi mới bùng.
#
# Base32 chỉ gồm [A-Z2-7]:
#   • Không bao giờ đụng dấu '-' phân nhóm.
#   • Toàn chữ hoa → Sales đọc qua điện thoại được, không lo hoa/thường.
#   • Bỏ sẵn các ký tự dễ nhìn nhầm 0/O và 1/I/L khỏi phần chữ.
# Đánh đổi: dài hơn base64 khoảng 20%, chấp nhận được vì key luôn copy-paste.
def _b32e(raw: bytes) -> str:
    return base64.b32encode(raw).decode("ascii").rstrip("=")


def _b32d(text: str) -> bytes:
    text = text.upper()
    return base64.b32decode(text + "=" * (-len(text) % 8))


# --- Sinh cặp khoá --------------------------------------------------------
def generate_key_pair(passphrase: str | None = None) -> None:
    KEY_DIR.mkdir(parents=True, exist_ok=True)
    if PRIVATE_KEY_PATH.exists():
        raise SystemExit(
            f"Đã tồn tại {PRIVATE_KEY_PATH}. Ghi đè sẽ làm MỌI license đã cấp "
            f"trở nên vô hiệu. Xoá thủ công nếu thực sự muốn tạo lại."
        )

    private_key = Ed25519PrivateKey.generate()

    encryption = (
        serialization.BestAvailableEncryption(passphrase.encode())
        if passphrase
        else serialization.NoEncryption()
    )
    PRIVATE_KEY_PATH.write_bytes(
        private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=encryption,
        )
    )
    PRIVATE_KEY_PATH.chmod(0o600)

    PUBLIC_KEY_PATH.write_bytes(
        private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )
    print(f"Private key : {PRIVATE_KEY_PATH}  (KHÔNG BAO GIỜ commit / gửi ra ngoài)")
    print(f"Public key  : {PUBLIC_KEY_PATH}")
    print("\nBước tiếp theo: chép public key vào")
    print("  apps/nino-pos/src/Ninotek.POS.Licensing/Keys/ninotek_public.pem")


def load_private_key(passphrase: str | None = None):
    key_path = PRIVATE_KEY_PATH
    if not key_path.exists():
        candidates = [
            Path(getattr(sys, "_MEIPASS", "")) / "keys" / "ninotek_private.pem",
            Path(sys.executable).parent / "keys" / "ninotek_private.pem",
            Path(__file__).parent / "keys" / "ninotek_private.pem",
            Path(__file__).parent.parent / "license-generator" / "keys" / "ninotek_private.pem",
        ]
        for candidate in candidates:
            if candidate.exists():
                key_path = candidate
                break
    if not key_path.exists():
        raise SystemExit(f"Không tìm thấy {key_path}. Chạy `genkeys` trước.")
    return serialization.load_pem_private_key(
        key_path.read_bytes(),
        password=passphrase.encode() if passphrase else None,
    )


def load_public_key(path: Path = PUBLIC_KEY_PATH):
    if not path.exists():
        raise SystemExit(f"Không tìm thấy {path}.")
    return serialization.load_pem_public_key(path.read_bytes())


# --- Payload --------------------------------------------------------------
@dataclass(frozen=True)
class LicensePayload:
    mid: str            # machine_id — vân tay phần cứng máy POS
    pkg: str            # gói cước
    exp: str | None     # ngày hết hạn YYYY-MM-DD, None = vĩnh viễn
    dev: int            # số thiết bị NinoOrder tối đa
    iss: str            # ngày cấp
    sid: str = ""       # store_id (tuỳ chọn, ràng license vào 1 cửa hàng)
    nonce: str = ""     # mã ngẫu nhiên để mỗi lần cấp lại tạo key mới

    def to_compact_json(self) -> str:
        # separators bỏ khoảng trắng; sort_keys để chuỗi ký LUÔN tái lập được
        # y hệt ở phía C# — thứ tự khoá khác nhau sẽ làm chữ ký không khớp.
        return json.dumps(
            {"mid": self.mid, "pkg": self.pkg, "exp": self.exp,
             "dev": self.dev, "iss": self.iss, "sid": self.sid, "nonce": self.nonce},
            separators=(",", ":"), sort_keys=True, ensure_ascii=False,
        )


def _format_key(b64: str) -> str:
    groups = [b64[i : i + GROUP_SIZE] for i in range(0, len(b64), GROUP_SIZE)]
    return f"{PREFIX}-" + "-".join(groups)


def _unformat_key(key: str) -> str:
    if not key.startswith(f"{PREFIX}-"):
        raise ValueError(f"License key phải bắt đầu bằng '{PREFIX}-'")
    return key[len(PREFIX) + 1 :].replace("-", "").strip()


def create_license_key(
    private_key, machine_id: str, package_type: str,
    expiry_date: str | None, max_devices: int = 3, store_id: str = "",
) -> str:
    if package_type not in VALID_PACKAGES:
        raise ValueError(f"Gói cước không hợp lệ: {package_type}. Chọn {VALID_PACKAGES}")
    if not machine_id or len(machine_id) < 8:
        raise ValueError("machine_id không hợp lệ — lấy từ màn hình Kích hoạt của NinoPOS")
    if max_devices < 1:
        raise ValueError("max_devices phải >= 1")
    if expiry_date is not None:
        date.fromisoformat(expiry_date)  # ném lỗi nếu sai định dạng

    payload = LicensePayload(
        mid=machine_id, pkg=package_type, exp=expiry_date,
        dev=max_devices, iss=date.today().isoformat(), sid=store_id, nonce=secrets.token_hex(8),
    )
    payload_json = payload.to_compact_json()

    signature = private_key.sign(payload_json.encode("utf-8"))

    # Bố cục nhị phân: [payload JSON ... ][chữ ký 64 byte]
    # Chữ ký Ed25519 LUÔN đúng 64 byte nên không cần ký tự phân tách — cứ
    # cắt 64 byte cuối là ra chữ ký, phần còn lại là payload. Bọc thêm một
    # lớp JSON chỉ làm key phồng ~35% vì bị escape dấu ngoặc kép.
    blob = payload_json.encode("utf-8") + signature
    return _format_key(_b32e(blob))


# --- Xác thực (bản tham chiếu cho NinoPOS) --------------------------------
@dataclass
class VerifyResult:
    valid: bool
    reason: str
    payload: LicensePayload | None = None
    days_remaining: int | None = None


def verify_license_key(
    public_key, license_key: str, machine_id: str,
    today: date | None = None,
) -> VerifyResult:
    today = today or datetime.now(timezone.utc).date()
    try:
        blob = _b32d(_unformat_key(license_key))
        if len(blob) <= SIGNATURE_BYTES:
            return VerifyResult(False, "Chuỗi license quá ngắn — thiếu dữ liệu")
        payload_json = blob[:-SIGNATURE_BYTES].decode("utf-8")
        signature = blob[-SIGNATURE_BYTES:]
    except Exception as exc:
        return VerifyResult(False, f"Chuỗi license hỏng hoặc sai định dạng: {exc}")

    # 1. Chữ ký số — chặn key tự chế
    try:
        public_key.verify(signature, payload_json.encode("utf-8"))
    except InvalidSignature:
        return VerifyResult(False, "Chữ ký số không hợp lệ — license bị sửa đổi hoặc làm giả")

    data = json.loads(payload_json)
    payload = LicensePayload(
        mid=data["mid"], pkg=data["pkg"], exp=data["exp"],
        dev=data["dev"], iss=data["iss"], sid=data.get("sid", ""), nonce=data.get("nonce", ""),
    )

    # 2. Vân tay máy — chặn copy key sang máy khác
    if payload.mid != machine_id:
        return VerifyResult(False, "License được cấp cho máy khác (mã máy không khớp)", payload)

    # 3. Hạn dùng
    if payload.exp is None:
        return VerifyResult(True, "Hợp lệ (bản quyền vĩnh viễn)", payload, None)

    expiry = date.fromisoformat(payload.exp)
    remaining = (expiry - today).days
    if remaining < 0:
        return VerifyResult(False, f"License đã hết hạn ngày {payload.exp}", payload, remaining)

    return VerifyResult(True, "Hợp lệ", payload, remaining)


# --- CLI ------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(description="Ninotek License Key Generator")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_gen = sub.add_parser("genkeys", help="Sinh cặp khoá RSA (chạy 1 lần duy nhất)")
    p_gen.add_argument("--passphrase", help="Mật khẩu bảo vệ private key (khuyến nghị)")

    p_iss = sub.add_parser("issue", help="Cấp license key cho khách hàng")
    p_iss.add_argument("--machine-id", required=True, help="Mã máy lấy từ NinoPOS")
    p_iss.add_argument("--package", default="PRO", choices=VALID_PACKAGES)
    p_iss.add_argument("--years", type=int, default=1, help="Số năm; 0 = vĩnh viễn")
    p_iss.add_argument("--max-devices", type=int, default=3)
    p_iss.add_argument("--store-id", default="")
    p_iss.add_argument("--passphrase")

    p_ver = sub.add_parser("verify", help="Kiểm tra một license key")
    p_ver.add_argument("--key", required=True)
    p_ver.add_argument("--machine-id", required=True)

    args = parser.parse_args()

    if args.cmd == "genkeys":
        generate_key_pair(args.passphrase)
        return 0

    if args.cmd == "issue":
        expiry = (
            None if args.years == 0
            else (date.today() + timedelta(days=365 * args.years)).isoformat()
        )
        key = create_license_key(
            load_private_key(args.passphrase), args.machine_id,
            args.package, expiry, args.max_devices, args.store_id,
        )
        print("=" * 62)
        print("  LICENSE KEY NINOTEK — CẤP CHO KHÁCH HÀNG")
        print("=" * 62)
        print(f"  Mã máy     : {args.machine_id}")
        print(f"  Gói cước   : {args.package}")
        print(f"  Hết hạn    : {expiry or 'Vĩnh viễn'}")
        print(f"  Số thiết bị: {args.max_devices}")
        print("-" * 62)
        print(key)
        print("=" * 62)
        return 0

    if args.cmd == "verify":
        r = verify_license_key(load_public_key(), args.key, args.machine_id)
        print(f"{'HỢP LỆ' if r.valid else 'KHÔNG HỢP LỆ'}: {r.reason}")
        if r.payload:
            print(f"  Gói: {r.payload.pkg}   Thiết bị tối đa: {r.payload.dev}")
            if r.days_remaining is not None:
                print(f"  Còn lại: {r.days_remaining} ngày")
        return 0 if r.valid else 1

    return 1


if __name__ == "__main__":
    sys.exit(main())
