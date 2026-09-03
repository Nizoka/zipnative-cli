# stream/01-forward-list.ps1 — list an archive arriving on a pipe
#
# `stream` is the forward-only reader for UNSEEKABLE input (a pipe, a
# network body): it parses local headers as they arrive and never needs the
# central directory. Trust caveat: without the central directory nothing
# cross-checks names, sizes or methods, so every JSON output carries
# trust: "local-headers-only" and a warning is printed. Entries written with
# a data descriptor show 0 sizes/CRC in the rows (the values only follow the
# payload). Prefer `list`/`inspect` whenever the whole file is on disk.
#
# PowerShell note: the archive is streamed by a tiny `node -e` straight into
# the CLI executable — bytes only survive a pipe between two native commands
# (PowerShell 7.4+).
#
# Usage:
#   pwsh -File samples/stream/01-forward-list.ps1
#
# Output: samples/output/stream/archive.zip, 01-forward-list.ndjson

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/stream'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }
$CatJs = 'require("fs").createReadStream(process.argv[1]).pipe(process.stdout)'

$Zip = Join-Path $OutputDir 'archive.zip'
if (-not (Test-Path $Zip)) {
    zn create (Join-Path $InputDir 'text') --output $Zip --quiet
}

Write-Host '→ <archive bytes> | zipnative stream   (text table, default --list):'
& node -e $CatJs $Zip | & $ZnExe @ZnPre stream

Write-Host ''
Write-Host '→ NDJSON rows as they arrive (saved to 01-forward-list.ndjson):'
& node -e $CatJs $Zip | & $ZnExe @ZnPre stream --list --format ndjson --quiet | Tee-Object -FilePath (Join-Path $OutputDir '01-forward-list.ndjson')

Write-Host ''
Write-Host '→ --json --summary carries the trust marker:'
& node -e $CatJs $Zip | & $ZnExe @ZnPre stream --json --format json --summary

Write-Host ''
Write-Host '→ --input reads a file sequentially with the same forward reader:'
zn stream --input $Zip --list --long --quiet
