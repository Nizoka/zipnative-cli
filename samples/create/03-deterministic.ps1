# create/03-deterministic.ps1 — reproducible builds: same inputs → same SHA-256
#
# Timestamps and entry order are pinned by default, but the DEFAULT deflate
# path goes through node:zlib, whose bytes are only stable per zlib build.
# `--deterministic` pins zipnative's pure-TS encoder instead, so the archive
# hashes identically on every runtime and platform. The script builds the
# same tree twice and compares the hashes, then asserts the property with
# `inspect --check deterministic`.
#
# Usage:
#   pwsh -File samples/create/03-deterministic.ps1
#
# Output: samples/output/create/03-deterministic-a.zip, 03-deterministic-b.zip

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/create'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Inputs = @((Join-Path $InputDir 'text'), (Join-Path $InputDir 'binary'), (Join-Path $InputDir 'unicode'))
$A = Join-Path $OutputDir '03-deterministic-a.zip'
$B = Join-Path $OutputDir '03-deterministic-b.zip'

Write-Host '→ Build #1:'
zn create @Inputs --deterministic --output $A --json
Write-Host '→ Build #2:'
zn create @Inputs --deterministic --output $B --json

Write-Host ''
$Ha = (Get-FileHash -Algorithm SHA256 $A).Hash.ToLower()
$Hb = (Get-FileHash -Algorithm SHA256 $B).Hash.ToLower()
Write-Host "  sha256(a) = $Ha"
Write-Host "  sha256(b) = $Hb"
if ($Ha -eq $Hb) {
    Write-Host '  ✓ byte-identical (tier: pure-pinned)'
} else {
    Write-Error '  ✗ hashes differ'
}

Write-Host ''
Write-Host '→ CI gate — inspect --check deterministic,epoch-timestamps,canonical-order:'
zn inspect --input $A --check deterministic,epoch-timestamps,canonical-order --summary --format json
