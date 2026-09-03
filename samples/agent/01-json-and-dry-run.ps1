# agent/01-json-and-dry-run.ps1 — agent mode: --json status envelope + --dry-run
#
# In agent mode (--json) the CLI keeps the primary artefact on stdout and
# emits ONE JSON envelope on stderr: { ok: true, command, … } on success,
# { ok: false, command, error: { code, message, zipCode?, entryName?,
# detail? } } on failure. --dry-run validates inputs and prints the plan
# without writing a byte (create, extract, modify, stream, cat, inflate,
# batch). Numeric exit codes (0/1/2) are the same in every mode.
#
# Usage:
#   pwsh -File samples/agent/01-json-and-dry-run.ps1
#
# Output: samples/output/agent/01-status.zip

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/agent'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Inputs = @((Join-Path $InputDir 'text'), (Join-Path $InputDir 'binary'))
$Never  = Join-Path $OutputDir '01-never-written.zip'
$Zip    = Join-Path $OutputDir '01-status.zip'
if (Test-Path $Never) { Remove-Item -Force $Never }

Write-Host '→ --dry-run --json: plan on stdout, envelope (dryRun: true) on stderr, no file:'
zn create @Inputs --output $Never --dry-run --json
if (-not (Test-Path $Never)) { Write-Host "  ✓ $Never was not written" }

Write-Host ''
Write-Host '→ Real build: success envelope carries bytes, tier, entries, diagnostics:'
zn create @Inputs --output $Zip --json

Write-Host ''
Write-Host '→ The envelope is stderr; stdout stays clean for data — capture them separately:'
$Envelope = zn extract --input $Zip --output-dir (Join-Path $OutputDir '01-extracted') --overwrite --json 2>&1 | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } | ForEach-Object { $_.ToString() }
Write-Host "  envelope: $Envelope"

Write-Host ''
Write-Host '→ --pretty indents the envelope for humans:'
zn cat --input $Zip --entry text/readme.txt --dry-run --json --pretty
