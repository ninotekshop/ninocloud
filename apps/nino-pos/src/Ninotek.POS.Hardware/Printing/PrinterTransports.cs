using System.IO.Ports;
using System.Net.Sockets;
using System.Runtime.InteropServices;

namespace Ninotek.POS.Hardware.Printing;

public enum PrinterTransportKind
{
    Network,
    Serial,
    WindowsSpooler,
}

public sealed record PrinterConnectionSettings(
    PrinterTransportKind Kind,
    string Address,
    int Port = 9100,
    int BaudRate = 115200);

public interface IPrinterTransport
{
    Task SendAsync(PrinterConnectionSettings settings, ReadOnlyMemory<byte> payload, CancellationToken ct = default);
}

public sealed class EscPosPrinterTransport : IPrinterTransport
{
    public async Task SendAsync(PrinterConnectionSettings settings, ReadOnlyMemory<byte> payload, CancellationToken ct = default)
    {
        switch (settings.Kind)
        {
            case PrinterTransportKind.Network:
                await SendNetworkAsync(settings, payload, ct);
                break;
            case PrinterTransportKind.Serial:
                await SendSerialAsync(settings, payload, ct);
                break;
            case PrinterTransportKind.WindowsSpooler:
                SendWindowsSpooler(settings, payload.Span);
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(settings));
        }
    }

    private static async Task SendNetworkAsync(PrinterConnectionSettings settings, ReadOnlyMemory<byte> payload, CancellationToken ct)
    {
        using var client = new TcpClient();
        await client.ConnectAsync(settings.Address, settings.Port, ct);
        await using var stream = client.GetStream();
        await stream.WriteAsync(payload, ct);
        await stream.FlushAsync(ct);
    }

    private static Task SendSerialAsync(PrinterConnectionSettings settings, ReadOnlyMemory<byte> payload, CancellationToken ct)
    {
        return Task.Run(() =>
        {
            ct.ThrowIfCancellationRequested();
            using var port = new SerialPort(settings.Address, settings.BaudRate)
            {
                DtrEnable = true,
                RtsEnable = true,
                WriteTimeout = 5000,
            };
            port.Open();
            port.Write(payload.ToArray(), 0, payload.Length);
        }, ct);
    }

    private static void SendWindowsSpooler(PrinterConnectionSettings settings, ReadOnlySpan<byte> payload)
    {
        if (!OpenPrinter(settings.Address, out var printerHandle, IntPtr.Zero))
        {
            throw new IOException($"Cannot open Windows printer '{settings.Address}'.");
        }

        try
        {
            var document = new DOC_INFO_1
            {
                pDocName = "NinoPOS receipt",
                pOutputFile = null,
                pDataType = "RAW",
            };
            if (StartDocPrinter(printerHandle, 1, document) == 0 || !StartPagePrinter(printerHandle))
            {
                throw new IOException($"Cannot start print job on '{settings.Address}'.");
            }

            try
            {
                var buffer = payload.ToArray();
                if (!WritePrinter(printerHandle, buffer, buffer.Length, out var written) || written != buffer.Length)
                {
                    throw new IOException($"Printer '{settings.Address}' accepted only {written} bytes.");
                }
            }
            finally
            {
                EndPagePrinter(printerHandle);
                EndDocPrinter(printerHandle);
            }
        }
        finally
        {
            ClosePrinter(printerHandle);
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private sealed class DOC_INFO_1
    {
        public string? pDocName;
        public string? pOutputFile;
        public string? pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool OpenPrinter(string printerName, out IntPtr printerHandle, IntPtr defaults);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern int StartDocPrinter(IntPtr printerHandle, int level, [In] DOC_INFO_1 documentInfo);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr printerHandle, byte[] buffer, int bufferLength, out int bytesWritten);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr printerHandle);
}
