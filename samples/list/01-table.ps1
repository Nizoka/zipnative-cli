# list/01-table.ps1 — human-readable listing (text table), --long, --validate eager
#
# `list` reads only the central directory — nothing is decompressed. --long
# adds POSIX mode and the general-purpose flags (U = UTF-8 names, D = data
# descriptor); --validate eager cross-checks every local header up front.
# NOTE: --long has no short form; booleans never swallow the next token, so
# `list --long a.zip` and `list a.zip --long` are equivalent.
#
# Usage:
#   pwsh -File samples/list/01-table.ps1
#
# Output: samples/output/list/archive.zip, 01-table.txt

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/list'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Zip = Join-Path $OutputDir 'archive.zip'
if (-not (Test-Path $Zip)) {
    Write-Host '→ Building the sample archive…'
    zn create (Join-Path $InputDir 'text') (Join-Path $InputDir 'unicode') --output $Zip --quiet
}

Write-Host '→ zipnative list --input archive.zip:'
zn list --input $Zip

Write-Host ''
Write-Host '→ --long --validate eager (saved to 01-table.txt):'
zn list --input $Zip --long --validate eager | Tee-Object -FilePath (Join-Path $OutputDir '01-table.txt')

Write-Host ''
Write-Host "→ Filter by glob (--include '**/*.txt'):"
zn list --input $Zip --include '**/*.txt'
