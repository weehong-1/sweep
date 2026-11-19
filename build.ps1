# Assembles dist\chromium and dist\firefox from src\ plus the matching manifest.
# Chromium (Brave, Chrome, Edge): load dist\chromium via "Load unpacked".
# Firefox: load dist\firefox\manifest.json via about:debugging, or sign it with sign-firefox.ps1.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src = Join-Path $root 'src'

foreach ($target in 'chromium', 'firefox') {
    $out = Join-Path $root "dist\$target"
    if (Test-Path $out) { Remove-Item -Recurse -Force $out }
    New-Item -ItemType Directory -Force $out | Out-Null
    Copy-Item -Path (Join-Path $src '*') -Destination $out -Recurse
    Copy-Item -Path (Join-Path $root "manifest.$target.json") -Destination (Join-Path $out 'manifest.json')

    # Stamp the build with a fingerprint of everything in it. Pages compare it
    # with the background script's and reload the extension when they differ,
    # so a rebuilt unpacked extension never runs half old, half new.
    $hashes = Get-ChildItem $out -Recurse -File | Sort-Object FullName | ForEach-Object { (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $digest = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($hashes -join ''))
    $stamp = (-join ($digest | ForEach-Object { $_.ToString('x2') })).Substring(0, 12)
    $clean = Join-Path $out 'clean.js'
    $text = [System.IO.File]::ReadAllText($clean)
    if (-not $text.Contains("'__BUILD__'")) { throw "clean.js has no build placeholder" }
    [System.IO.File]::WriteAllText($clean, $text.Replace("'__BUILD__'", "'$stamp'"))

    "Built $out"
}
