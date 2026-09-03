# batch/02-manifest-pipeline.ps1 — create → verify → inspect → extract → crc32
#
# `batch --manifest tasks.json` runs an ordered pipeline of whitelisted
# commands (create, list, inspect, extract, cat, verify, stream, modify,
# crc32, inflate — never batch/govern/schema/completion/doctor). A flag value
# "@<id>" is replaced by the resolved output of an EARLIER task; relative
# paths resolve against the MANIFEST's directory and may not climb out of it
# with `..`. Tasks run sequentially and fail fast (--continue-on-error keeps
# independent tasks going); a `codec` flag is refused unless the batch
# invocation carries --allow-codec-load.
#
# Because the manifest anchors its paths, the script stages tasks.json and
# the text tree together under samples/output/batch/02-pipeline/ and runs
# the pipeline there (outputs land in 02-pipeline/out/).
#
# Usage:
#   pwsh -File samples/batch/02-manifest-pipeline.ps1
#
# Output: samples/output/batch/02-pipeline/out/

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/batch'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Stage = Join-Path $OutputDir '02-pipeline'
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
Copy-Item (Join-Path $InputDir 'batch/tasks.json') (Join-Path $Stage 'tasks.json')
Copy-Item -Recurse (Join-Path $InputDir 'text') (Join-Path $Stage 'text')

Write-Host '→ Manifest (paths are relative to its own directory):'
Get-Content (Join-Path $Stage 'tasks.json')

Write-Host ''
Write-Host '→ Running the pipeline:'
zn batch --manifest (Join-Path $Stage 'tasks.json') --format json

Write-Host ''
Write-Host '→ Artefacts:'
Get-ChildItem -Recurse -File -Name (Join-Path $Stage 'out') | Sort-Object | ForEach-Object { Write-Host "  $_" }
