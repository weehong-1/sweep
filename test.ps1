# Builds both targets, then runs the end-to-end tests.
#   .\test.ps1            every installed browser (Brave, Chrome, Edge, Firefox)
#   .\test.ps1 chrome     one browser: brave, chrome, edge or firefox
#   .\test.ps1 chromium   every installed Chromium browser
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build.ps1')

# Unit tests first: they are instant and need no browser.
node --test (Join-Path $PSScriptRoot 'tests\unit')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

node (Join-Path $PSScriptRoot 'tests\e2e\run.js') @args
exit $LASTEXITCODE
