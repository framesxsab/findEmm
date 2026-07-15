$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$release = Join-Path $root 'release'
$package = Join-Path $release 'findemm-0.1.0.zip'
New-Item -ItemType Directory -Force -Path $release | Out-Null
Remove-Item -LiteralPath $package -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $root 'dist\extension\*') -DestinationPath $package -CompressionLevel Optimal
Write-Output "Chrome Web Store package: $package"
