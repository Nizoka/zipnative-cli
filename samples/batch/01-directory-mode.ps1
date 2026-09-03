# batch/01-directory-mode.ps1 — one archive per subfolder, then verify them all
#
# `batch --input-dir <dir> --output-dir <dir>` turns every IMMEDIATE
# subdirectory of the input into <output-dir>/<name>.zip through the full
# `create` command — every create flag (--deterministic, --method, --level,
# --order, --date, --comment …) is honoured — with a bounded worker pool
# (--concurrency, default 4; --fail-fast stops scheduling after the first
# failure). `--task verify` then verifies every *.zip in a directory.
#
# Usage:
#   pwsh -File samples/batch/01-directory-mode.ps1
#
# Output: samples/output/batch/01-archives/*.zip

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/batch'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Archives = Join-Path $OutputDir '01-archives'
if (Test-Path $Archives) { Remove-Item -Recurse -Force $Archives }

Write-Host '→ samples/input/* subfolders → one deterministic archive each (2 workers):'
zn batch --input-dir $InputDir --output-dir $Archives --deterministic --concurrency 2
Get-ChildItem -File -Name $Archives | ForEach-Object { Write-Host "  $_" }

Write-Host ''
Write-Host '→ Verify the whole folder (--task verify, JSON summary):'
zn batch --input-dir $Archives --task verify --format json --summary --quiet

Write-Host ''
Write-Host '→ One of them:'
zn list --input (Join-Path $Archives 'unicode.zip')
