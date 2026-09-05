# list/02-json-fields.ps1 — JSON report, --summary and --fields projection
#
# --format json emits the full entries report (shape: `zipnative schema
# entries`). --summary collapses it to counts and sizes; --fields keeps only
# the named dot-paths — `entries.name,entries.uncompressedSize` projects every
# array element. Under --json the output is compact (one line) unless --pretty.
#
# Usage:
#   pwsh -File samples/list/02-json-fields.ps1
#
# Output: samples/output/list/02-json-fields.json

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

Write-Host '→ --format json --summary:'
zn list --input $Zip --format json --summary

Write-Host ''
Write-Host '→ --fields entries.name,entries.uncompressedSize (saved to 02-json-fields.json):'
zn list --input $Zip --format json --fields entries.name,entries.uncompressedSize | Tee-Object -FilePath (Join-Path $OutputDir '02-json-fields.json')

Write-Host ''
Write-Host '→ Agent mode: --json makes the same report compact, --pretty re-indents it:'
zn list --input $Zip --json --summary
zn list --input $Zip --json --pretty --fields entries.name
