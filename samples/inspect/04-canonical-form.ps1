# inspect/04-canonical-form.ps1 — the engine's determinism verdict and its offenders
#
# `inspect` measures determinism with zipnative 1.1 analyzeDeterminism():
# `deterministic` (epoch timestamps + canonical order + UTF-8 flags — the
# archive rebuilds byte-for-byte) and `canonicalForm` (also canonical extra
# fields and version-made-by 0x032D — the form `--deterministic` writes).
# `offenders` names every entry that breaks it and why (timestamp, order,
# utf8-flag, extra-field, version-made-by); a data-descriptor offender is
# informational only — the streamed layout is what `canonicalLayout` gates.
# `--check canonical-form` turns the verdict into a gate —
# the second call below is EXPECTED to fail: the dates are pinned, but not
# to the DOS epoch.
#
# Usage:
#   pwsh -File samples/inspect/04-canonical-form.ps1
#
# Output: samples/output/inspect/04-canonical.zip, 04-dated.zip, 04-offenders.json

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/inspect'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Canonical = Join-Path $OutputDir '04-canonical.zip'
$Dated     = Join-Path $OutputDir '04-dated.zip'
zn create (Join-Path $InputDir 'text') --deterministic --output $Canonical --overwrite --quiet
zn create (Join-Path $InputDir 'text') --date 2024-01-02T03:04:06Z --output $Dated --overwrite --quiet

Write-Host '→ --deterministic writes the canonical form:'
zn inspect --input $Canonical --summary --check canonical-form,deterministic

Write-Host ''
Write-Host '→ A pinned non-epoch date is reproducible run-to-run, yet not the canonical form — the offenders say why:'
zn inspect --input $Dated --format json --fields determinism | Tee-Object -FilePath (Join-Path $OutputDir '04-offenders.json')

# The next call is EXPECTED to fail: keep a non-zero native exit code from
# becoming a terminating error and read $LASTEXITCODE instead.
$PSNativeCommandUseErrorActionPreference = $false

Write-Host ''
Write-Host '→ The gate fails (exit 1, E_CHECK_FAILED):'
zn inspect --input $Dated --summary --check canonical-form
Write-Host "  exit $LASTEXITCODE"
