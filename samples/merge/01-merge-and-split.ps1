# merge/01-merge-and-split.ps1 — merge archives, split one, without recompression
#
# `merge` copies each entry's COMPRESSED bytes into a new archive (zipnative
# 1.1 addFromReader) — no recompression — after verifying it (CRC-32 and size,
# one decompress pass, no opt-out): a lying source is refused, never
# laundered. A name present in two sources is refused unless
# --on-duplicate first|last picks one. "Split" is a filtered merge of one
# archive (--include / --exclude).
#
# Usage:
#   pwsh -File samples/merge/01-merge-and-split.ps1
#
# Output: samples/output/merge/text.zip, unicode.zip, all.zip, md-only.zip

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/merge'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Text    = Join-Path $OutputDir 'text.zip'
$Unicode = Join-Path $OutputDir 'unicode.zip'
$All     = Join-Path $OutputDir 'all.zip'
$Md      = Join-Path $OutputDir 'md-only.zip'
zn create (Join-Path $InputDir 'text') --output $Text --overwrite --quiet
zn create (Join-Path $InputDir 'unicode') --output $Unicode --overwrite --quiet

Write-Host '→ Merge two archives (every entry verified, nothing recompressed):'
zn merge $Text $Unicode -o $All --overwrite --json
zn list --input $All

Write-Host ''
Write-Host '→ Split — keep only the Markdown files of the merged archive:'
zn merge $All --include '**/*.md' -o $Md --overwrite --json
zn list --input $Md

# The next call is EXPECTED to fail: keep a non-zero native exit code from
# becoming a terminating error and read $LASTEXITCODE instead.
$PSNativeCommandUseErrorActionPreference = $false

Write-Host ''
Write-Host '→ The same archive twice is a duplicate-name refusal (exit 1, E_INPUT) — expected:'
zn merge $Text $Text -o (Join-Path $OutputDir 'dup.zip') --json
Write-Host "  exit $LASTEXITCODE"
