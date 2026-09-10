// =====================================================================
//  NINOTEK F&B POS — Kiểm thử VietQR đối chiếu golden vectors
// =====================================================================
//  Bộ test này đọc THẲNG file
//      packages/api-contracts/data/vietqr-test-vectors.json
//  — cùng bộ dữ liệu mà bản TypeScript của NinoCloud phải pass.
//
//  Nếu C# và TypeScript sinh ra chuỗi khác nhau, một trong hai sẽ tạo mã QR
//  mà ngân hàng từ chối. Test này là thứ chặn việc đó lọt lên production.
//
//  Golden vectors được sinh bởi tools/vietqr-reference/vietqr_reference.py và
//  đã đối chứng với thư viện độc lập 'vietnam-qr-pay' trên 5009 ca ngẫu nhiên.
// =====================================================================

using System.Globalization;
using System.Text.Json;
using FluentAssertions;
using Ninotek.POS.Core.Payments;
using Xunit;

namespace Ninotek.POS.Core.Tests;

public class VietQrPayloadBuilderTests
{
    private static readonly JsonDocument Vectors = LoadVectors();

    private static JsonDocument LoadVectors()
    {
        string path = Path.Combine(AppContext.BaseDirectory, "vietqr-test-vectors.json");
        if (!File.Exists(path))
        {
            throw new FileNotFoundException(
                "Không tìm thấy golden vectors. Kiểm tra mục <None Include=...> trong " +
                "Ninotek.POS.Core.Tests.csproj — file phải được copy sang thư mục output.",
                path);
        }
        return JsonDocument.Parse(File.ReadAllText(path));
    }

    public static TheoryData<string> ValidVectorNames()
    {
        var data = new TheoryData<string>();
        foreach (var v in Vectors.RootElement.GetProperty("vectors").EnumerateArray())
        {
            data.Add(v.GetProperty("name").GetString()!);
        }
        return data;
    }

    public static TheoryData<string> InvalidInputNames()
    {
        var data = new TheoryData<string>();
        foreach (var v in Vectors.RootElement.GetProperty("invalidInputs").EnumerateArray())
        {
            data.Add(v.GetProperty("name").GetString()!);
        }
        return data;
    }

    private static JsonElement FindVector(string collection, string name) =>
        Vectors.RootElement.GetProperty(collection).EnumerateArray()
            .First(v => v.GetProperty("name").GetString() == name);

    private static long? ReadAmount(JsonElement input)
    {
        var amount = input.GetProperty("amount");
        return amount.ValueKind == JsonValueKind.Null ? null : amount.GetInt64();
    }

    // -----------------------------------------------------------------
    // CRC
    // -----------------------------------------------------------------

    [Fact]
    public void Crc16_DungBienThe_CcittFalse()
    {
        // Giá trị kiểm chứng chuẩn của CRC-16/CCITT-FALSE.
        // Nếu ra 0x31C3 thì đang dùng nhầm CRC-16/XMODEM (init = 0x0000) —
        // đây là lỗi tích hợp VietQR phổ biến nhất.
        VietQrPayloadBuilder.Crc16CcittFalse("123456789").Should().Be(0x29B1);
    }

    [Fact]
    public void Crc16_KhopVoiGiaTriTrongGoldenVectors()
    {
        string expected = Vectors.RootElement
            .GetProperty("crcAlgorithm")
            .GetProperty("checkValueOf123456789").GetString()!;

        VietQrPayloadBuilder.Crc16CcittFalse("123456789")
            .ToString("X4", CultureInfo.InvariantCulture).Should().Be(expected);
    }

    // -----------------------------------------------------------------
    // Sinh payload
    // -----------------------------------------------------------------

    [Theory]
    [MemberData(nameof(ValidVectorNames))]
    public void Build_KhopChinhXacGoldenVector(string name)
    {
        var v = FindVector("vectors", name);
        var input = v.GetProperty("input");

        string actual = VietQrPayloadBuilder.Build(new VietQrRequest
        {
            AcqId = input.GetProperty("acqId").GetString()!,
            AccountNo = input.GetProperty("accountNo").GetString()!,
            Amount = ReadAmount(input),
            AddInfo = input.GetProperty("addInfo").GetString() ?? string.Empty,
        });

        actual.Should().Be(v.GetProperty("expectedPayload").GetString(),
            $"vector '{name}' — {v.GetProperty("note").GetString()}");
        actual.Length.Should().Be(v.GetProperty("expectedLength").GetInt32());
    }

    [Theory]
    [MemberData(nameof(ValidVectorNames))]
    public void Decode_TraVeDungDuLieuBanDau(string name)
    {
        var v = FindVector("vectors", name);
        var input = v.GetProperty("input");

        var decoded = VietQrPayloadBuilder.Decode(v.GetProperty("expectedPayload").GetString()!);

        decoded.CrcValid.Should().BeTrue("CRC phải hợp lệ");
        decoded.AcqId.Should().Be(input.GetProperty("acqId").GetString());
        decoded.AccountNo.Should().Be(input.GetProperty("accountNo").GetString());
        decoded.Amount.Should().Be(ReadAmount(input));
        decoded.AddInfo.Should().Be(v.GetProperty("expectedDecodedAddInfo").GetString());
        decoded.IsDynamic.Should().Be(ReadAmount(input).HasValue);
    }

    [Theory]
    [MemberData(nameof(InvalidInputNames))]
    public void Build_NemLoiVoiDuLieuKhongHopLe(string name)
    {
        var c = FindVector("invalidInputs", name);
        var input = c.GetProperty("input");

        Action act = () => VietQrPayloadBuilder.Build(new VietQrRequest
        {
            AcqId = input.GetProperty("acqId").GetString()!,
            AccountNo = input.GetProperty("accountNo").GetString()!,
            Amount = ReadAmount(input),
            AddInfo = input.GetProperty("addInfo").GetString() ?? string.Empty,
        });

        act.Should().Throw<VietQrException>($"trường hợp '{name}' phải bị chặn");
    }

    // -----------------------------------------------------------------
    // Ví dụ sai trong tài liệu gốc
    // -----------------------------------------------------------------

    [Fact]
    public void ViDuTrongTaiLieuGoc_ThucSuBiHong()
    {
        // Mã QR ví dụ trong resources/workflow/4. Tich hop VietQR.md khai sai
        // độ dài TLV (3857/0127 thay vì 3854/0124) và CRC là chuỗi giả "A1B2".
        // Test này ghim lại sự thật đó để không ai vô tình dùng nó làm chuẩn.
        var bad = Vectors.RootElement.GetProperty("knownBadExample");

        // Chuỗi hỏng tới mức KHÔNG PARSE NỔI, chứ không chỉ sai CRC: độ dài TLV
        // khai sai làm bộ đọc trượt khỏi ranh giới trường ngay từ đầu chuỗi.
        // Đây chính xác là điều app ngân hàng gặp khi quét mã đó.
        Action decodeBad = () => VietQrPayloadBuilder.Decode(bad.GetProperty("payload").GetString()!);
        decodeBad.Should().Throw<VietQrException>();

        // Còn đây mới là chuỗi đúng cho cùng bộ dữ liệu đầu vào.
        string correct = VietQrPayloadBuilder.Build(new VietQrRequest
        {
            AcqId = "970436",
            AccountNo = "0123456789",
            Amount = 150_000,
            AddInfo = "NINOPOS100234",
        });
        correct.Should().Be(bad.GetProperty("correctPayload").GetString());
        VietQrPayloadBuilder.Decode(correct).CrcValid.Should().BeTrue();
    }

    // -----------------------------------------------------------------
    // Giới hạn độ dài — lỗi đã thực sự xảy ra khi phát triển
    // -----------------------------------------------------------------

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(50)]
    [InlineData(94)]
    [InlineData(95)]
    [InlineData(96)]
    [InlineData(200)]
    [InlineData(500)]
    public void Build_TruongTag62KhongBaoGioVuot99KyTu(int addInfoLength)
    {
        // Từng có lỗi: cắt addInfo ở 99 ký tự rồi mới bọc TLV → tag 62 dài 103,
        // vượt giới hạn EMVCo và bị ngân hàng từ chối. Trần đúng phải là 95.
        string payload = VietQrPayloadBuilder.Build(new VietQrRequest
        {
            AcqId = "970436",
            AccountNo = "0123456789",
            Amount = 150_000,
            AddInfo = new string('A', addInfoLength),
        });

        var tags = VietQrPayloadBuilder.ParseTlv(payload);
        if (tags.TryGetValue("62", out string? additional))
        {
            additional.Length.Should().BeLessThanOrEqualTo(99);
        }
        VietQrPayloadBuilder.Decode(payload).CrcValid.Should().BeTrue();
    }

    // -----------------------------------------------------------------
    // Chuẩn hoá tiếng Việt
    // -----------------------------------------------------------------

    [Theory]
    [InlineData("Thanh toán hoá đơn", "THANH TOAN HOA DON")]
    [InlineData("Bàn 01 — ít đường", "BAN 01 IT DUONG")]
    [InlineData("Đặng Đình Đức", "DANG DINH DUC")]
    [InlineData("NINOPOS-100234/QN#01", "NINOPOS 100234 QN 01")]
    [InlineData("   nhiều    khoảng   trắng   ", "NHIEU KHOANG TRANG")]
    public void SanitizeAddInfo_BoDauVaLocKyTu(string input, string expected)
    {
        VietQrPayloadBuilder.SanitizeAddInfo(input).Should().Be(expected);
    }

    // -----------------------------------------------------------------
    // Đối soát nội dung chuyển khoản từ webhook
    // -----------------------------------------------------------------

    [Fact]
    public void ExtractOrderCode_KhopMoiCaTrongGoldenVectors()
    {
        var cases = Vectors.RootElement
            .GetProperty("webhookContentParsing").GetProperty("cases");

        foreach (var c in cases.EnumerateArray())
        {
            string content = c.GetProperty("content").GetString()!;
            var expectedElement = c.GetProperty("expected");
            string? expected = expectedElement.ValueKind == JsonValueKind.Null
                ? null
                : expectedElement.GetString();

            VietQrPayloadBuilder.ExtractOrderCode(content).Should().Be(expected,
                $"nội dung chuyển khoản: \"{content}\"");
        }
    }

    [Fact]
    public void ExtractOrderCode_DoDuocKhiNganHangChenThemChu()
    {
        // Ngân hàng KHÔNG trả lại đúng nội dung ta gửi — họ chèn thêm mã giao
        // dịch, số tài khoản, chữ "CT tu"... So sánh bằng == sẽ trượt hết.
        VietQrPayloadBuilder.ExtractOrderCode("MBVCB.9876543210.NINOPOS100234.CT tu 0123456789")
            .Should().Be("NINOPOS100234");

        VietQrPayloadBuilder.ExtractOrderCode("NINOPOS100234 CHUYEN KHOAN")
            .Should().Be("NINOPOS100234");

        VietQrPayloadBuilder.ExtractOrderCode("ninopos100234 thanh toan")
            .Should().Be("NINOPOS100234");

        VietQrPayloadBuilder.ExtractOrderCode("CK khong co ma don hang")
            .Should().BeNull();
    }

    // -----------------------------------------------------------------
    // Phát hiện giả mạo
    // -----------------------------------------------------------------

    [Fact]
    public void Decode_PhatHienChuoiBiSuaDoi()
    {
        string payload = VietQrPayloadBuilder.Build(new VietQrRequest
        {
            AcqId = "970436",
            AccountNo = "0123456789",
            Amount = 150_000,
            AddInfo = "NINOPOS100234",
        });

        // Đổi số tiền 150000 -> 100000 nhưng giữ nguyên CRC cũ
        string tampered = payload.Replace("5406150000", "5406100000");
        tampered.Should().NotBe(payload);

        VietQrPayloadBuilder.Decode(tampered).CrcValid.Should().BeFalse();
    }
}
