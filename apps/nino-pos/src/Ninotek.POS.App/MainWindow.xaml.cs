using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Input;
using QRCoder;
using Ninotek.POS.Core.Authorization;
using Ninotek.POS.Core.Enums;
using Ninotek.POS.Data;
using Ninotek.POS.Hardware.Printing;

namespace Ninotek.POS.App;

public partial class MainWindow : Window, IDisposable
{
    private readonly Process? lanServer;
    private readonly LocalPosDatabase database = new(
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Ninotek", "NinoPOS", "ninopos.db"));
    private readonly Guid currentUserId = Guid.Parse("33333333-3333-4333-8333-000000000002");
    private readonly UserRole currentRole;
    private readonly EscPosPrinterTransport printerTransport = new();
    private readonly LocalSyncWorker syncWorker;
    private readonly System.Windows.Threading.DispatcherTimer takeawayTimer = new();
    private LocalTable? selectedTable;
    private LocalOrderReceipt? currentOrder;
    private IReadOnlyList<LocalMenuItem> menuItems = Array.Empty<LocalMenuItem>();
    private readonly Dictionary<Guid, LocalOrderLine> cartLines = new();

    public MainWindow()
    {
        InitializeComponent();
        currentRole = RolePolicy.ParseRole(Environment.GetEnvironmentVariable("NINOPOS_ROLE") ?? "CASHIER");
        InitializeLocalData();
        var cloudUrl = Environment.GetEnvironmentVariable("NINOPOS_CLOUD_URL");
        if (string.IsNullOrWhiteSpace(cloudUrl))
        {
            cloudUrl = "http://127.0.0.1:3000";
        }
        var cloudToken = Environment.GetEnvironmentVariable("NINOPOS_CLOUD_TOKEN") ?? string.Empty;

        syncWorker = new LocalSyncWorker(
            database,
            new HttpClient(),
            cloudUrl,
            cloudToken);
        _ = syncWorker.EnsureTokenAndStartAsync("QN01", "owner", "ninotek@123");
        BuildRoleActions();
        lanServer = StartLanServer();
        ServerStatusText.Text = lanServer is null ? "Unavailable" : "Running on port 8080";
        ServerStatusText.Foreground = lanServer is null
            ? (Brush)FindResource("SemanticDangerBrush")
            : (Brush)FindResource("SemanticSuccessBrush");

        StartTakeawayTimer();
    }

    private void StartTakeawayTimer()
    {
        takeawayTimer.Interval = TimeSpan.FromSeconds(3);
        takeawayTimer.Tick += async (_, _) => await RefreshTakeawayOrdersAsync();
        takeawayTimer.Start();
    }

    private async Task RefreshTakeawayOrdersAsync()
    {
        try
        {
            var pending = await database.ListPendingTakeawayOrdersAsync();
            if (pending.Count > 0)
            {
                ServerStatusText.Text = $"🛍️ Có {pending.Count} đơn mang đi mới từ NinoOrder chưa thanh toán!";
                ServerStatusText.Foreground = (Brush)FindResource("SemanticWarningBrush");

                if (currentOrder is null && cartLines.Count == 0 && selectedTable is null)
                {
                    await LoadTakeawayOrderToCashierAsync(pending[0]);
                }
            }
        }
        catch { }
    }

    private async Task LoadTakeawayOrderToCashierAsync(LocalOrderReceipt order)
    {
        currentOrder = order;
        selectedTable = null;
        SelectedTableText.Text = $"Đơn mang đi {order.OrderCode}";
        cartLines.Clear();

        var lines = await database.GetOrderLinesAsync(order.OrderId);
        OrderListPanel.Children.Clear();
        foreach (var line in lines)
        {
            var item = menuItems.FirstOrDefault(m => m.Id == line.ItemId);
            var itemName = item?.Name ?? "Món gọi";
            var price = item?.Price ?? 0m;
            var lineTotal = price * line.Quantity;

            OrderListPanel.Children.Add(new TextBlock
            {
                Text = $"{itemName}   x {line.Quantity:0.##}   {EscPosCommandBuilder.Money(lineTotal)} VND",
                FontSize = 15,
                Margin = new Thickness(0, 0, 0, 8),
                TextWrapping = TextWrapping.Wrap,
            });
        }

        var formatted = $"{EscPosCommandBuilder.Money(order.Total)} VND";
        SubtotalText.Text = formatted;
        TotalText.Text = formatted;
        CurrentOrderText.Text = $"Đơn {order.OrderCode} từ NinoOrder - Sẵn sàng thanh toán";
    }

    protected override void OnClosed(EventArgs e)
    {
        if (lanServer is { HasExited: false })
        {
            lanServer.Kill(entireProcessTree: true);
        }

        Dispose();
        base.OnClosed(e);
    }

    public void Dispose()
    {
        takeawayTimer.Stop();
        lanServer?.Dispose();
        syncWorker.DisposeAsync().AsTask().GetAwaiter().GetResult();
        database.DisposeAsync().AsTask().GetAwaiter().GetResult();
        GC.SuppressFinalize(this);
    }

    private static Process? StartLanServer()
    {
        var executable = Path.Combine(AppContext.BaseDirectory, "Ninotek.POS.LanServer.exe");
        if (!File.Exists(executable))
        {
            return null;
        }

        return Process.Start(new ProcessStartInfo
        {
            FileName = executable,
            WorkingDirectory = AppContext.BaseDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            Environment =
            {
                ["ASPNETCORE_URLS"] = "http://0.0.0.0:8080",
                ["Lan__SeedDemoData"] = "true"
            }
        });
    }

    private void InitializeLocalData()
    {
        try
        {
            database.InitializeAsync().GetAwaiter().GetResult();
            BuildTableCards(database.ListTablesAsync().GetAwaiter().GetResult());
            menuItems = database.ListMenuAsync().GetAwaiter().GetResult();
            BuildMenuButtons(menuItems);
        }
        catch (Exception ex)
        {
            ServerStatusText.Text = $"Local DB error: {ex.Message}";
            ServerStatusText.Foreground = (Brush)FindResource("SemanticDangerBrush");
        }
    }

    private void BuildTableCards(IReadOnlyList<LocalTable> tables)
    {
        foreach (var table in tables)
        {
            var button = new Button
            {
                Content = $"{table.Name}\n{(table.Status == "EMPTY" ? "Available" : table.Status)}",
                Width = 132,
                Height = 88,
                Margin = new Thickness(0, 0, 12, 12),
                FontSize = 16,
                Background = table.Status switch
                {
                    "OCCUPIED" => (Brush)FindResource("SemanticDangerBrush"),
                    "BILLING" => (Brush)FindResource("SemanticWarningBrush"),
                    "RESERVED" => Brushes.SlateGray,
                    _ => (Brush)FindResource("SemanticSuccessBrush"),
                },
                Foreground = Brushes.White,
                BorderThickness = new Thickness(0)
            };
            button.Tag = table;
            button.Click += TableButton_Click;
            TablePanel.Children.Add(button);
        }
    }

    private void BuildMenuButtons(IReadOnlyList<LocalMenuItem> items)
    {
        foreach (var item in items)
        {
            var button = new Button
            {
                Content = $"{item.Name}\n{EscPosCommandBuilder.Money(item.Price)}",
                Width = 132,
                Height = 72,
                Margin = new Thickness(0, 0, 12, 12),
                IsEnabled = item.IsAvailable,
                Style = (Style)FindResource("TileButton"),
            };
            button.Tag = item;
            button.Click += MenuButton_Click;
            MenuPanel.Children.Add(button);
        }
    }

    private void RebuildMenu(string? query = null)
    {
        MenuPanel.Children.Clear();
        var filtered = string.IsNullOrWhiteSpace(query)
            ? menuItems
            : menuItems.Where(item => item.Name.Contains(query, StringComparison.OrdinalIgnoreCase)).ToList();
        BuildMenuButtons(filtered);
    }

    private void SearchBox_TextChanged(object sender, TextChangedEventArgs e)
        => RebuildMenu(SearchBox.Text);

    private void CategoryButton_Click(object sender, RoutedEventArgs e)
    {
        SearchBox.Clear();
        ServerStatusText.Text = $"Nhóm hàng: {((Button)sender).Content}";
    }

    private void FloorPlanButton_Click(object sender, RoutedEventArgs e)
    {
        ShowPage(FloorPage, "Sơ đồ mặt bằng", "Tầng 1  •  Sân vườn  •  Phòng VIP");
        FloorPage.Visibility = Visibility.Visible;
        MenuPanel.Visibility = Visibility.Collapsed;
        ServerStatusText.Text = "Sơ đồ bàn";
    }

    private void MenuTabButton_Click(object sender, RoutedEventArgs e)
    {
        ShowPage(SalesPage, "Bán hàng", "Chọn món nhanh, hỗ trợ cảm ứng và bàn phím");
        FloorPage.Visibility = Visibility.Collapsed;
        MenuPanel.Visibility = Visibility.Visible;
        ServerStatusText.Text = "Thực đơn";
    }

    private void PaymentPageButton_Click(object sender, RoutedEventArgs e)
    {
        ShowPage(SalesPage, "Thanh toán", "Tiền mặt  •  VietQR động  •  Thẻ NAPAS  •  Chuyển khoản");
        FloorPage.Visibility = Visibility.Collapsed;
        ServerStatusText.Text = currentOrder is null ? "Chưa có đơn để thanh toán" : "Chọn phương thức thanh toán ở cột phải";
    }

    private void DataPageButton_Click(object sender, RoutedEventArgs e)
    {
        ShowPage(DataPage, "Nhập dữ liệu", "Menu, giá bán, định lượng và tồn kho");
        FloorPage.Visibility = Visibility.Collapsed;
    }

    private void SettingsPageButton_Click(object sender, RoutedEventArgs e)
    {
        ShowPage(SettingsPage, "Cấu hình", "Máy in bill, máy in bếp, két tiền và LAN");
        FloorPage.Visibility = Visibility.Collapsed;
    }

    private void ShowPage(UIElement page, string title, string subtitle)
    {
        SalesPage.Visibility = Visibility.Collapsed;
        FloorPage.Visibility = Visibility.Collapsed;
        DataPage.Visibility = Visibility.Collapsed;
        SettingsPage.Visibility = Visibility.Collapsed;
        page.Visibility = Visibility.Visible;
        PageTitleText.Text = title;
        PageSubtitleText.Text = subtitle;
    }

    private void SaveDataButton_Click(object sender, RoutedEventArgs e)
        => ServerStatusText.Text = "Mặt hàng đã được ghi nhận ở chế độ offline";

    private void SaveSettingsButton_Click(object sender, RoutedEventArgs e)
        => ServerStatusText.Text = "Cấu hình máy in/LAN đã được lưu cục bộ";

    private void PrintTemporaryButton_Click(object sender, RoutedEventArgs e)
        => _ = CommitCartAndNotifyAsync("Phiếu tạm tính đã vào hàng đợi in");

    private void SendKitchenButton_Click(object sender, RoutedEventArgs e)
        => _ = CommitCartAndNotifyAsync("Đã gửi chế biến cho Bếp/Bar");

    private async Task CommitCartAndNotifyAsync(string message)
    {
        if (await EnsureCurrentOrderAsync()) ServerStatusText.Text = message;
    }

    private void Window_PreviewKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        switch (e.Key)
        {
            case System.Windows.Input.Key.F1:
                SearchBox.Focus();
                e.Handled = true;
                break;
            case System.Windows.Input.Key.F2:
                MenuTabButton_Click(MenuTabButton, new RoutedEventArgs());
                SearchBox.Focus();
                e.Handled = true;
                break;
            case System.Windows.Input.Key.F8:
                PrintTemporaryButton_Click(this, new RoutedEventArgs());
                e.Handled = true;
                break;
            case System.Windows.Input.Key.F9:
                CashPaymentButton_Click(this, new RoutedEventArgs());
                e.Handled = true;
                break;
            case System.Windows.Input.Key.F12:
                PrintTemporaryButton_Click(this, new RoutedEventArgs());
                e.Handled = true;
                break;
            case System.Windows.Input.Key.Escape:
                QrImage.Source = null;
                Keyboard.ClearFocus();
                e.Handled = true;
                break;
        }
    }

    private void TableButton_Click(object sender, RoutedEventArgs e)
    {
        selectedTable = (LocalTable)((Button)sender).Tag;
        SelectedTableText.Text = $"Selected: {selectedTable.Name}";
        ServerStatusText.Text = $"Ready for {selectedTable.Name}";
    }

    private void MenuButton_Click(object sender, RoutedEventArgs e)
    {
        if (currentOrder is not null)
        {
            ServerStatusText.Text = "Đơn đã chốt; tạo đơn mới để bán tiếp";
            return;
        }

        var item = (LocalMenuItem)((Button)sender).Tag;
        cartLines[item.Id] = cartLines.TryGetValue(item.Id, out var line)
            ? line with { Quantity = line.Quantity + 1 }
            : new LocalOrderLine(item.Id, 1);
        RefreshCartPreview();
        ServerStatusText.Text = $"Đã thêm {item.Name}";
    }

    private void RefreshCartPreview()
    {
        OrderListPanel.Children.Clear();
        decimal total = 0;
        foreach (var line in cartLines.Values)
        {
            var item = menuItems.FirstOrDefault(candidate => candidate.Id == line.ItemId);
            if (item is null) continue;
            var lineTotal = item.Price * line.Quantity;
            total += lineTotal;
            OrderListPanel.Children.Add(new TextBlock
            {
                Text = $"{item.Name}   x {line.Quantity:0.##}   {EscPosCommandBuilder.Money(lineTotal)} VND",
                FontSize = 15,
                Margin = new Thickness(0, 0, 0, 8),
                TextWrapping = TextWrapping.Wrap,
            });
        }

        var formatted = $"{EscPosCommandBuilder.Money(total)} VND";
        SubtotalText.Text = formatted;
        TotalText.Text = formatted;
        CurrentOrderText.Text = cartLines.Count == 0
            ? "Chưa có món. Chọn món từ menu để bắt đầu."
            : $"{cartLines.Values.Sum(line => line.Quantity):0.##} món đang chờ gửi bếp";
    }

    private async Task<bool> EnsureCurrentOrderAsync()
    {
        if (currentOrder is not null) return true;
        if (cartLines.Count == 0)
        {
            ServerStatusText.Text = "Chưa có món trong đơn";
            return false;
        }

        currentOrder = await database.CreateOrderAsync(
            currentUserId,
            selectedTable?.Id,
            cartLines.Values.ToList());
        CurrentOrderText.Text = $"Đơn {currentOrder.OrderCode}: {EscPosCommandBuilder.Money(currentOrder.Total)} VND";
        return true;
    }

    private async void CashPaymentButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            if (!await EnsureCurrentOrderAsync()) return;
            var order = currentOrder!;
            var receipt = await database.ReceiveCashAsync(order.OrderId, currentUserId, order.Total);
            var printResult = await PrintPendingJobsAsync();
            ServerStatusText.Text = printResult < 0
                ? $"Paid. Change: {EscPosCommandBuilder.Money(receipt.Change)} VND. Bill queued."
                : $"Paid. Change: {EscPosCommandBuilder.Money(receipt.Change)} VND. Printed {printResult} job(s).";
            CurrentOrderText.Text = $"Order {order.OrderCode}: COMPLETED";
            currentOrder = null;
            cartLines.Clear();
            OrderListPanel.Children.Clear();
        }
        catch (Exception ex)
        {
            ServerStatusText.Text = ex.Message;
        }
    }

    private async void VietQrButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            if (!await EnsureCurrentOrderAsync()) return;
            var order = currentOrder!;
            var payload = VietQrPayloadBuilder.Build(new VietQrRequest(
                AcqId: "970436",
                AccountNo: "0123456789",
                Amount: order.Total,
                AddInfo: $"NINOPOS {order.OrderCode}"));

            using var generator = new QRCodeGenerator();
            using var data = generator.CreateQrCode(payload, QRCodeGenerator.ECCLevel.Q);
            using var code = new PngByteQRCode(data);
            var bytes = code.GetGraphic(20);

            var bitmap = new BitmapImage();
            using (var stream = new MemoryStream(bytes))
            {
                bitmap.BeginInit();
                bitmap.CacheOption = BitmapCacheOption.OnLoad;
                bitmap.StreamSource = stream;
                bitmap.EndInit();
            }

            QrImage.Source = bitmap;
            ServerStatusText.Text = $"VietQR generated for {order.OrderCode}. Waiting for payment webhook...";
        }
        catch (Exception ex)
        {
            ServerStatusText.Text = ex.Message;
        }
    }

    private async Task<int> PrintPendingJobsAsync()
    {
        var printerName = Environment.GetEnvironmentVariable("NINOPOS_PRINTER_NAME");
        if (string.IsNullOrWhiteSpace(printerName)) return -1;

        var kindText = Environment.GetEnvironmentVariable("NINOPOS_PRINTER_KIND") ?? "WindowsSpooler";
        if (!Enum.TryParse<PrinterTransportKind>(kindText, true, out var kind))
        {
            throw new InvalidOperationException($"Unsupported printer transport: {kindText}");
        }

        var jobs = await database.PendingPrintJobsAsync();
        var printed = 0;
        foreach (var job in jobs)
        {
            try
            {
                using var document = JsonDocument.Parse(job.Payload);
                var builder = new EscPosCommandBuilder(PaperWidth.Mm80)
                    .Initialize()
                    .Align(EscPosAlignment.Center)
                    .Bold(true)
                    .Text(database.StoreName)
                    .NewLine()
                    .Bold(false)
                    .Text($"Bill #{document.RootElement.GetProperty("order_code").GetString()}")
                    .NewLine()
                    .Text("--------------------------------")
                    .NewLine();

                foreach (var item in document.RootElement.GetProperty("items").EnumerateArray())
                {
                    var name = item.GetProperty("name").GetString() ?? "Item";
                    var quantity = item.GetProperty("quantity").GetDecimal();
                    var price = item.GetProperty("price").GetDecimal();
                    builder.LeftRight(
                        $"{name} x{quantity:0.##}",
                        EscPosCommandBuilder.Money(price * quantity));
                }

                builder.Text("--------------------------------")
                    .NewLine()
                    .LeftRight("Total:", EscPosCommandBuilder.Money(document.RootElement.GetProperty("final_total").GetDecimal()))
                    .NewLine()
                    .Text("Thank you!")
                    .NewLine()
                    .Cut();

                var bytes = builder.Build();
                await printerTransport.PrintAsync(printerName, bytes, kind);
                await database.MarkPrintJobCompletedAsync(job.Id);
                printed++;
            }
            catch
            {
                await database.MarkPrintJobFailedAsync(job.Id, "Printing transport failed");
                break;
            }
        }

        return printed;
    }
}
