# crc32/01-crc32.ps1 — CRC-32 of files and stdin, --expect as a gate
#
# `crc32` computes the IEEE CRC-32 (the ZIP checksum) in 64 KiB chunks —
# constant memory for any size. Files are positionals or --input; with none,
# stdin is read. --expect <hex> turns a single input into an assertion (exit
# 1 / E_CHECK_FAILED on mismatch — the last call is EXPECTED to fail) and
# --seed continues a running checksum.
#
# Usage:
#   pwsh -File samples/crc32/01-crc32.ps1
#
# Output: samples/output/crc32/01-crc32.json

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/crc32'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }
$CatJs = 'require("fs").createReadStream(process.argv[1]).pipe(process.stdout)'

$Readme  = Join-Path $InputDir 'text/readme.txt'
$Pattern = Join-Path $InputDir 'binary/pattern.bin'

Write-Host '→ Files (text: <crc>  <bytes>  <file>):'
zn crc32 $Readme $Pattern

Write-Host ''
Write-Host '→ stdin (native-to-native pipe keeps the bytes raw):'
& node -e $CatJs $Readme | & $ZnExe @ZnPre crc32

Write-Host ''
Write-Host '→ JSON (saved to 01-crc32.json):'
zn crc32 $Readme --format json | Tee-Object -FilePath (Join-Path $OutputDir '01-crc32.json')

Write-Host ''
$Crc = ((zn crc32 $Readme) -split '\s+')[0]
Write-Host "→ --expect $Crc (matches → exit 0):"
zn crc32 $Readme --expect $Crc
Write-Host '  ✓ match'

# Expected failure — read $LASTEXITCODE instead of terminating.
$PSNativeCommandUseErrorActionPreference = $false
Write-Host ''
Write-Host '→ --expect deadbeef (mismatch → exit 1, E_CHECK_FAILED with both CRCs in detail):'
zn crc32 $Readme --expect deadbeef --json
Write-Host "  exit $LASTEXITCODE"
