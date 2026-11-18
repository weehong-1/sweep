# Gets the Firefox build signed by Mozilla so it can be installed permanently.
#
# The add-on is submitted as "unlisted": it is not published or searchable, and
# only you receive the signed file. The code in dist\firefox is uploaded to
# Mozilla for automated checks.
#
# You need a Mozilla account and API credentials from
#   https://addons.mozilla.org/developers/addon/api/key/
# The script asks for them (the secret is not shown or stored), or reads
# WEB_EXT_API_KEY and WEB_EXT_API_SECRET if you have set those yourself.
#
# It uses Mozilla's own command-line tool, web-ext, which npx downloads from npm
# the first time (npx asks before installing it).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'npx was not found. Install Node.js first.' }
& (Join-Path $root 'build.ps1')

$manifest = Get-Content -Raw (Join-Path $root 'dist\firefox\manifest.json') | ConvertFrom-Json
Write-Host "Signing Sweep $($manifest.version) ($($manifest.browser_specific_settings.gecko.id)) as an unlisted add-on."
Write-Host 'Mozilla refuses a version number it has already signed; raise "version" in both manifest files to sign again.'

$setKey = $false
$setSecret = $false
if (-not $env:WEB_EXT_API_KEY) {
    $env:WEB_EXT_API_KEY = (Read-Host 'JWT issuer (looks like user:12345678:123)').Trim()
    $setKey = $true
}
if (-not $env:WEB_EXT_API_SECRET) {
    $secure = Read-Host 'JWT secret' -AsSecureString
    # Copying from the web page often picks up a space or line break, which makes
    # Mozilla reject the signature, so strip all whitespace.
    $secret = [System.Net.NetworkCredential]::new('', $secure).Password -replace '\s', ''
    if ($secret.Length -ne 64 -or $secret -notmatch '^[0-9A-Za-z]+$') {
        Write-Warning "The secret is $($secret.Length) characters after removing spaces. Mozilla's secrets are 64 letters and digits; check that you copied the whole JWT secret and nothing else."
    }
    $env:WEB_EXT_API_SECRET = $secret
    $secret = $null
    $setSecret = $true
}
$env:WEB_EXT_API_KEY = $env:WEB_EXT_API_KEY -replace '\s', ''

$out = Join-Path $root 'signed'
try {
    npx web-ext sign --source-dir (Join-Path $root 'dist\firefox') --artifacts-dir $out --channel unlisted
    $code = $LASTEXITCODE
} finally {
    # Do not leave credentials this script asked for in the session.
    if ($setKey) { Remove-Item Env:WEB_EXT_API_KEY -ErrorAction SilentlyContinue }
    if ($setSecret) { Remove-Item Env:WEB_EXT_API_SECRET -ErrorAction SilentlyContinue }
}

if ($code -ne 0) { throw "Signing failed (web-ext exit code $code)." }
$xpi = Get-ChildItem $out -Filter '*.xpi' | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $xpi) { throw "Signing reported success but no .xpi was found in $out." }
Write-Host "Signed add-on: $($xpi.FullName)"
