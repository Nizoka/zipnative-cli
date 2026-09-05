# create/02-store-vs-deflate.ps1 — --method store vs deflate, --level, --store-ext
#
# `store` keeps every payload verbatim (fast, zero compression — and what the
# tamper demo in verify/02 relies on); `deflate` is the default at level 6.
# --store-ext keeps already-compressed extensions uncompressed inside an
# otherwise deflated archive. The sizes are compared at the end.
#
# Usage:
#   pwsh -File samples/create/02-store-vs-deflate.ps1
#
# Output: samples/output/create/02-store.zip, 02-deflate-9.zip, 02-store-ext.zip

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/create'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Text   = Join-Path $InputDir 'text'
$Binary = Join-Path $InputDir 'binary'

Write-Host '→ --method store (no compression):'
zn create $Text $Binary --method store --output (Join-Path $OutputDir '02-store.zip') --json

Write-Host ''
Write-Host '→ --method deflate --level 9 (maximum compression):'
zn create $Text $Binary --method deflate --level 9 --output (Join-Path $OutputDir '02-deflate-9.zip') --json

Write-Host ''
Write-Host '→ deflate everything except *.bin (--store-ext bin):'
zn create $Text $Binary --store-ext bin --output (Join-Path $OutputDir '02-store-ext.zip') --json

Write-Host ''
Write-Host '→ Per-entry methods in the mixed archive:'
zn list --input (Join-Path $OutputDir '02-store-ext.zip')

Write-Host ''
Write-Host '→ Archive sizes:'
foreach ($name in '02-store.zip', '02-deflate-9.zip', '02-store-ext.zip') {
    $len = (Get-Item (Join-Path $OutputDir $name)).Length
    Write-Host ("  {0,6} {1}" -f $len, $name)
}
