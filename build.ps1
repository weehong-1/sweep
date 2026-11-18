# Assembles dist\chromium and dist\firefox from src\ plus the matching manifest.
# Chromium (Brave, Chrome, Edge): load dist\chromium via "Load unpacked".
# Firefox: load dist\firefox\manifest.json via about:debugging, or sign it with web-ext.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src = Join-Path $root 'src'

foreach ($target in 'chromium', 'firefox') {
    $out = Join-Path $root "dist\$target"
    if (Test-Path $out) { Remove-Item -Recurse -Force $out }
    New-Item -ItemType Directory -Force $out | Out-Null
    Copy-Item -Path (Join-Path $src '*') -Destination $out -Recurse
    Copy-Item -Path (Join-Path $root "manifest.$target.json") -Destination (Join-Path $out 'manifest.json')
    "Built $out"
}
