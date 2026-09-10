using FluentAssertions;
using Microsoft.Data.Sqlite;
using Ninotek.POS.Data;
using Xunit;

namespace Ninotek.POS.Core.Tests;

public sealed class LocalPosDatabaseTests
{
    [Fact]
    public async Task OfflineSale_PersistsOrderPaymentQrAndQueues()
    {
        var databasePath = Path.Combine(Path.GetTempPath(), $"ninopos-{Guid.NewGuid():N}.db");
        var database = new LocalPosDatabase(databasePath);
        try
        {
            await database.InitializeAsync();

            var tables = await database.ListTablesAsync();
            var menu = await database.ListMenuAsync();
            tables.Should().HaveCount(8);
            menu.Should().HaveCount(12);

            var cashierId = Guid.Parse("33333333-3333-4333-8333-000000000002");
            var order = await database.CreateOrderAsync(
                cashierId,
                tables[0].Id,
                [new LocalOrderLine(menu[0].Id, 1)]);

            order.Total.Should().Be(18000m);
            var qr = await database.CreateVietQrAsync(order.OrderId);
            qr.Should().Contain(order.OrderCode);

            var receipt = await database.ReceiveCashAsync(order.OrderId, cashierId, order.Total);
            receipt.Change.Should().Be(0m);

            var jobs = await database.PendingPrintJobsAsync();
            jobs.Should().HaveCount(2);
            jobs.Select(job => job.JobType).Should().Contain(["KITCHEN_TICKET", "BILL"]);
        }
        finally
        {
            await database.DisposeAsync();
            SqliteConnection.ClearAllPools();
            File.Delete(databasePath);
            File.Delete(databasePath + "-wal");
            File.Delete(databasePath + "-shm");
        }
    }
}