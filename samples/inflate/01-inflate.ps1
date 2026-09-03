# inflate/01-inflate.ps1 — decompress a raw DEFLATE stream, bounded by --max-output
#
# `inflate` feeds zipnative's resumable inflater chunk by chunk (constant
# memory) and reports bytesIn / bytesOut / leftover. --max-output is a hard
# bound (default: the effective --max-entry-size, 1 GiB) — exceeding it is
# E_DATA / ZIP_INFLATE_OUTPUT_OVERFLOW, which is how a decompression bomb is
# stopped before it fills the disk. The bounded call is EXPECTED to fail.
# The raw stream is produced with node:zlib's deflateRawSync (RFC 1951).
#
# Usage:
#   pwsh -File samples/inflate/01-inflate.ps1
#
# Output: samples/output/inflate/readme.deflate, 01-readme.txt

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/inflate'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }
$CatJs = 'require("fs").createReadStream(process.argv[1]).pipe(process.stdout)'

$Src = Join-Path $InputDir 'text/readme.txt'
$Raw = Join-Path $OutputDir 'readme.deflate'
$Out = Join-Path $OutputDir '01-readme.txt'

Write-Host '→ Producing a raw DEFLATE stream with node:zlib:'
$DeflateJs = @'
const fs = require("node:fs"), zlib = require("node:zlib");
const [src, dst] = process.argv.slice(1);
fs.writeFileSync(dst, zlib.deflateRawSync(fs.readFileSync(src), { level: 9 }));
'@
& node -e $DeflateJs $Src $Raw
Write-Host ("  {0,6} readme.txt" -f (Get-Item $Src).Length)
Write-Host ("  {0,6} readme.deflate" -f (Get-Item $Raw).Length)

Write-Host ''
Write-Host '→ --dry-run reports the plan:'
zn inflate --input $Raw --dry-run --json

Write-Host ''
Write-Host '→ inflate to a file:'
zn inflate --input $Raw --output $Out --json
$A = (Get-FileHash -Algorithm SHA256 $Src).Hash
$B = (Get-FileHash -Algorithm SHA256 $Out).Hash
if ($A -eq $B) { Write-Host '  ✓ round trip identical' } else { Write-Error '  ✗ mismatch' }

Write-Host ''
Write-Host '→ inflate from stdin to stdout (first line):'
& node -e $CatJs $Raw | & $ZnExe @ZnPre inflate | Select-Object -First 1

# Expected failure — read $LASTEXITCODE instead of terminating.
$PSNativeCommandUseErrorActionPreference = $false
Write-Host ''
Write-Host '→ --max-output 16: the 200-byte result exceeds the bound → E_DATA:'
zn inflate --input $Raw --max-output 16 --json | Out-Null
Write-Host "  exit $LASTEXITCODE"
