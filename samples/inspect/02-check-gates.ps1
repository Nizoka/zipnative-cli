# inspect/02-check-gates.ps1 — CI assertions with --check (pass, then fail)
#
# --check turns the report into a gate. Assertions are repeatable and
# comma-separable: deterministic, epoch-timestamps, canonical-order,
# utf8-names, no-data-descriptor, no-zip64, no-encryption, no-symlinks,
# no-duplicates, no-diagnostics, store-only, deflate-only, max-entries=N,
# min-entries=N, max-uncompressed=<size>, max-ratio=N, has=<name>,
# method=store|deflate. Any failure prints the report and exits 1 with
# E_CHECK_FAILED — the second call below is EXPECTED to fail.
#
# Usage:
#   pwsh -File samples/inspect/02-check-gates.ps1
#
# Output: samples/output/inspect/02-check-pass.json

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/inspect'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Zip = Join-Path $OutputDir 'archive.zip'
if (-not (Test-Path $Zip)) {
    zn create (Join-Path $InputDir 'text') (Join-Path $InputDir 'binary') --deterministic --output $Zip --quiet
}

Write-Host '→ Passing gate (deterministic, no encryption, ≤ 10 entries, has readme):'
zn inspect --input $Zip `
    --check deterministic,no-encryption,no-symlinks,max-entries=10 `
    --check has=text/readme.txt `
    --summary --format json | Tee-Object -FilePath (Join-Path $OutputDir '02-check-pass.json')
Write-Host '  ✓ exit 0 — checksPassed: true'

# The next calls are EXPECTED to fail: keep a non-zero native exit code from
# becoming a terminating error and read $LASTEXITCODE instead.
$PSNativeCommandUseErrorActionPreference = $false

Write-Host ''
Write-Host "→ Failing gate — the archive is deflated, so 'store-only' cannot hold:"
zn inspect --input $Zip --check store-only --summary --json
Write-Host "  exit $LASTEXITCODE (E_CHECK_FAILED, envelope above on stderr)"

Write-Host ''
Write-Host '→ Same failure in text mode — every check verdict is listed:'
zn inspect --input $Zip --check store-only,max-uncompressed=1k --format text
Write-Host "  exit $LASTEXITCODE"
