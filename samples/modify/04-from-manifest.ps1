# modify/04-from-manifest.ps1 — declarative edits with --from-manifest
#
# A modify manifest lists { op, name, to?, path|data|dataBase64?, method?,
# level?, comment?, date? } edits plus an optional archive comment; `path`
# resolves against the MANIFEST's directory (no `..` escapes). It is mutually
# exclusive with the --add/--replace/… flags. See
# samples/input/manifest/edits.json and `zipnative schema modify-manifest`.
#
# Usage:
#   pwsh -File samples/modify/04-from-manifest.ps1
#
# Output: samples/output/modify/04-from-manifest.zip

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/modify'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Base     = Join-Path $OutputDir 'base.zip'
$Out      = Join-Path $OutputDir '04-from-manifest.zip'
$Manifest = Join-Path $InputDir 'manifest/edits.json'
if (-not (Test-Path $Base)) {
    zn create (Join-Path $InputDir 'text') --output $Base --quiet
}

Write-Host '→ Manifest:'
Get-Content $Manifest

Write-Host ''
Write-Host '→ Applying it (--compact):'
zn modify --input $Base --output $Out --from-manifest $Manifest --compact --json

Write-Host ''
Write-Host '→ Result:'
zn list --input $Out --long
zn inspect --input $Out --format json --fields archive.comment
