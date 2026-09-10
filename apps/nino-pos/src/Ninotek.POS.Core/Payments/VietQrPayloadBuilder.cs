// =====================================================================
//  NINOTEK F&B POS — VietQR EMVCo Builder (C# / .NET 8)
// =====================================================================
//  Bản port 1-1 của tools/vietqr-reference/vietqr_reference.py
//
//  ⚠️ KHÔNG sửa file này mà không chạy lại:
//        dotnet test tests/Ninotek.POS.Core.Tests
//  Test đối chiếu trực tiếp với golden vectors tại
//        packages/api-contracts/data/vietqr-test-vectors.json
//  cùng bộ vectors mà bản TypeScript của NinoCloud phải pass.
// =====================================================================

using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Ninotek.POS.Core.Payments;

public sealed class VietQrException : Exception
{
    public VietQrException(string message) : base(message) { }
}

/// <summary>Yêu cầu sinh mã VietQR động cho một hoá đơn.</summary>
public sealed record VietQrRequest
{
    /// <summary>Mã BIN ngân hàng theo NAPAS, đúng 6 chữ số. VD: "970436" = Vietcombank.</summary>
    public required string AcqId { get; init; }

    /// <summary>Số tài khoản nhận tiền, 1–19 ký tự chữ/số.</summary>
    public required string AccountNo { get; init; }

    /// <summary>Số tiền VND. <c>null</c> ⇒ sinh QR tĩnh (không có tag 54).</summary>
    public long? Amount { get; init; }

    /// <summary>Nội dung chuyển khoản — luôn dùng <c>orders.order_code</c>.</summary>
    public string AddInfo { get; init; } = string.Empty;

    /// <summary>Tên merchant (tag 59), tuỳ chọn, tối đa 25 ký tự.</summary>
    public string AccountName { get; init; } = string.Empty;

    /// <summary>Thành phố (tag 60), tuỳ chọn, tối đa 15 ký tự.</summary>
    public string MerchantCity { get; init; } = string.Empty;

    public string ServiceCode { get; init; } = VietQrPayloadBuilder.ServiceToAccount;
}

/// <summary>Kết quả giải mã một chuỗi VietQR.</summary>
public sealed record VietQrDecoded
{
    public string AcqId { get; init; } = string.Empty;
    public string AccountNo { get; init; } = string.Empty;
    public string ServiceCode { get; init; } = string.Empty;
    public long? Amount { get; init; }
    public string AddInfo { get; init; } = string.Empty;
    public string MerchantName { get; init; } = string.Empty;
    public bool IsDynamic { get; init; }
    public bool CrcValid { get; init; }
}

public static class VietQrPayloadBuilder
{
    public const string GuidNapas = "A000000727";
    public const string CurrencyVnd = "704";
    public const string CountryVn = "VN";

    /// <summary>Chuyển tới TÀI KHOẢN — dùng cho F&amp;B.</summary>
    public const string ServiceToAccount = "QRIBFTTA";

    /// <summary>Chuyển tới SỐ THẺ.</summary>
    public const string ServiceToCard = "QRIBFTTC";

    public const string InitStatic = "11";
    public const string InitDynamic = "12";

    /// <summary>
    /// Tag 62 (Additional Data) tối đa 99 ký tự theo EMVCo. Tag 08 bên trong tốn thêm
    /// 4 ký tự header, nên nội dung chuyển khoản chỉ được tối đa 95 ký tự.
    /// Cắt ở 99 rồi mới bọc TLV sẽ tạo trường 62 dài 103 và bị ngân hàng từ chối.
    /// </summary>
    public const int MaxPurposeLength = 95;

    /// <summary>
    /// Nhiều ngân hàng cắt nội dung chuyển khoản quanh mốc 50 ký tự khi bắn webhook.
    /// Mã hoá đơn phải nằm ở ĐẦU chuỗi để không bị cắt mất.
    /// </summary>
    public const int RecommendedPurposeLength = 50;

    private static readonly Regex AcqIdPattern = new(@"^\d{6}$", RegexOptions.Compiled);
    private static readonly Regex AccountPattern = new(@"^[A-Za-z0-9]{1,19}$", RegexOptions.Compiled);
    private static readonly Regex NonAlnumPattern = new(@"[^A-Z0-9 ]", RegexOptions.Compiled);
    private static readonly Regex WhitespacePattern = new(@"\s+", RegexOptions.Compiled);

    // -----------------------------------------------------------------
    // CRC-16/CCITT-FALSE
    // -----------------------------------------------------------------

    /// <summary>
    /// CRC-16/CCITT-FALSE: poly=0x1021, init=0xFFFF, refIn/refOut=false, xorOut=0x0000.
    /// <para>
    /// ⚠️ KHÔNG phải CRC-16/XMODEM (init=0x0000). Dùng sai biến thể là lỗi tích hợp
    /// VietQR phổ biến nhất — QR vẫn quét được nhưng app ngân hàng báo "mã không hợp lệ".
    /// </para>
    /// Kiểm chứng: <c>Crc16CcittFalse("123456789") == 0x29B1</c>
    /// </summary>
    public static ushort Crc16CcittFalse(string data)
    {
        ushort crc = 0xFFFF;
        foreach (byte b in Encoding.UTF8.GetBytes(data))
        {
            crc ^= (ushort)(b << 8);
            for (int i = 0; i < 8; i++)
            {
                crc = (crc & 0x8000) != 0
                    ? (ushort)((crc << 1) ^ 0x1021)
                    : (ushort)(crc << 1);
            }
        }
        return crc;
    }

    // -----------------------------------------------------------------
    // TLV
    // -----------------------------------------------------------------

    /// <summary>Đóng gói một trường TLV: 2 ký tự tag + 2 chữ số độ dài + giá trị.</summary>
    public static string Tlv(string tag, string value)
    {
        if (value.Length > 99)
        {
            throw new VietQrException(
                $"Trường {tag} dài {value.Length} ký tự, vượt giới hạn 99 của EMVCo");
        }
        return string.Concat(tag, value.Length.ToString("D2", CultureInfo.InvariantCulture), value);
    }

    // -----------------------------------------------------------------
    // Chuẩn hoá tiếng Việt
    // -----------------------------------------------------------------

    /// <summary>Bỏ dấu tiếng Việt và chuyển hoa.</summary>
    public static string StripVietnamese(string text)
    {
        if (string.IsNullOrEmpty(text)) return string.Empty;

        string prepared = text.Replace('Đ', 'D').Replace('đ', 'd');
        string decomposed = prepared.Normalize(NormalizationForm.FormD);

        var sb = new StringBuilder(decomposed.Length);
        foreach (char c in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
            {
                sb.Append(c);
            }
        }
        return sb.ToString().Normalize(NormalizationForm.FormC).ToUpperInvariant();
    }

    /// <summary>
    /// Chuẩn hoá nội dung chuyển khoản: bỏ dấu, chỉ giữ [A-Z0-9 ], gộp khoảng trắng, cắt độ dài.
    /// </summary>
    public static string SanitizeAddInfo(string text, int maxLength = MaxPurposeLength)
    {
        if (string.IsNullOrEmpty(text)) return string.Empty;

        string cleaned = NonAlnumPattern.Replace(StripVietnamese(text), " ");
        cleaned = WhitespacePattern.Replace(cleaned, " ").Trim();
        return cleaned.Length <= maxLength ? cleaned : cleaned[..maxLength];
    }

    // -----------------------------------------------------------------
    // Dựng payload
    // -----------------------------------------------------------------

    private static void Validate(VietQrRequest req)
    {
        if (!AcqIdPattern.IsMatch(req.AcqId ?? string.Empty))
        {
            throw new VietQrException(
                $"acqId phải là 6 chữ số (mã BIN NAPAS), nhận được: \"{req.AcqId}\"");
        }
        if (!AccountPattern.IsMatch(req.AccountNo ?? string.Empty))
        {
            throw new VietQrException(
                $"accountNo phải gồm 1-19 ký tự chữ/số, nhận được: \"{req.AccountNo}\"");
        }
        if (req.Amount.HasValue)
        {
            if (req.Amount.Value <= 0)
            {
                throw new VietQrException($"amount phải lớn hơn 0, nhận được: {req.Amount.Value}");
            }
            if (req.Amount.Value > 9_999_999_999L)
            {
                throw new VietQrException($"amount vượt trần 9.999.999.999đ: {req.Amount.Value}");
            }
        }
        if (req.ServiceCode is not (ServiceToAccount or ServiceToCard))
        {
            throw new VietQrException($"serviceCode không hợp lệ: \"{req.ServiceCode}\"");
        }
    }

    /// <summary>Dựng chuỗi VietQR EMVCo hoàn chỉnh, đã kèm CRC.</summary>
    public static string Build(VietQrRequest req)
    {
        ArgumentNullException.ThrowIfNull(req);
        Validate(req);

        string beneficiary = Tlv("00", req.AcqId) + Tlv("01", req.AccountNo);
        string merchantAccount =
            Tlv("00", GuidNapas) + Tlv("01", beneficiary) + Tlv("02", req.ServiceCode);

        bool isDynamic = req.Amount.HasValue;

        var sb = new StringBuilder(160);
        sb.Append(Tlv("00", "01"));
        sb.Append(Tlv("01", isDynamic ? InitDynamic : InitStatic));
        sb.Append(Tlv("38", merchantAccount));
        sb.Append(Tlv("53", CurrencyVnd));
        if (isDynamic)
        {
            sb.Append(Tlv("54", req.Amount!.Value.ToString(CultureInfo.InvariantCulture)));
        }
        sb.Append(Tlv("58", CountryVn));

        if (!string.IsNullOrEmpty(req.AccountName))
        {
            sb.Append(Tlv("59", SanitizeAddInfo(req.AccountName, 25)));
        }
        if (!string.IsNullOrEmpty(req.MerchantCity))
        {
            sb.Append(Tlv("60", SanitizeAddInfo(req.MerchantCity, 15)));
        }
        if (!string.IsNullOrEmpty(req.AddInfo))
        {
            string info = SanitizeAddInfo(req.AddInfo);
            if (info.Length > 0)
            {
                sb.Append(Tlv("62", Tlv("08", info)));
            }
        }

        sb.Append("6304");
        string body = sb.ToString();
        return body + Crc16CcittFalse(body).ToString("X4", CultureInfo.InvariantCulture);
    }

    // -----------------------------------------------------------------
    // Giải mã
    // -----------------------------------------------------------------

    /// <summary>Tách chuỗi TLV thành dictionary {tag: value}.</summary>
    public static Dictionary<string, string> ParseTlv(string payload)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        int i = 0;
        while (i < payload.Length)
        {
            if (i + 4 > payload.Length)
            {
                throw new VietQrException($"Chuỗi TLV cụt tại vị trí {i}");
            }
            string tag = payload.Substring(i, 2);
            string rawLen = payload.Substring(i + 2, 2);
            if (!int.TryParse(rawLen, NumberStyles.None, CultureInfo.InvariantCulture, out int len))
            {
                throw new VietQrException($"Độ dài không phải số tại vị trí {i + 2}: \"{rawLen}\"");
            }
            int start = i + 4;
            if (start + len > payload.Length)
            {
                throw new VietQrException(
                    $"Trường {tag} khai độ dài {len} nhưng chuỗi chỉ còn {payload.Length - start} ký tự");
            }
            result[tag] = payload.Substring(start, len);
            i = start + len;
        }
        return result;
    }

    /// <summary>Giải mã và kiểm tra CRC của một chuỗi VietQR.</summary>
    public static VietQrDecoded Decode(string payload)
    {
        ArgumentNullException.ThrowIfNull(payload);
        if (payload.Length < 8)
        {
            throw new VietQrException("Chuỗi quá ngắn để là một mã VietQR hợp lệ");
        }

        int marker = payload.LastIndexOf("6304", StringComparison.Ordinal);
        if (marker == -1 || marker + 8 != payload.Length)
        {
            throw new VietQrException("Không tìm thấy trường CRC (6304) ở cuối chuỗi");
        }

        string body = payload[..(marker + 4)];
        string givenCrc = payload[(marker + 4)..].ToUpperInvariant();
        bool crcValid = givenCrc == Crc16CcittFalse(body).ToString("X4", CultureInfo.InvariantCulture);

        var tags = ParseTlv(payload);

        string acqId = string.Empty, accountNo = string.Empty, serviceCode = string.Empty;
        if (tags.TryGetValue("38", out string? mai))
        {
            var maiTags = ParseTlv(mai);
            maiTags.TryGetValue("02", out string? svc);
            serviceCode = svc ?? string.Empty;
            if (maiTags.TryGetValue("01", out string? ben))
            {
                var benTags = ParseTlv(ben);
                benTags.TryGetValue("00", out string? a);
                benTags.TryGetValue("01", out string? n);
                acqId = a ?? string.Empty;
                accountNo = n ?? string.Empty;
            }
        }

        string addInfo = string.Empty;
        if (tags.TryGetValue("62", out string? additional))
        {
            ParseTlv(additional).TryGetValue("08", out string? purpose);
            addInfo = purpose ?? string.Empty;
        }

        long? amount = null;
        if (tags.TryGetValue("54", out string? amt) &&
            long.TryParse(amt, NumberStyles.None, CultureInfo.InvariantCulture, out long parsed))
        {
            amount = parsed;
        }

        tags.TryGetValue("59", out string? merchantName);
        tags.TryGetValue("01", out string? initMethod);

        return new VietQrDecoded
        {
            AcqId = acqId,
            AccountNo = accountNo,
            ServiceCode = serviceCode,
            Amount = amount,
            AddInfo = addInfo,
            MerchantName = merchantName ?? string.Empty,
            IsDynamic = initMethod == InitDynamic,
            CrcValid = crcValid,
        };
    }

    /// <summary>
    /// Rút mã hoá đơn ra khỏi nội dung chuyển khoản thực tế của ngân hàng.
    /// <para>
    /// Ngân hàng CHÈN THÊM chữ vào nội dung, ví dụ:
    /// <c>"NINOPOS100234 CHUYEN KHOAN"</c>,
    /// <c>"MBVCB.9876543210.NINOPOS100234.CT tu 0123456789"</c>.
    /// ⚠️ Webhook KHÔNG được so sánh bằng <c>==</c> mà phải dò theo regex này.
    /// </para>
    /// </summary>
    public static string? ExtractOrderCode(string transferContent, string prefix = "NINOPOS")
    {
        if (string.IsNullOrEmpty(transferContent)) return null;

        var match = Regex.Match(
            StripVietnamese(transferContent),
            $"{Regex.Escape(prefix)}\\d+",
            RegexOptions.None,
            TimeSpan.FromMilliseconds(200));

        return match.Success ? match.Value : null;
    }
}
