# verify/02-tamper-detect.ps1 — a flipped payload byte fails verification
#
# The archive is built with --method store so a payload byte can be flipped
# in place without breaking the DEFLATE stream: the structure stays valid,
# only the CRC-32 no longer matches. `verify` reports the entry as FAIL
# (crc) and exits 1 with E_VERIFY_FAILED — the second call is EXPECTED to
# fail. `cat` on the tampered entry fails with E_DATA at the end of the
# stream for the same reason.
#
# Usage:
#   pwsh -File samples/verify/02-tamper-detect.ps1
#
# Output: samples/output/verify/02-tampered.zip

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/verify'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Zip = Join-Path $OutputDir 'stored.zip'
$Bad = Join-Path $OutputDir '02-tampered.zip'
if (-not (Test-Path $Zip)) {
    zn create (Join-Path $InputDir 'text') --method store --output $Zip --quiet
}

Write-Host "→ Flipping one byte inside text/readme.txt's stored payload:"
$FlipJs = @'
const fs = require("node:fs");
const [src, dst] = process.argv.slice(1);
const buf = Buffer.from(fs.readFileSync(src));
const i = buf.indexOf("zipnative-cli sample input");
if (i === -1) { console.error("payload not found"); process.exit(1); }
buf[i] ^= 0xff;
fs.writeFileSync(dst, buf);
console.log("  flipped byte at offset " + i);
'@
& node -e $FlipJs $Zip $Bad

# Expected failures below — read $LASTEXITCODE instead of terminating.
$PSNativeCommandUseErrorActionPreference = $false

Write-Host ''
Write-Host '→ verify (expect FAIL on text/readme.txt, exit 1):'
zn verify --input $Bad
Write-Host "  exit $LASTEXITCODE"

Write-Host ''
Write-Host '→ Agent view — E_VERIFY_FAILED in the envelope:'
zn verify --input $Bad --json --summary
Write-Host "  exit $LASTEXITCODE"

Write-Host ''
Write-Host '→ cat refuses the entry at the end of the stream (E_DATA):'
zn cat --input $Bad --entry text/readme.txt --json | Out-Null
Write-Host "  exit $LASTEXITCODE"
