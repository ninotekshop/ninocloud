// Dữ liệu demo cho chế độ chạy thử. Trùng khớp với database/seed/V900.
using Ninotek.POS.Core.Entities;
using Ninotek.POS.Core.Enums;

using Ninotek.POS.LanServer;

namespace Ninotek.POS.LanServer.Testing;

public static class DemoSeed
{
    public static readonly Guid AreaTang1 = Guid.Parse("44444444-4444-4444-8444-000000000001");
    public static readonly Guid CatCaPhe  = Guid.Parse("55555555-5555-4555-8555-000000000001");
    public static readonly Guid ItemSuaDa = Guid.Parse("77777777-7777-4777-8777-000000000002");
    public static readonly Guid ItemDenDa = Guid.Parse("77777777-7777-4777-8777-000000000001");
    public static readonly Guid ItemHetHang = Guid.Parse("77777777-7777-4777-8777-0000000000ff");
    public static readonly Guid TopTranChau = Guid.Parse("88888888-8888-4888-8888-000000000001");

    public static void Populate(InMemoryStore s, LanServerOptions opt)
    {
        var now = DateTime.UtcNow;
        var store = opt.StoreId;

        s.Areas[AreaTang1] = new Area { Id = AreaTang1, StoreId = store, Name = "Tang 1", SortOrder = 1 };

        for (int i = 1; i <= 8; i++)
        {
            var id = Guid.Parse($"aaaaaaaa-0000-4000-8000-{i:D12}");
            s.Tables[id] = new Table
            {
                Id = id, StoreId = store, AreaId = AreaTang1,
                Name = $"Ban {i:D2}", SeatCapacity = 4, SortOrder = i,
                PosX = ((i - 1) % 4) * 120, PosY = ((i - 1) / 4) * 120,
                CreatedAt = now, UpdatedAt = now,
            };
        }

        s.Categories[CatCaPhe] = new Category
        { Id = CatCaPhe, StoreId = store, Name = "Ca phe", ColorCode = "#6F4E37",
          SortOrder = 1, CreatedAt = now, UpdatedAt = now };

        s.Items[ItemDenDa] = new Item
        { Id = ItemDenDa, StoreId = store, CategoryId = CatCaPhe, Sku = "CF001",
          Name = "Ca phe den da", BasePrice = 18000m, Unit = "Ly", PrintStation = "BAR",
          SortOrder = 1, CreatedAt = now, UpdatedAt = now };

        s.Items[ItemSuaDa] = new Item
        { Id = ItemSuaDa, StoreId = store, CategoryId = CatCaPhe, Sku = "CF002",
          Name = "Ca phe sua da", BasePrice = 22000m, Unit = "Ly", PrintStation = "BAR",
          SortOrder = 2, CreatedAt = now, UpdatedAt = now };

        // Món tạm hết trong ngày — để kiểm thử luồng từ chối
        s.Items[ItemHetHang] = new Item
        { Id = ItemHetHang, StoreId = store, CategoryId = CatCaPhe, Sku = "CF999",
          Name = "Ca phe trung", BasePrice = 30000m, Unit = "Ly", PrintStation = "BAR",
          IsAvailable = false, SortOrder = 3, CreatedAt = now, UpdatedAt = now };

        s.Toppings[TopTranChau] = new Topping
        { Id = TopTranChau, StoreId = store, Name = "Tran chau den", ExtraPrice = 7000m,
          GroupName = "TOPPING", SortOrder = 1, CreatedAt = now, UpdatedAt = now };
    }
}
