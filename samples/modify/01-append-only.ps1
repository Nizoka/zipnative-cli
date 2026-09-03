# modify/01-append-only.ps1 — --add / --replace / --remove without recompression
#
# `modify` never recompresses untouched entries. Edits apply in a FIXED order
# regardless of argv order: remove → rename → replace → add/add-dir → comment.
# The DEFAULT save is APPEND-ONLY: the original bytes are kept verbatim, new
# payloads and a fresh central directory are appended. Consequences:
#   • the file only grows — removed/replaced content REMAINS RECOVERABLE
#     (data remanence) and `list` reports ZIP_MULTIPLE_EOCD on the result;
#   • 7-Zip's CLI is known to mis-read this layout.
# Pass --compact (see 02) whenever either matters.
#
# Usage:
#   pwsh -File samples/modify/01-append-only.ps1
#
# Output: samples/output/modify/base.zip, 01-append-only.zip

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/modify'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Base = Join-Path $OutputDir 'base.zip'
$Out  = Join-Path $OutputDir '01-append-only.zip'
if (-not (Test-Path $Base)) {
    zn create (Join-Path $InputDir 'text') --output $Base --quiet
}

Write-Host '→ Before:'
zn list --input $Base

Write-Host ''
Write-Host '→ modify: add extra/pattern.bin, replace text/readme.txt, remove the dotted file:'
zn modify --input $Base --output $Out `
    --add ("extra/pattern.bin=" + (Join-Path $InputDir 'binary/pattern.bin')) `
    --replace ("text/readme.txt=" + (Join-Path $InputDir 'text/notes.md')) `
    --remove text/with-dash_and.dots.txt `
    --json

Write-Host ''
Write-Host '→ After (note the ZIP_MULTIPLE_EOCD info line — the old central directory is still inside):'
zn list --input $Out

Write-Host ''
Write-Host '→ Sizes — append-only output is LARGER than base + new payload:'
Write-Host ("  {0,6} base.zip" -f (Get-Item $Base).Length)
Write-Host ("  {0,6} 01-append-only.zip" -f (Get-Item $Out).Length)
Write-Host "  The removed entry's bytes are still in the file: pass --compact to truly drop them (02)."
