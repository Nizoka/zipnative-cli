# create/05-stdin-stream.ps1 — pipe stdin into an entry with --stdin-name --stream
#
# `--stdin-name <name>` turns whatever arrives on stdin into one entry.
# `--stream` selects the constant-memory writer: the entry is compressed as it
# arrives and written with a data descriptor (sizes and CRC after the payload),
# so nothing is buffered. The resulting layout is valid for every reader but
# is NOT byte-identical to the buffered writer — `inspect` reports it as
# `deterministic: true` (reproducible run-to-run) but `canonicalLayout: false`.
#
# PowerShell note: bytes only survive a pipe when BOTH sides are native
# commands (PowerShell 7.4+), so the file is streamed by a tiny `node -e`
# instead of Get-Content, straight into the CLI executable.
#
# Usage:
#   pwsh -File samples/create/05-stdin-stream.ps1
#
# Output: samples/output/create/05-stdin-stream.zip

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
$Zip     = Join-Path $OutputDir '05-stdin-stream.zip'

Write-Host '→ Piping samples/input/binary/pattern.bin into an entry named data/pattern.bin:'
& node -e $CatJs $Pattern | & $ZnExe @ZnPre create --stdin-name data/pattern.bin --stream --chunk-size 1k --output $Zip --json

Write-Host ''
Write-Host '→ The entry carries a data descriptor (flag D):'
zn list --input $Zip --long

Write-Host ''
Write-Host '→ Round trip — the CRC of the extracted bytes matches the original:'
& $ZnExe @ZnPre cat --input $Zip --entry data/pattern.bin | & $ZnExe @ZnPre crc32
zn crc32 $Pattern
