# extract/02-filter-and-flat.ps1 — --include/--exclude globs, --entry, --flat
#
# Globs (*, **, ?) select entries by name; --entry names them exactly; --flat
# drops directories and writes basenames only. Two entries collapsing onto
# the same flat path are refused (ZIP_EXTRACT_DUPLICATE_PATH) unless
# --on-duplicate first|last says which one wins. Filtered entries are
# reported as skipped (reason "filtered") on stderr.
#
# Usage:
#   pwsh -File samples/extract/02-filter-and-flat.ps1
#
# Output: samples/output/extract/02-markdown/, 02-flat/, 02-entry/

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/extract'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Zip = Join-Path $OutputDir 'archive.zip'
if (-not (Test-Path $Zip)) {
    zn create (Join-Path $InputDir 'text') (Join-Path $InputDir 'unicode') --output $Zip --quiet
}
foreach ($d in '02-markdown', '02-flat', '02-entry') {
    $p = Join-Path $OutputDir $d
    if (Test-Path $p) { Remove-Item -Recurse -Force $p }
}

Write-Host "→ Only Markdown (--include '**/*.md'), tree preserved:"
zn extract --input $Zip --output-dir (Join-Path $OutputDir '02-markdown') --include '**/*.md' --quiet
Get-ChildItem -Recurse -File -Name (Join-Path $OutputDir '02-markdown') | Sort-Object | ForEach-Object { Write-Host "  $_" }

Write-Host ''
Write-Host '→ Everything except *.txt, flattened (--exclude + --flat):'
zn extract --input $Zip --output-dir (Join-Path $OutputDir '02-flat') --exclude '**/*.txt' --flat --quiet
Get-ChildItem -File -Name (Join-Path $OutputDir '02-flat') | ForEach-Object { Write-Host "  $_" }

Write-Host ''
Write-Host '→ A single named entry (--entry):'
zn extract --input $Zip --output-dir (Join-Path $OutputDir '02-entry') --entry 'unicode/café/résumé.txt' --json
