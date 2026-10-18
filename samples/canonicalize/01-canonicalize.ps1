# canonicalize/01-canonicalize.ps1 — make any archive reproducible, without recompression
#
# `canonicalize` rewrites an archive from any producer into zipnative's
# canonical deterministic form (zipnative 1.1 canonicalizeZip): timestamps
# pinned (the DOS epoch, or --date), entries sorted by raw name bytes, names
# re-encoded as UTF-8, extra fields and comments dropped. Payloads are copied
# bit for bit — nothing is recompressed or decoded, so run `verify` first when
# integrity matters. Running it twice yields the same bytes.
#
# Here the input is the committed foreign archive (bsdtar), which is neither
# reproducible nor in the canonical form.
#
# Usage:
#   pwsh -File samples/canonicalize/01-canonicalize.ps1
#
# Output: samples/output/canonicalize/01-canonical.zip, 01-again.zip

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$OutputDir = Join-Path $RootDir 'samples/output/canonicalize'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Src   = Join-Path $RootDir 'tests/fixtures/interop/bsdtar-basic.zip'
$Out   = Join-Path $OutputDir '01-canonical.zip'
$Again = Join-Path $OutputDir '01-again.zip'

Write-Host '→ The foreign archive is not in the canonical form:'
zn inspect --input $Src --summary --format json

Write-Host ''
Write-Host '→ canonicalize (the envelope reports the verdicts measured on the OUTPUT):'
zn canonicalize $Src -o $Out --overwrite --json

Write-Host ''
Write-Host '→ The gate now passes:'
zn inspect --input $Out --summary --check canonical-form

Write-Host ''
Write-Host '→ Idempotent — canonicalising the output changes nothing:'
zn canonicalize $Out -o $Again --overwrite --json
if ((Get-FileHash $Out).Hash -eq (Get-FileHash $Again).Hash) { Write-Host '  ✓ identical bytes' } else { throw 'canonicalize is not idempotent' }
