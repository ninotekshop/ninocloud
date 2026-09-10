// =====================================================================
//  NINOTEK F&B POS — Xác thực License Key (C# / .NET 8)
// =====================================================================
//  Bản đối xứng của tools/license-generator/ninotek_license.py
//
//  Cơ chế: chữ ký số Ed25519. NinoPOS chỉ nhúng PUBLIC KEY nên chỉ xác thực
//  được, không tạo được key giả — dù kẻ tấn công có dịch ngược toàn bộ .exe.
//
//  ⚠️ .NET 8 CHƯA có Ed25519 trong System.Security.Cryptography (chỉ từ .NET 10),
//     nên dùng BouncyCastle. Đã khai trong Ninotek.POS.Licensing.csproj.
//
//  ⚠️ HAI ĐIỀU KHÔNG ĐƯỢC LÀM SAI:
//   1. Payload phải được ký/kiểm trên ĐÚNG chuỗi JSON gốc, byte-for-byte.
//      Deserialize rồi serialize lại sẽ đổi thứ tự khoá và khoảng trắng →
//      chữ ký không bao giờ khớp. Vì vậy code dưới đây kiểm chữ ký TRƯỚC,
//      trên chuỗi thô, rồi mới parse.
//   2. Mã hoá là Base32, KHÔNG phải Base64. Bảng chữ cái base64url có chứa
//      dấu '-', trùng với ký tự chia nhóm của License Key; xoá dấu '-' khi
//      xác thực sẽ xoá luôn cả dữ liệu. Base32 chỉ gồm [A-Z2-7] nên an toàn.
// =====================================================================

using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using Org.BouncyCastle.OpenSsl;

namespace Ninotek.POS.Licensing;

public enum LicenseState
{
    Valid,
    Malformed,
    InvalidSignature,
    WrongMachine,
    Expired,
    ClockTampered,
}

public sealed record LicensePayload
{
    [JsonPropertyName("mid")] public string MachineId { get; init; } = string.Empty;
    [JsonPropertyName("pkg")] public string Package { get; init; } = string.Empty;
    [JsonPropertyName("exp")] public string? ExpiryDate { get; init; }
    [JsonPropertyName("dev")] public int MaxDevices { get; init; }
    [JsonPropertyName("iss")] public string IssuedAt { get; init; } = string.Empty;
    [JsonPropertyName("sid")] public string StoreId { get; init; } = string.Empty;
}

public sealed record LicenseVerifyResult(
    LicenseState State,
    string Message,
    LicensePayload? Payload = null,
    int? DaysRemaining = null)
{
    public bool IsValid => State == LicenseState.Valid;
}

public static class LicenseValidator
{
    private const string Prefix = "NINO-";
    private const int SignatureBytes = 64;   // Ed25519 luôn đúng 64 byte

    /// <summary>
    /// Xác thực một License Key.
    /// </summary>
    /// <param name="licenseKey">Chuỗi dạng <c>NINO-XXXXX-XXXXX-...</c></param>
    /// <param name="publicKeyPem">Public key Ed25519 dạng PEM (nhúng trong .exe).</param>
    /// <param name="currentMachineId">Vân tay phần cứng máy đang chạy.</param>
    /// <param name="today">Ngày hiện tại (tiêm vào để test được).</param>
    /// <param name="lastVerifiedAt">
    /// Mốc thời gian server xác nhận gần nhất, đọc từ bảng <c>license_local</c>.
    /// Nếu đồng hồ Windows lùi về TRƯỚC mốc này thì khách đang cố kéo dài
    /// license đã hết hạn — đây là lớp phòng thủ duy nhất cho việc đó khi máy
    /// chạy offline dài ngày.
    /// </param>
    public static LicenseVerifyResult Verify(
        string licenseKey,
        string publicKeyPem,
        string currentMachineId,
        DateOnly? today = null,
        DateTime? lastVerifiedAt = null)
    {
        DateOnly now = today ?? DateOnly.FromDateTime(DateTime.UtcNow);

        // --- Chống lùi đồng hồ hệ thống ---
        if (lastVerifiedAt.HasValue &&
            now < DateOnly.FromDateTime(lastVerifiedAt.Value))
        {
            return new LicenseVerifyResult(
                LicenseState.ClockTampered,
                "Đồng hồ hệ thống đang sớm hơn lần xác nhận gần nhất với máy chủ. " +
                "Vui lòng chỉnh lại giờ Windows cho đúng.");
        }

        // --- Giải mã Base32 ---
        byte[] blob;
        string payloadJson;
        byte[] signature;
        try
        {
            string compact = Unformat(licenseKey);
            blob = Base32Decode(compact);
            if (blob.Length <= SignatureBytes)
            {
                return new LicenseVerifyResult(
                    LicenseState.Malformed, "Chuỗi license quá ngắn — thiếu dữ liệu");
            }
            payloadJson = Encoding.UTF8.GetString(blob, 0, blob.Length - SignatureBytes);
            signature = blob[^SignatureBytes..];
        }
        catch (Exception ex)
        {
            return new LicenseVerifyResult(
                LicenseState.Malformed, $"Chuỗi license hỏng hoặc sai định dạng: {ex.Message}");
        }

        // --- Kiểm chữ ký TRƯỚC, trên chuỗi JSON thô ---
        try
        {
            var publicKey = LoadEd25519PublicKey(publicKeyPem);
            var verifier = new Ed25519Signer();
            verifier.Init(false, publicKey);
            byte[] message = Encoding.UTF8.GetBytes(payloadJson);
            verifier.BlockUpdate(message, 0, message.Length);

            if (!verifier.VerifySignature(signature))
            {
                return new LicenseVerifyResult(
                    LicenseState.InvalidSignature,
                    "Chữ ký số không hợp lệ — license bị sửa đổi hoặc làm giả");
            }
        }
        catch (Exception ex)
        {
            return new LicenseVerifyResult(
                LicenseState.InvalidSignature, $"Không xác thực được chữ ký: {ex.Message}");
        }

        // --- Giờ mới an toàn để đọc nội dung ---
        LicensePayload? payload;
        try
        {
            payload = JsonSerializer.Deserialize<LicensePayload>(payloadJson);
        }
        catch (JsonException ex)
        {
            return new LicenseVerifyResult(
                LicenseState.Malformed, $"Nội dung license không đọc được: {ex.Message}");
        }
        if (payload is null)
        {
            return new LicenseVerifyResult(LicenseState.Malformed, "Nội dung license rỗng");
        }

        // --- Vân tay máy ---
        if (!string.Equals(payload.MachineId, currentMachineId, StringComparison.Ordinal))
        {
            return new LicenseVerifyResult(
                LicenseState.WrongMachine,
                "License được cấp cho máy khác (mã máy không khớp)", payload);
        }

        // --- Hạn dùng ---
        if (string.IsNullOrEmpty(payload.ExpiryDate))
        {
            return new LicenseVerifyResult(
                LicenseState.Valid, "Hợp lệ (bản quyền vĩnh viễn)", payload);
        }

        if (!DateOnly.TryParse(payload.ExpiryDate, out DateOnly expiry))
        {
            return new LicenseVerifyResult(
                LicenseState.Malformed, $"Ngày hết hạn sai định dạng: {payload.ExpiryDate}", payload);
        }

        int remaining = expiry.DayNumber - now.DayNumber;
        return remaining < 0
            ? new LicenseVerifyResult(
                LicenseState.Expired, $"License đã hết hạn ngày {payload.ExpiryDate}", payload, remaining)
            : new LicenseVerifyResult(LicenseState.Valid, "Hợp lệ", payload, remaining);
    }

    // -----------------------------------------------------------------

    private static string Unformat(string key)
    {
        if (string.IsNullOrWhiteSpace(key) ||
            !key.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new FormatException($"License key phải bắt đầu bằng '{Prefix}'");
        }
        // An toàn: bảng chữ cái Base32 [A-Z2-7] không chứa '-'
        return key[Prefix.Length..].Replace("-", string.Empty).Trim().ToUpperInvariant();
    }

    private static byte[] Base32Decode(string input)
    {
        int pad = (8 - (input.Length % 8)) % 8;
        string padded = input + new string('=', pad);

        const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        var output = new List<byte>(padded.Length * 5 / 8);
        int buffer = 0, bitsLeft = 0;

        foreach (char c in padded)
        {
            if (c == '=') break;
            int index = Alphabet.IndexOf(c);
            if (index < 0) throw new FormatException($"Ký tự Base32 không hợp lệ: '{c}'");

            buffer = (buffer << 5) | index;
            bitsLeft += 5;
            if (bitsLeft >= 8)
            {
                output.Add((byte)((buffer >> (bitsLeft - 8)) & 0xFF));
                bitsLeft -= 8;
            }
        }
        return output.ToArray();
    }

    private static Ed25519PublicKeyParameters LoadEd25519PublicKey(string pem)
    {
        using var reader = new StringReader(pem);
        object obj = new PemReader(reader).ReadObject();
        return obj as Ed25519PublicKeyParameters
            ?? throw new InvalidOperationException(
                "Public key không phải Ed25519. Sinh lại bằng: " +
                "python tools/license-generator/ninotek_license.py genkeys");
    }
}
