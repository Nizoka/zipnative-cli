# create/01-basic.ps1 — Build a ZIP from a directory tree
#
# The simplest invocation: one or more paths in, one archive out. Directories
# are walked recursively; entry names are relative to each input's parent
# directory (so the tree lands as text/…). Defaults are already reproducible:
# canonical entry order, DOS-epoch timestamps, UTF-8 names, deflate level 6.
#
# Prerequisites:
#   - zipnative-cli on PATH (npm install -g zipnative-cli) or a local build
#     (npm run build) — the script falls back to dist/cli.cjs automatically
#
# Usage:
#   pwsh -File samples/create/01-basic.ps1
#
# Output: samples/output/create/01-basic.zip

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/create'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

# zipnative from PATH when installed, else the local build.
if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Zip = Join-Path $OutputDir '01-basic.zip'

Write-Host '→ Archiving samples/input/text and samples/input/unicode…'
zn create (Join-Path $InputDir 'text') (Join-Path $InputDir 'unicode') --output $Zip
Write-Host "  ✓ Written: $Zip"

Write-Host ''
Write-Host '→ Contents:'
zn list --input $Zip

Write-Host ''
Write-Host '→ Same build, entry names rebased with --base and --prefix (dry run):'
zn create (Join-Path $InputDir 'text') --base (Join-Path $InputDir 'text') --prefix docs/ --dry-run
