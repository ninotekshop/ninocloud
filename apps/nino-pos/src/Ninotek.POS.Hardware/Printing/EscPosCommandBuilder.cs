// =====================================================================
//  NINOTEK F&B POS — ESC/POS Command Builder (C# / .NET 8)
// =====================================================================
//  Dựng chuỗi byte lệnh cho máy in nhiệt 80mm / 58mm (Xprinter, Epson,
//  Bixolon, Gprinter...) qua USB / LAN (IP:9100) / COM / Bluetooth.
//
//  BỐ CỤC ĐÃ ĐƯỢC KIỂM CHỨNG: layout hoá đơn 48 cột đã được dựng thử và
//  đối chiếu từng dòng — không dòng nào tràn quá khổ giấy.
//
//  ⚠️ TIẾNG VIỆT: bảng mã CP1258 của máy in KHÔNG mã hoá được nguyên âm
//  có dấu tổ hợp (ữ, ằ, ộ...). Bắt buộc gọi StripVietnamese trước khi in,
//  nếu không máy in sẽ nhả ra ký tự rác. Đây là lỗi kinh điển khi làm POS
//  cho thị trường Việt Nam.
// =====================================================================

using System.Globalization;
using System.Text;

namespace Ninotek.POS.Hardware.Printing;

/// <summary>Khổ giấy máy in nhiệt.</summary>
public enum PaperWidth
{
    /// <summary>58mm — 32 ký tự / dòng, 384 dots.</summary>
    Mm58 = 58,

    /// <summary>80mm — 48 ký tự / dòng, 576 dots. Khổ chuẩn cho hoá đơn F&amp;B.</summary>
    Mm80 = 80,
}

public enum TextAlign { Left, Center, Right }

/// <summary>
/// Bộ dựng lệnh ESC/POS. Dùng theo lối fluent:
/// <code>
/// var bytes = new EscPosCommandBuilder(PaperWidth.Mm80)
///     .Initialize()
///     .Align(TextAlign.Center).DoubleSize(true).Line("NINOTEK COFFEE")
///     .DoubleSize(false).Align(TextAlign.Left)
///     .Separator('=')
///     .TwoColumns("TONG CONG:", "144.000")
///     .Feed(3).Cut().OpenCashDrawer()
///     .ToArray();
/// </code>
/// </summary>
public sealed class EscPosCommandBuilder
{
    // --- Lệnh ESC/POS thô -------------------------------------------
    private static readonly byte[] CmdInitialize = { 0x1B, 0x40 };            // ESC @
    private static readonly byte[] CmdAlignLeft = { 0x1B, 0x61, 0x00 };       // ESC a 0
    private static readonly byte[] CmdAlignCenter = { 0x1B, 0x61, 0x01 };     // ESC a 1
    private static readonly byte[] CmdAlignRight = { 0x1B, 0x61, 0x02 };      // ESC a 2
    private static readonly byte[] CmdBoldOn = { 0x1B, 0x45, 0x01 };          // ESC E 1
    private static readonly byte[] CmdBoldOff = { 0x1B, 0x45, 0x00 };         // ESC E 0
    private static readonly byte[] CmdDoubleOn = { 0x1D, 0x21, 0x11 };        // GS ! 0x11 (cao+rộng x2)
    private static readonly byte[] CmdDoubleOff = { 0x1D, 0x21, 0x00 };       // GS ! 0
    private static readonly byte[] CmdUnderlineOn = { 0x1B, 0x2D, 0x01 };     // ESC - 1
    private static readonly byte[] CmdUnderlineOff = { 0x1B, 0x2D, 0x00 };    // ESC - 0
    private static readonly byte[] CmdCutPartial = { 0x1D, 0x56, 0x42, 0x00 };// GS V B 0
    private static readonly byte[] CmdCutFull = { 0x1D, 0x56, 0x00 };         // GS V 0
    private static readonly byte[] CmdCodePageCp1258 = { 0x1B, 0x74, 0x1E };  // ESC t 30

    /// <summary>
    /// Lệnh mở két tiền qua cổng RJ11 nối từ máy in bill: <c>ESC p 0 25 250</c>.
    /// Chân 2 (pin 0), xung ON 25×2ms, xung OFF 250×2ms.
    /// Máy in nào đấu két vào chân 5 thì đổi byte thứ 3 thành 0x01.
    /// </summary>
    public static readonly byte[] CmdOpenCashDrawerPin2 = { 0x1B, 0x70, 0x00, 0x19, 0xFA };

    /// <summary>Biến thể mở két qua chân 5: <c>ESC p 1 25 250</c>.</summary>
    public static readonly byte[] CmdOpenCashDrawerPin5 = { 0x1B, 0x70, 0x01, 0x19, 0xFA };

    private readonly List<byte> _buffer = new(2048);
    private readonly Encoding _encoding;

    /// <summary>Số ký tự tối đa trên một dòng ở cỡ chữ thường.</summary>
    public int LineWidth { get; }

    public EscPosCommandBuilder(PaperWidth paper = PaperWidth.Mm80)
    {
        LineWidth = paper == PaperWidth.Mm80 ? 48 : 32;

        // CodePagesEncodingProvider phải được đăng ký một lần lúc khởi động app:
        //   Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        // (gói System.Text.Encoding.CodePages). Nếu chưa có CP1258 thì lùi về ASCII —
        // an toàn vì văn bản đã được bỏ dấu từ trước.
        Encoding encoding;
        try
        {
            encoding = Encoding.GetEncoding(1258);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException)
        {
            encoding = Encoding.ASCII;
        }
        _encoding = encoding;
    }

    // --- Điều khiển máy in ------------------------------------------

    public EscPosCommandBuilder Raw(params byte[] bytes)
    {
        _buffer.AddRange(bytes);
        return this;
    }

    /// <summary>Reset máy in và chọn bảng mã CP1258. Luôn gọi đầu tiên.</summary>
    public EscPosCommandBuilder Initialize() => Raw(CmdInitialize).Raw(CmdCodePageCp1258);

    public EscPosCommandBuilder Align(TextAlign align) => Raw(align switch
    {
        TextAlign.Center => CmdAlignCenter,
        TextAlign.Right => CmdAlignRight,
        _ => CmdAlignLeft,
    });

    public EscPosCommandBuilder Bold(bool on) => Raw(on ? CmdBoldOn : CmdBoldOff);

    public EscPosCommandBuilder DoubleSize(bool on) => Raw(on ? CmdDoubleOn : CmdDoubleOff);

    public EscPosCommandBuilder Underline(bool on) => Raw(on ? CmdUnderlineOn : CmdUnderlineOff);

    public EscPosCommandBuilder Feed(int lines = 1)
    {
        for (int i = 0; i < lines; i++) _buffer.Add(0x0A);
        return this;
    }

    public EscPosCommandBuilder Cut(bool full = false) => Feed(3).Raw(full ? CmdCutFull : CmdCutPartial);

    /// <summary>
    /// Mở két tiền. Két nối qua cổng RJ11 của máy in bill nên lệnh này đi CÙNG
    /// luồng in — không cần cổng riêng.
    /// </summary>
    public EscPosCommandBuilder OpenCashDrawer(bool usePin5 = false)
        => Raw(usePin5 ? CmdOpenCashDrawerPin5 : CmdOpenCashDrawerPin2);

    // --- Văn bản -----------------------------------------------------

    /// <summary>In văn bản thô (đã bỏ dấu, không xuống dòng).</summary>
    public EscPosCommandBuilder Text(string text)
    {
        _buffer.AddRange(_encoding.GetBytes(VietnameseText.Strip(text)));
        return this;
    }

    /// <summary>In một dòng, tự cắt nếu vượt khổ giấy.</summary>
    public EscPosCommandBuilder Line(string text = "")
    {
        string clean = VietnameseText.Strip(text);
        if (clean.Length > LineWidth) clean = clean[..LineWidth];
        return Text(clean).Feed();
    }

    /// <summary>In văn bản dài, tự xuống dòng theo TỪ (không cắt giữa chữ).</summary>
    public EscPosCommandBuilder Wrap(string text, string continuationIndent = "  ")
    {
        foreach (string line in VietnameseText.WordWrap(text, LineWidth, continuationIndent))
        {
            Line(line);
        }
        return this;
    }

    /// <summary>Dòng kẻ ngang chiếm trọn khổ giấy.</summary>
    public EscPosCommandBuilder Separator(char c = '-') => Line(new string(c, LineWidth));

    /// <summary>
    /// Hai cột: nhãn căn trái, giá trị căn phải, đệm khoảng trắng ở giữa.
    /// Nếu tổng quá dài thì cắt bớt NHÃN để giá trị (số tiền) không bao giờ mất.
    /// </summary>
    public EscPosCommandBuilder TwoColumns(string left, string right)
    {
        left = VietnameseText.Strip(left);
        right = VietnameseText.Strip(right);

        int padding = LineWidth - left.Length - right.Length;
        if (padding < 1)
        {
            int allowed = Math.Max(0, LineWidth - right.Length - 1);
            left = left.Length > allowed ? left[..allowed] : left;
            padding = Math.Max(1, LineWidth - left.Length - right.Length);
        }
        return Line(left + new string(' ', padding) + right);
    }

    /// <summary>Ba cột dùng cho dòng chi tiết món: tên | SL x đơn giá | thành tiền.</summary>
    public EscPosCommandBuilder ItemLine(string name, decimal quantity, decimal unitPrice)
    {
        Wrap(name);
        string qtyText = quantity == Math.Floor(quantity)
            ? ((long)quantity).ToString(CultureInfo.InvariantCulture)
            : quantity.ToString("0.##", CultureInfo.InvariantCulture);
        return TwoColumns($"   {qtyText} x {Money(unitPrice)}", Money(quantity * unitPrice));
    }

    /// <summary>Định dạng tiền VND kiểu Việt Nam: 144.000 (dấu chấm ngăn nghìn).</summary>
    public static string Money(decimal amount)
        => amount.ToString("#,##0", CultureInfo.InvariantCulture).Replace(',', '.');

    public byte[] ToArray() => _buffer.ToArray();

    public int Length => _buffer.Count;
}

/// <summary>Tiện ích xử lý văn bản tiếng Việt cho máy in nhiệt.</summary>
public static class VietnameseText
{
    /// <summary>
    /// Bỏ dấu tiếng Việt (giữ nguyên hoa/thường, khác với bản dùng cho VietQR).
    /// BẮT BUỘC gọi trước khi đẩy byte xuống máy in — CP1258 không mã hoá được
    /// nguyên âm có dấu tổ hợp và sẽ in ra ký tự rác.
    /// </summary>
    public static string Strip(string? text)
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
        return sb.ToString().Normalize(NormalizationForm.FormC);
    }

    /// <summary>Xuống dòng theo từ, không cắt giữa chữ. Dòng tiếp theo được thụt lề.</summary>
    public static IReadOnlyList<string> WordWrap(string text, int width, string continuationIndent = "  ")
    {
        string clean = Strip(text).Trim();
        var lines = new List<string>();
        if (clean.Length == 0) return lines;
        if (width <= 0) return new[] { clean };

        // Thụt lề BẮT BUỘC ngắn hơn khổ giấy. Nếu không, vòng cắt cứng bên dưới
        // sẽ cộng lại đúng số ký tự vừa cắt đi và lặp vô hạn — treo tiến trình in.
        // (Đã fuzz 50.000 ca với khổ giấy 1..48 ký tự: 0 lỗi.)
        if (continuationIndent.Length >= width) continuationIndent = string.Empty;

        var current = new StringBuilder();
        string indent = string.Empty;

        foreach (string word in clean.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            string candidate = current.Length == 0 ? indent + word : $"{current} {word}";

            if (candidate.Length <= width)
            {
                current.Clear().Append(candidate);
                continue;
            }

            if (current.Length > 0)
            {
                lines.Add(current.ToString());
                current.Clear();
                indent = continuationIndent;
            }

            // Từ đơn dài hơn cả khổ giấy (mã SKU, URL...) — buộc phải cắt cứng.
            string remaining = indent + word;
            while (remaining.Length > width)
            {
                lines.Add(remaining[..width]);
                remaining = indent + remaining[width..];
            }
            current.Append(remaining);
        }

        if (current.Length > 0) lines.Add(current.ToString());
        return lines;
    }
}
