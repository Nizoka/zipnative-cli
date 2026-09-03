# govern/02-verify-issue.ps1 — gate an issue/PR draft against the HITL policy
#
# `govern verify-issue <draft.md>` validates a locally-authored draft BEFORE a
# human reviews and submits it. It PASSES a compliant draft (exit 0) and
# BLOCKS a non-compliant one (exit 1, E_POLICY): proposing a runtime
# dependency (`npm install some-lib`) or omitting a fenced reproduction block
# are errors; a missing environment / expected-behaviour section or an
# anti-goal proposal is a warning. A passing check is necessary but NOT
# sufficient — a human still reviews and submits under their own identity.
#
# Usage:
#   pwsh -File samples/govern/02-verify-issue.ps1

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }
$CatJs = 'require("fs").createReadStream(process.argv[1]).pipe(process.stdout)'

$Good = Join-Path $InputDir 'govern/draft-good.md'
$Bad  = Join-Path $InputDir 'govern/draft-bad.md'

# The BLOCK case is EXPECTED to exit 1 — read $LASTEXITCODE instead of terminating.
$PSNativeCommandUseErrorActionPreference = $false

Write-Host '→ [1/2] Verifying a COMPLIANT draft (expect PASS / exit 0)…'
zn govern verify-issue $Good
if ($LASTEXITCODE -eq 0) {
    Write-Host '  ✓ draft-good.md passed.'
} else {
    Write-Error '  ✗ Unexpected failure on draft-good.md'
}

Write-Host ''
Write-Host '→ [2/2] Verifying a NON-COMPLIANT draft (expect BLOCK / exit 1)…'
zn govern verify-issue $Bad
if ($LASTEXITCODE -eq 0) {
    Write-Error '  ✗ draft-bad.md unexpectedly passed'
} else {
    Write-Host "  ✓ draft-bad.md was correctly blocked (exit $LASTEXITCODE)."
}

Write-Host ''
Write-Host '→ Agent view — report on stdout, E_POLICY envelope on stderr:'
zn govern verify-issue --input $Bad --json --pretty
Write-Host "  exit $LASTEXITCODE"

Write-Host ''
Write-Host '→ Drafts can also arrive on stdin (--input -):'
& node -e $CatJs $Good | & $ZnExe @ZnPre govern verify-issue --input - --format json
