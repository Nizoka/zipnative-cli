# agent/02-error-envelope.ps1 — deterministic failures via the JSON error envelope
#
# Every failure under --json is one JSON object on stderr with a stable E_*
# `code` (branch on the CLASS), zipnative's frozen ZIP_* `zipCode` (the exact
# CAUSE, verbatim from the engine), the `entryName` when one is involved and
# a structured `detail`. Exit codes: 2 for usage errors, 1 for everything
# else. Every call below is EXPECTED to fail.
#
# Usage:
#   pwsh -File samples/agent/02-error-envelope.ps1

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/agent'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Zip = Join-Path $OutputDir '02-archive.zip'
zn create (Join-Path $InputDir 'text') --output $Zip --quiet

# Every call below is EXPECTED to fail — read $LASTEXITCODE instead of terminating.
$PSNativeCommandUseErrorActionPreference = $false

Write-Host '→ E_NOT_FOUND — a named entry does not exist (entryName carried):'
zn cat --input $Zip --entry missing.txt --json
Write-Host "  exit $LASTEXITCODE"

Write-Host ''
Write-Host '→ E_PARSE + zipCode — the bytes are not a ZIP (ZIP_EOCD_NOT_FOUND):'
zn list --input (Join-Path $InputDir 'text/readme.txt') --json
Write-Host "  exit $LASTEXITCODE"

Write-Host ''
Write-Host '→ E_IO — the file does not exist:'
zn list --input (Join-Path $OutputDir 'does-not-exist.zip') --json
Write-Host "  exit $LASTEXITCODE"

Write-Host ''
Write-Host '→ E_USAGE — missing required argument (exit 2):'
zn create --json
Write-Host "  exit $LASTEXITCODE"

Write-Host ''
Write-Host '→ E_INPUT — a manifest that would not extract safely:'
$BadManifest = Join-Path $OutputDir '02-bad-manifest.json'
Set-Content -Path $BadManifest -Value '{"entries":[{"name":"../escape.txt","data":"x"}]}' -NoNewline
zn create --from-manifest $BadManifest --output (Join-Path $OutputDir '02-never.zip') --json
Write-Host "  exit $LASTEXITCODE"

Write-Host ''
Write-Host '→ E_DATA + zipCode + detail — CRC mismatch on a tampered STORED entry:'
$Stored   = Join-Path $OutputDir '02-stored.zip'
$Tampered = Join-Path $OutputDir '02-tampered.zip'
zn create (Join-Path $InputDir 'text') --method store --output $Stored --quiet
$FlipJs = @'
const fs = require("node:fs"); const [src, dst] = process.argv.slice(1);
const b = Buffer.from(fs.readFileSync(src)); b[b.indexOf("zipnative-cli sample input")] ^= 0xff; fs.writeFileSync(dst, b);
'@
& node -e $FlipJs $Stored $Tampered
zn cat --input $Tampered --entry text/readme.txt --json | Out-Null
Write-Host "  exit $LASTEXITCODE"

Write-Host ''
Write-Host "Branch on error.code first, then on error.zipCode — see the README's agent loop."
