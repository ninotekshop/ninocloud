[CmdletBinding()]
param(
    [ValidateSet('win-x64', 'win-arm64')]
    [string]$Runtime = 'win-x64',
    [string]$Output = (Join-Path $PSScriptRoot '..\..\dist\nino-pos')
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$posRoot = Join-Path $repoRoot 'apps\nino-pos'
$appProject = Join-Path $posRoot 'src\Ninotek.POS.App\Ninotek.POS.App.csproj'
$lanProject = Join-Path $posRoot 'src\Ninotek.POS.LanServer\Ninotek.POS.LanServer.csproj'

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw 'The .NET 8 SDK is required. Install it from https://dotnet.microsoft.com/download/dotnet/8.0.'
}

if (Test-Path $Output) {
    Remove-Item $Output -Recurse -Force
}
New-Item $Output -ItemType Directory -Force | Out-Null

dotnet publish $lanProject -c Release -r $Runtime --self-contained true -o $Output
dotnet publish $appProject -c Release -r $Runtime --self-contained true -o $Output

@'
NinoPOS Windows deployment

Run NinoPOS.exe. The POS shell starts the LAN server on port 8080.
Allow inbound TCP 8080 in Windows Firewall when tablets connect from the LAN.
'@ | Set-Content (Join-Path $Output 'README.txt') -Encoding ASCII

Write-Host "Published NinoPOS to $Output"