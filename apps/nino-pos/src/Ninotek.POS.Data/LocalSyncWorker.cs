using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Ninotek.POS.Data;

public sealed class LocalSyncWorker : IAsyncDisposable
{
    private readonly LocalPosDatabase database;
    private readonly HttpClient httpClient;
    private readonly string cloudUrl;
    private string accessToken;
    private readonly CancellationTokenSource cancellation = new();
    private Task? loop;

    public LocalSyncWorker(LocalPosDatabase database, HttpClient httpClient, string cloudUrl, string accessToken)
    {
        this.database = database;
        this.httpClient = httpClient;
        this.cloudUrl = cloudUrl.TrimEnd('/');
        this.accessToken = accessToken;
    }

    public void Start()
    {
        if (loop is not null || string.IsNullOrWhiteSpace(cloudUrl) || string.IsNullOrWhiteSpace(accessToken)) return;
        loop = RunAsync(cancellation.Token);
    }

    public async Task EnsureTokenAndStartAsync(string storeCode = "QN01", string username = "owner", string password = "ninotek@123", CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(cloudUrl)) return;

        if (string.IsNullOrWhiteSpace(accessToken))
        {
            try
            {
                using var loginRequest = new HttpRequestMessage(HttpMethod.Post, $"{cloudUrl}/api/v1/cloud/auth/login")
                {
                    Content = JsonContent.Create(new { username, password, storeCode })
                };
                using var loginResponse = await httpClient.SendAsync(loginRequest, ct);
                if (loginResponse.IsSuccessStatusCode)
                {
                    using var doc = JsonDocument.Parse(await loginResponse.Content.ReadAsStringAsync(ct));
                    if (doc.RootElement.TryGetProperty("accessToken", out var tokenProp))
                    {
                        this.accessToken = tokenProp.GetString() ?? string.Empty;
                    }
                }
            }
            catch { }
        }

        Start();
    }

    private async Task RunAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(3));
        while (await timer.WaitForNextTickAsync(ct))
        {
            try { await SyncOnceAsync(ct); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
            catch { /* A failed tick leaves rows pending for the next tick. */ }
        }
    }

    public async Task SyncOnceAsync(CancellationToken ct = default)
    {
        var entries = await database.PendingSyncAsync(100, ct);
        if (entries.Count == 0) return;

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{cloudUrl}/api/v1/cloud/sync/transactions")
        {
            Content = JsonContent.Create(new
            {
                storeId = database.StoreId,
                items = entries.Select(entry => new
                {
                    queueId = entry.Id,
                    entityType = entry.EntityType,
                    entityId = entry.EntityId,
                    operation = entry.Operation,
                    payload = JsonSerializer.Deserialize<Dictionary<string, object?>>(entry.Payload) ?? new(),
                }),
            }),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var response = await httpClient.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            await database.MarkSyncFailedAsync(entries[0].Id, $"Cloud HTTP {(int)response.StatusCode}", ct);
            return;
        }

        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        foreach (var result in document.RootElement.GetProperty("results").EnumerateArray())
        {
            var queueId = result.GetProperty("queueId").GetInt64();
            var status = result.GetProperty("status").GetString();
            if (status is "SYNCED" or "CONFLICT")
            {
                await database.MarkSyncCompletedAsync(queueId, ct);
            }
            else
            {
                var message = result.TryGetProperty("message", out var detail) ? detail.GetString() : "Cloud rejected sync item";
                await database.MarkSyncFailedAsync(queueId, message, ct);
                break;
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        await cancellation.CancelAsync();
        if (loop is not null)
        {
            try { await loop; }
            catch (OperationCanceledException) { }
        }
        httpClient.Dispose();
        cancellation.Dispose();
    }
}
