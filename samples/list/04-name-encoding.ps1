# list/04-name-encoding.ps1 — decode legacy (non-UTF-8) entry names
#
# A name stored WITHOUT the UTF-8 flag (bit 11) is, by the APPNOTE, CP437 —
# but many legacy producers wrote the local code page instead. The committed
# samples/input/legacy/shift-jis-names.zip holds one entry whose name
# 日本語/挨拶.txt was written in Shift_JIS by .NET's System.IO.Compression
# (a foreign producer, see samples/README.md). The default CP437 decoding
# shows mojibake; `--name-encoding shift_jis` (zipnative 1.1 nameDecoder, any
# WHATWG label the runtime knows) decodes it. The row then reports
# nameEncoding "custom" and `--long` keeps the stored bytes in rawNameHex.
# `extract` / `stream` decode BEFORE the name is sanitised, so a decoded name
# passes the same guards.
#
# Usage:
#   pwsh -File samples/list/04-name-encoding.ps1
#
# Output: samples/output/list/04-name-encoding.json

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/list'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Zip = Join-Path $InputDir 'legacy/shift-jis-names.zip'

Write-Host '→ Default decoding (CP437) — the Shift_JIS bytes read as mojibake:'
zn list --input $Zip

Write-Host ''
Write-Host '→ --name-encoding shift_jis:'
zn list --input $Zip --name-encoding shift_jis

Write-Host ''
Write-Host '→ JSON: the decoded name, nameEncoding "custom" and the stored bytes:'
zn list --input $Zip --name-encoding shift_jis --long --format json `
    --fields entries.name,entries.nameEncoding,entries.rawNameHex | Tee-Object -FilePath (Join-Path $OutputDir '04-name-encoding.json')
