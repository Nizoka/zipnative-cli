# batch/03-dry-run.ps1 — validate a batch plan without executing it
#
# --dry-run validates everything up front — manifest structure, the command
# whitelist, the "@id" reference graph and the codec-load policy — then
# prints the plan and stops. In directory mode it lists the archives that
# WOULD be created (each `create` runs its own dry run). Nothing is written.
#
# Usage:
#   pwsh -File samples/batch/03-dry-run.ps1

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/batch'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Stage = Join-Path $OutputDir '03-dry-run'
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
Copy-Item (Join-Path $InputDir 'batch/tasks.json') (Join-Path $Stage 'tasks.json')
Copy-Item -Recurse (Join-Path $InputDir 'text') (Join-Path $Stage 'text')

Write-Host '→ Manifest plan (text):'
zn batch --manifest (Join-Path $Stage 'tasks.json') --dry-run

Write-Host ''
Write-Host '→ Manifest plan (JSON, agent mode):'
zn batch --manifest (Join-Path $Stage 'tasks.json') --dry-run --json --pretty

Write-Host ''
Write-Host '→ Directory-mode plan (--summary):'
zn batch --input-dir $InputDir --output-dir (Join-Path $Stage 'never-created') --dry-run --format json --summary --quiet

Write-Host ''
if ((Test-Path (Join-Path $Stage 'out')) -or (Test-Path (Join-Path $Stage 'never-created'))) {
    Write-Error '  ✗ dry run wrote output'
} else {
    Write-Host '  ✓ nothing was written'
}
