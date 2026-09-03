# cat/01-cat-entry.ps1 — stream entries to stdout (decoded, and --raw)
#
# `cat` writes one or more entries to stdout in order (like `unzip -p`). The
# CRC is verified at the END of the stream, so a corrupt entry can already
# have produced bytes when E_DATA fires — with --output the partial file is
# removed. --raw emits the COMPRESSED payload untouched (zero-copy), which
# `inflate` can decode back. --dry-run resolves the entries and reports
# their sizes without emitting anything. Binary results go through --output
# (a PowerShell pipeline would re-encode them as text).
#
# Usage:
#   pwsh -File samples/cat/01-cat-entry.ps1
#
# Output: samples/output/cat/archive.zip, 01-readme.txt, 01-readme.deflate

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/cat'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Zip = Join-Path $OutputDir 'archive.zip'
if (-not (Test-Path $Zip)) {
    zn create (Join-Path $InputDir 'text') --output $Zip --quiet
}

Write-Host '→ cat text/notes.md to the terminal:'
zn cat --input $Zip --entry text/notes.md

Write-Host ''
Write-Host '→ Two entries concatenated, positional form, into a file:'
$Two = Join-Path $OutputDir '01-two-entries.txt'
zn cat $Zip text/readme.txt text/with-dash_and.dots.txt --output $Two
Write-Host ("  {0} bytes" -f (Get-Item $Two).Length)

Write-Host ''
Write-Host '→ --dry-run: sizes only, nothing emitted:'
zn cat --input $Zip --entry text/readme.txt --dry-run --json

Write-Host ''
Write-Host '→ --raw: the compressed DEFLATE payload, then inflate it back:'
$Raw = Join-Path $OutputDir '01-readme.deflate'
$Txt = Join-Path $OutputDir '01-readme.txt'
zn cat --input $Zip --entry text/readme.txt --raw --output $Raw
zn inflate --input $Raw --output $Txt --json
$Src = (Get-FileHash -Algorithm SHA256 (Join-Path $InputDir 'text/readme.txt')).Hash
$Out = (Get-FileHash -Algorithm SHA256 $Txt).Hash
if ($Src -eq $Out) { Write-Host '  ✓ raw payload inflates to the original bytes' } else { Write-Error '  ✗ mismatch' }
