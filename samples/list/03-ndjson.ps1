# list/03-ndjson.ps1 — one JSON object per entry (--format ndjson)
#
# NDJSON streams one row per line — ideal for line-oriented filters,
# ConvertFrom-Json per row, or feeding a log pipeline without holding the
# whole report in memory. Combined with --include/--exclude it doubles as a
# cheap archive query language.
#
# Usage:
#   pwsh -File samples/list/03-ndjson.ps1
#
# Output: samples/output/list/03-ndjson.ndjson

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/list'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Zip = Join-Path $OutputDir 'archive.zip'
if (-not (Test-Path $Zip)) {
    zn create (Join-Path $InputDir 'text') (Join-Path $InputDir 'unicode') --output $Zip --quiet
}

Write-Host '→ --format ndjson (saved to 03-ndjson.ndjson):'
zn list --input $Zip --format ndjson | Tee-Object -FilePath (Join-Path $OutputDir '03-ndjson.ndjson')

Write-Host ''
Write-Host '→ Only Markdown entries, name and CRC (ndjson + --exclude + ConvertFrom-Json per row):'
zn list --input $Zip --format ndjson --exclude '**/*.txt' | ForEach-Object {
    $row = $_ | ConvertFrom-Json
    Write-Host ("  {0}  {1}" -f $row.crc32, $row.name)
}
