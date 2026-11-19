# Builds the Chromium extension and packs it as the .zip the Chrome Web Store
# takes: store\sweep-chromium-<version>.zip, with manifest.json at the top level.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
& (Join-Path $root 'build.ps1')

$dist = Join-Path $root 'dist\chromium'
$version = (Get-Content -Raw (Join-Path $dist 'manifest.json') | ConvertFrom-Json).version
$store = Join-Path $root 'store'
New-Item -ItemType Directory -Force $store | Out-Null
$zip = Join-Path $store "sweep-chromium-$version.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $dist '*') -DestinationPath $zip
"Packed $zip ($([math]::Round((Get-Item $zip).Length / 1KB, 1)) KB)"
