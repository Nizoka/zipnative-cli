# create/08-zip64-stream.ps1 — stream an entry with a Zip64 local header (--zip64)
#
# A streamed entry's size is unknown when its local header is written, so by
# default the streaming writer uses 4-byte sizes and refuses an entry that
# grows past 4 GiB (ZIP_UNSUPPORTED_ZIP64_STREAMING). `--zip64` (zipnative 1.1
# AddEntryOptions.zip64) writes every streamed entry with a Zip64 extra in the
# local header and the 24-byte data descriptor, so it may exceed 4 GiB. It
# requires a streamed input (`--stream` or `--stdin-name`): buffered entries
# are already Zip64 when they need it.
#
# PowerShell note: bytes only survive a pipe when BOTH sides are native
# commands (PowerShell 7.4+), so the file is streamed by a tiny `node -e`.
#
# Usage:
#   pwsh -File samples/create/08-zip64-stream.ps1
#
# Output: samples/output/create/08-zip64-stream.zip

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/create'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }
$CatJs = 'require("fs").createReadStream(process.argv[1]).pipe(process.stdout)'

$Pattern = Join-Path $InputDir 'binary/pattern.bin'
$Zip     = Join-Path $OutputDir '08-zip64-stream.zip'

Write-Host '→ Streaming samples/input/binary/pattern.bin as a Zip64 entry:'
& node -e $CatJs $Pattern | & $ZnExe @ZnPre create --stdin-name data/pattern.bin --stream --zip64 --output $Zip --overwrite --json

Write-Host ''
Write-Host '→ The entry carries a data descriptor and Zip64 (flags D and Z):'
zn list --input $Zip --long

Write-Host ''
Write-Host '→ inspect asserts it:'
zn inspect --input $Zip --summary --check zip64
