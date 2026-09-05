# modify/02-compact.ps1 — canonical rewrite with --compact (true deletion)
#
# --compact re-emits the archive canonically: removed data is truly gone,
# offsets are rebuilt, the single central directory sits at the end — and
# untouched entries are STILL copied compressed as-is (no recompression).
# The script removes an entry both ways and compares sizes and diagnostics.
#
# Usage:
#   pwsh -File samples/modify/02-compact.ps1
#
# Output: samples/output/modify/02-append.zip, 02-compact.zip

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/modify'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Base    = Join-Path $OutputDir 'base.zip'
$Append  = Join-Path $OutputDir '02-append.zip'
$Compact = Join-Path $OutputDir '02-compact.zip'
if (-not (Test-Path $Base)) {
    zn create (Join-Path $InputDir 'text') --output $Base --quiet
}

Write-Host '→ Remove text/notes.md, append-only (default):'
zn modify --input $Base --output $Append --remove text/notes.md --json

Write-Host ''
Write-Host '→ Remove text/notes.md, --compact:'
zn modify --input $Base --output $Compact --remove text/notes.md --compact --json

Write-Host ''
Write-Host '→ Sizes (base → append-only grows, compact shrinks):'
foreach ($p in $Base, $Append, $Compact) { Write-Host ("  {0,6} {1}" -f (Get-Item $p).Length, (Split-Path -Leaf $p)) }

Write-Host ''
Write-Host '→ inspect: multipleEocd is true only for the append-only file:'
zn inspect --input $Append  --format json --fields archive.bytes,archive.multipleEocd,diagnostics
zn inspect --input $Compact --format json --fields archive.bytes,archive.multipleEocd,diagnostics

Write-Host ''
Write-Host '→ Both still verify:'
zn verify --input $Append  --json --summary
zn verify --input $Compact --json --summary
