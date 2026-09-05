# create/07-comment-and-order.ps1 — archive/entry comments, --order, --date
#
# --comment sets the archive comment, --entry-comment <name>=<text> a
# per-entry one. --order insertion keeps the argv order (directories walk
# name-sorted) instead of the
# canonical raw-name-byte sort, and --date pins every timestamp to an ISO
# instant (DOS time has 2-second resolution) instead of the epoch default —
# both are legitimate choices that `inspect` will report as non-deterministic.
#
# Usage:
#   pwsh -File samples/create/07-comment-and-order.ps1
#
# Output: samples/output/create/07-comment-and-order.zip

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/create'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Zip = Join-Path $OutputDir '07-comment-and-order.zip'

Write-Host '→ Building with comments, insertion order and a fixed date:'
zn create (Join-Path $InputDir 'text') `
    --comment 'built by samples/create/07-comment-and-order.ps1' `
    --entry-comment 'text/readme.txt=the readme' `
    --order insertion `
    --date 2024-01-02T03:04:06Z `
    --output $Zip --json

Write-Host ''
Write-Host '→ inspect shows the comment and the (intentionally) non-epoch dates:'
zn inspect --input $Zip --format json --fields archive.comment,determinism,stats.earliestDate

Write-Host ''
Write-Host '→ Entry comments travel in the central directory (inspect --entries):'
zn inspect --input $Zip --format json --entries --fields entries.name,entries.comment
