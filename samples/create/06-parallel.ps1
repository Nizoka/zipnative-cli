# create/06-parallel.ps1 — worker-pool deflate with --parallel
#
# `--parallel` fans per-entry deflate out across a worker pool
# (zipnative/worker). Output is byte-identical to the sequential writer for
# the same codec tier, which the script proves with a byte comparison.
# --workers caps the pool, --min-job-size keeps tiny entries on the main
# thread (lowered here so the small sample tree actually reaches a worker).
#
# Usage:
#   pwsh -File samples/create/06-parallel.ps1
#
# Output: samples/output/create/06-sequential.zip, 06-parallel.zip

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/create'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Seq = Join-Path $OutputDir '06-sequential.zip'
$Par = Join-Path $OutputDir '06-parallel.zip'

Write-Host '→ Sequential writer:'
zn create $InputDir --output $Seq --json

Write-Host ''
Write-Host '→ Parallel writer (2 workers, entries >= 1 KiB dispatched):'
zn create $InputDir --parallel --workers 2 --min-job-size 1k --output $Par --json

Write-Host ''
$Hs = (Get-FileHash -Algorithm SHA256 $Seq).Hash
$Hp = (Get-FileHash -Algorithm SHA256 $Par).Hash
if ($Hs -eq $Hp) {
    Write-Host '  ✓ parallel output is byte-identical to the sequential writer'
} else {
    Write-Error '  ✗ outputs differ'
}
