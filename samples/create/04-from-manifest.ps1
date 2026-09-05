# create/04-from-manifest.ps1 — declarative archives with --from-manifest
#
# A JSON manifest names every entry explicitly: a file `path` (relative to the
# MANIFEST's directory — `..` segments are refused), inline `data`,
# `dataBase64`, an explicit `directory`, plus per-entry `method`, `level`,
# `comment`, `date` and POSIX `mode`. See samples/input/manifest/entries.json
# and `zipnative schema create-manifest` for the full shape. An empty
# manifest is valid and yields an empty (22-byte) archive.
#
# Usage:
#   pwsh -File samples/create/04-from-manifest.ps1
#
# Output: samples/output/create/04-from-manifest.zip, 04-empty.zip

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/create'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Manifest = Join-Path $InputDir 'manifest/entries.json'
$Zip      = Join-Path $OutputDir '04-from-manifest.zip'

Write-Host '→ Manifest:'
Get-Content $Manifest

Write-Host ''
Write-Host '→ Building from the manifest:'
zn create --from-manifest $Manifest --output $Zip --json

Write-Host ''
Write-Host '→ Result (note the 0755 mode on bin/run.sh and the explicit directory entry):'
zn list --input $Zip --long

Write-Host ''
Write-Host '→ An empty manifest is valid:'
$Empty = Join-Path $OutputDir '04-empty.zip'
zn create --from-manifest (Join-Path $InputDir 'manifest/empty.json') --output $Empty --json
Write-Host ("  {0} bytes" -f (Get-Item $Empty).Length)
