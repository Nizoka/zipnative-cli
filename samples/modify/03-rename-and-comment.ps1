# modify/03-rename-and-comment.ps1 — --rename, --add-dir, --comment, --in-place
#
# --rename <from>=<to> rewrites an entry's name (the payload is copied, not
# recompressed); --add-dir adds an explicit directory entry; --comment sets
# the archive comment ("" clears it). --in-place writes back to the input
# path through a temp file + rename, so a crash never leaves a half-written
# archive behind. --dry-run validates the edits and writes nothing.
#
# Usage:
#   pwsh -File samples/modify/03-rename-and-comment.ps1
#
# Output: samples/output/modify/03-rename-and-comment.zip, 03-in-place.zip

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
$Out  = Join-Path $OutputDir '03-rename-and-comment.zip'
$Ip   = Join-Path $OutputDir '03-in-place.zip'
if (-not (Test-Path $Base)) {
    zn create (Join-Path $InputDir 'text') --output $Base --quiet
}

Write-Host '→ --dry-run first: the plan, nothing written:'
zn modify --input $Base --output $Out --rename text/notes.md=text/NOTES.md --dry-run --json

Write-Host ''
Write-Host '→ Rename + directory entry + archive comment (--compact for a clean layout):'
zn modify --input $Base --output $Out `
    --rename text/notes.md=text/NOTES.md `
    --add-dir text/attachments `
    --comment 'renamed by samples/modify/03-rename-and-comment.ps1' `
    --compact --json
zn list --input $Out
zn inspect --input $Out --format json --fields archive.comment

Write-Host ''
Write-Host '→ --in-place on a copy (temp file + atomic rename):'
Copy-Item -Force $Base $Ip
zn modify --input $Ip --in-place --comment 'edited in place' --compact --json
zn inspect --input $Ip --format json --fields archive.comment
