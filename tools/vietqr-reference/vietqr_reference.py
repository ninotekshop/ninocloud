#!/usr/bin/env python3
"""
=====================================================================
 NINOTEK F&B POS — VietQR EMVCo Reference Implementation
=====================================================================
Đây là bản CHUẨN THAM CHIẾU. Mọi implementation khác (C# cho NinoPOS,
TypeScript cho NinoCloud) phải cho ra chuỗi giống hệt file này trên
bộ golden vectors tại packages/api-contracts/data/vietqr-test-vectors.json

Chuẩn áp dụng: EMVCo QR Code Specification for Payment Systems (MPM)
               + NAPAS VietQR / IBFT domestic specification.

Cấu trúc TLV của một mã VietQR động:

  ID  Len  Value
  --  ---  ----------------------------------------------------------
  00  02   "01"                Payload Format Indicator
  01  02   "11" | "12"         Point of Initiation (11=tĩnh, 12=động)
  38  ..   Merchant Account Information (NAPAS)
           ├─ 00 10  "A000000727"          GUID của NAPAS
           ├─ 01 ..  Beneficiary Organization
           │         ├─ 00 06  <BIN ngân hàng, vd 970436>
           │         └─ 01 ..  <số tài khoản / số thẻ>
           └─ 02 08  "QRIBFTTA" | "QRIBFTTC"   Mã dịch vụ
  53  03   "704"               Currency = VND (ISO 4217)
  54  ..   <số tiền>           CHỈ có ở QR động
  58  02   "VN"                Country Code
  59  ..   <tên merchant>      Tuỳ chọn, tối đa 25 ký tự
  60  ..   <thành phố>         Tuỳ chọn, tối đa 15 ký tự
  62  ..   Additional Data Field
           └─ 08 ..  <nội dung chuyển khoản, vd NINOPOS100234>
  63  04   <CRC>               CRC-16/CCITT-FALSE, tính trên toàn chuỗi
                               ĐÃ BAO GỒM "6304"

CẢNH BÁO QUAN TRỌNG:
  Mã ví dụ trong tài liệu `resources/workflow/4. Tich hop VietQR.md`
  bị SAI độ dài TLV (ghi 3857/0127 thay vì 3854/0124) và CRC là chuỗi
  giả "A1B2". Chuỗi đó sẽ bị MỌI app ngân hàng từ chối. Không dùng làm
  test vector — dùng file này.
=====================================================================
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

# --- Hằng số EMVCo / NAPAS ------------------------------------------------
GUID_NAPAS = "A000000727"
CURRENCY_VND = "704"
COUNTRY_VN = "VN"

SERVICE_TO_ACCOUNT = "QRIBFTTA"  # chuyển tới TÀI KHOẢN — dùng cho F&B
SERVICE_TO_CARD = "QRIBFTTC"     # chuyển tới SỐ THẺ

INIT_STATIC = "11"
INIT_DYNAMIC = "12"

# Tag ID
TAG_PAYLOAD_FORMAT = "00"
TAG_INIT_METHOD = "01"
TAG_MERCHANT_ACCOUNT = "38"
TAG_CURRENCY = "53"
TAG_AMOUNT = "54"
TAG_COUNTRY = "58"
TAG_MERCHANT_NAME = "59"
TAG_MERCHANT_CITY = "60"
TAG_ADDITIONAL_DATA = "62"
TAG_CRC = "63"

# Sub-tag của 38
SUB_GUID = "00"
SUB_BENEFICIARY = "01"
SUB_SERVICE_CODE = "02"
# Sub-tag của 38.01
SUB_ACQUIRER_ID = "00"
SUB_ACCOUNT_NO = "01"
# Sub-tag của 62
SUB_PURPOSE = "08"


class VietQrError(ValueError):
    """Lỗi dữ liệu đầu vào không hợp lệ để sinh VietQR."""


# --- CRC-16/CCITT-FALSE ---------------------------------------------------
def crc16_ccitt_false(data: str) -> int:
    """
    CRC-16/CCITT-FALSE: poly=0x1021, init=0xFFFF, refin=false,
    refout=false, xorout=0x0000.

    KHÔNG phải CRC-16/CCITT thông thường (init=0x0000) và cũng KHÔNG phải
    CRC-16/XMODEM. Dùng sai biến thể là lỗi phổ biến nhất khi tích hợp
    VietQR — QR trông vẫn quét được nhưng app ngân hàng báo "mã không hợp lệ".
    """
    crc = 0xFFFF
    for byte in data.encode("utf-8"):
        crc ^= byte << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc & 0xFFFF


def tlv(tag: str, value: str) -> str:
    """Đóng gói một trường TLV: 2 ký tự tag + 2 chữ số độ dài + giá trị."""
    length = len(value)
    if length > 99:
        raise VietQrError(
            f"Trường {tag} dài {length} ký tự, vượt giới hạn 99 của EMVCo"
        )
    return f"{tag}{length:02d}{value}"


# --- Chuẩn hoá tiếng Việt -------------------------------------------------
_NON_ALNUM = re.compile(r"[^A-Z0-9 ]")


def strip_vietnamese(text: str) -> str:
    """
    Bỏ dấu tiếng Việt và chuyển hoa. EMVCo khuyến nghị Common Character Set;
    nhiều app ngân hàng cắt hoặc làm hỏng ký tự có dấu trong nội dung
    chuyển khoản, nên chuẩn hoá trước là bắt buộc trên thực tế.
    """
    text = text.replace("Đ", "D").replace("đ", "d")
    decomposed = unicodedata.normalize("NFD", text)
    no_marks = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return unicodedata.normalize("NFC", no_marks).upper()


# Trần kỹ thuật của nội dung chuyển khoản.
#   Tag 62 (Additional Data) tối đa 99 ký tự theo EMVCo.
#   Bên trong nó là tag 08 tốn thêm 4 ký tự header (`08` + 2 chữ số độ dài).
#   => giá trị thực chỉ được tối đa 99 - 4 = 95 ký tự.
# Cắt ở 99 rồi mới bọc TLV sẽ tạo ra trường 62 dài 103 và bị ngân hàng từ chối.
MAX_PURPOSE_LEN = 95

# Khuyến nghị vận hành: nhiều ngân hàng cắt nội dung chuyển khoản quanh mốc
# 50 ký tự khi hiển thị và khi bắn webhook. Vì vậy mã hoá đơn phải nằm ở
# ĐẦU chuỗi để không bao giờ bị cắt mất.
RECOMMENDED_PURPOSE_LEN = 50


def sanitize_add_info(text: str, max_len: int = MAX_PURPOSE_LEN) -> str:
    """
    Chuẩn hoá nội dung chuyển khoản: bỏ dấu, chỉ giữ [A-Z0-9 ], gộp khoảng
    trắng thừa, cắt còn tối đa `max_len` ký tự.

    Đây là lý do `orders.order_code` được thiết kế chỉ gồm chữ + số
    (NINOPOS100234): sau khi qua hàm này nó không đổi, nên webhook ngân hàng
    luôn đối soát khớp 100%.
    """
    cleaned = _NON_ALNUM.sub(" ", strip_vietnamese(text))
    return " ".join(cleaned.split())[:max_len]


# --- Bộ dựng payload ------------------------------------------------------
@dataclass
class VietQrRequest:
    acq_id: str                      # BIN ngân hàng, 6 chữ số (970436 = Vietcombank)
    account_no: str                  # số tài khoản nhận tiền
    amount: int | None = None        # VND, số nguyên. None = QR tĩnh
    add_info: str = ""               # nội dung chuyển khoản = orders.order_code
    account_name: str = ""           # tên merchant (tag 59), tuỳ chọn
    merchant_city: str = ""          # tag 60, tuỳ chọn
    service_code: str = SERVICE_TO_ACCOUNT

    def validate(self) -> None:
        if not re.fullmatch(r"\d{6}", self.acq_id or ""):
            raise VietQrError(
                f"acqId phải là 6 chữ số (mã BIN NAPAS), nhận được: {self.acq_id!r}"
            )
        if not re.fullmatch(r"[A-Za-z0-9]{1,19}", self.account_no or ""):
            raise VietQrError(
                f"accountNo phải gồm 1-19 ký tự chữ/số, nhận được: {self.account_no!r}"
            )
        if self.amount is not None:
            if not isinstance(self.amount, int) or isinstance(self.amount, bool):
                raise VietQrError("amount phải là số nguyên VND (không dùng float)")
            if self.amount <= 0:
                raise VietQrError(f"amount phải lớn hơn 0, nhận được: {self.amount}")
            if self.amount > 9_999_999_999:
                raise VietQrError(f"amount vượt trần 9.999.999.999đ: {self.amount}")
        if self.service_code not in (SERVICE_TO_ACCOUNT, SERVICE_TO_CARD):
            raise VietQrError(f"service_code không hợp lệ: {self.service_code!r}")


def build_payload(req: VietQrRequest) -> str:
    """Dựng chuỗi VietQR EMVCo hoàn chỉnh, đã kèm CRC."""
    req.validate()

    beneficiary = tlv(SUB_ACQUIRER_ID, req.acq_id) + tlv(SUB_ACCOUNT_NO, req.account_no)
    merchant_account = (
        tlv(SUB_GUID, GUID_NAPAS)
        + tlv(SUB_BENEFICIARY, beneficiary)
        + tlv(SUB_SERVICE_CODE, req.service_code)
    )

    is_dynamic = req.amount is not None
    parts = [
        tlv(TAG_PAYLOAD_FORMAT, "01"),
        tlv(TAG_INIT_METHOD, INIT_DYNAMIC if is_dynamic else INIT_STATIC),
        tlv(TAG_MERCHANT_ACCOUNT, merchant_account),
        tlv(TAG_CURRENCY, CURRENCY_VND),
    ]
    if is_dynamic:
        parts.append(tlv(TAG_AMOUNT, str(req.amount)))
    parts.append(tlv(TAG_COUNTRY, COUNTRY_VN))

    if req.account_name:
        parts.append(tlv(TAG_MERCHANT_NAME, sanitize_add_info(req.account_name)[:25]))
    if req.merchant_city:
        parts.append(tlv(TAG_MERCHANT_CITY, sanitize_add_info(req.merchant_city)[:15]))

    if req.add_info:
        info = sanitize_add_info(req.add_info)
        if info:
            parts.append(tlv(TAG_ADDITIONAL_DATA, tlv(SUB_PURPOSE, info)))

    body = "".join(parts) + TAG_CRC + "04"
    return body + f"{crc16_ccitt_false(body):04X}"


# --- Bộ giải mã (dùng để kiểm thử và đối soát webhook) --------------------
def parse_tlv(payload: str) -> dict[str, str]:
    """Tách chuỗi TLV thành dict {tag: value}. Ném lỗi nếu độ dài sai."""
    result: dict[str, str] = {}
    i = 0
    n = len(payload)
    while i < n:
        if i + 4 > n:
            raise VietQrError(f"Chuỗi TLV cụt tại vị trí {i}")
        tag = payload[i : i + 2]
        try:
            length = int(payload[i + 2 : i + 4])
        except ValueError as exc:
            raise VietQrError(
                f"Độ dài không phải số tại vị trí {i + 2}: {payload[i + 2 : i + 4]!r}"
            ) from exc
        start, end = i + 4, i + 4 + length
        if end > n:
            raise VietQrError(
                f"Trường {tag} khai độ dài {length} nhưng chuỗi chỉ còn {n - start} ký tự"
            )
        result[tag] = payload[start:end]
        i = end
    return result


@dataclass
class VietQrDecoded:
    acq_id: str = ""
    account_no: str = ""
    service_code: str = ""
    amount: int | None = None
    add_info: str = ""
    merchant_name: str = ""
    is_dynamic: bool = False
    crc_valid: bool = False
    raw_tags: dict[str, str] = field(default_factory=dict)


def decode_payload(payload: str) -> VietQrDecoded:
    """Giải mã và kiểm tra CRC của một chuỗi VietQR."""
    if len(payload) < 8:
        raise VietQrError("Chuỗi quá ngắn để là một mã VietQR hợp lệ")

    crc_marker = payload.rfind("6304")
    if crc_marker == -1 or crc_marker + 8 != len(payload):
        raise VietQrError("Không tìm thấy trường CRC (6304) ở cuối chuỗi")

    body = payload[: crc_marker + 4]
    given_crc = payload[crc_marker + 4 :].upper()
    crc_ok = given_crc == f"{crc16_ccitt_false(body):04X}"

    tags = parse_tlv(payload)
    out = VietQrDecoded(crc_valid=crc_ok, raw_tags=tags)
    out.is_dynamic = tags.get(TAG_INIT_METHOD) == INIT_DYNAMIC
    out.merchant_name = tags.get(TAG_MERCHANT_NAME, "")

    if TAG_AMOUNT in tags:
        out.amount = int(tags[TAG_AMOUNT])

    if TAG_MERCHANT_ACCOUNT in tags:
        mai = parse_tlv(tags[TAG_MERCHANT_ACCOUNT])
        out.service_code = mai.get(SUB_SERVICE_CODE, "")
        if SUB_BENEFICIARY in mai:
            ben = parse_tlv(mai[SUB_BENEFICIARY])
            out.acq_id = ben.get(SUB_ACQUIRER_ID, "")
            out.account_no = ben.get(SUB_ACCOUNT_NO, "")

    if TAG_ADDITIONAL_DATA in tags:
        add = parse_tlv(tags[TAG_ADDITIONAL_DATA])
        out.add_info = add.get(SUB_PURPOSE, "")

    return out


# --- Đối soát webhook ngân hàng ------------------------------------------
def extract_order_code(transfer_content: str, prefix: str = "NINOPOS") -> str | None:
    """
    Rút mã hoá đơn ra khỏi nội dung chuyển khoản thực tế của ngân hàng.

    Ngân hàng thường CHÈN THÊM chữ vào nội dung, ví dụ:
      "NINOPOS100234 CHUYEN KHOAN"
      "MBVCB.123456.NINOPOS100234.CT tu 0123456789"
      "ninopos100234 thanh toan"
    Vì vậy webhook KHÔNG được so sánh bằng `==` mà phải dò theo regex này.
    """
    match = re.search(
        rf"{re.escape(prefix)}\d+", strip_vietnamese(transfer_content or "")
    )
    return match.group(0) if match else None


if __name__ == "__main__":
    demo = VietQrRequest(
        acq_id="970436",
        account_no="0123456789",
        amount=150_000,
        add_info="NINOPOS100234",
    )
    payload = build_payload(demo)
    print("Payload:", payload)
    print("Decoded:", decode_payload(payload))
