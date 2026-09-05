# stream/03-forward-cat.ps1 — pull one entry out of a pipe (stream --cat)
#
# `stream --cat <name>` writes the named entry's decoded bytes to stdout as
# soon as its local header passes by — no seeking, no central directory.
# --cat is repeatable; entries are emitted in archive order. Handy for
# `curl … | zipnative stream --cat manifest.json` style one-liners. The
# round trip is checked with crc32 at the end of a native-only pipe (a
# PowerShell pipeline would re-encode the bytes as text lines).
#
# Usage:
#   pwsh -File samples/stream/03-forward-cat.ps1

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

Write-Host '→ <archive bytes> | zipnative stream --cat text/notes.md:'
& node -e $CatJs $Zip | & $ZnExe @ZnPre stream --cat text/notes.md --quiet

Write-Host ''
Write-Host '→ CRC of the streamed entry vs the source file:'
& node -e $CatJs $Zip | & $ZnExe @ZnPre stream --cat text/notes.md --quiet | & $ZnExe @ZnPre crc32
zn crc32 (Join-Path $InputDir 'text/notes.md')

Write-Host ''
Write-Host '→ Two entries, in archive order, piped straight into crc32:'
& node -e $CatJs $Zip | & $ZnExe @ZnPre stream --cat text/readme.txt --cat text/notes.md --quiet | & $ZnExe @ZnPre crc32
