# config/01-config.ps1 — .zipnativerc.json default flags (--config / --no-config)
#
# A config file supplies DEFAULT flag values; an explicit CLI flag always
# wins. Top-level keys apply to every command, a key named after a command
# scopes its object to that command. Discovery walks up from the current
# directory; --config <file> names one explicitly and --no-config ignores
# them all. `codec` is refused from config files (it executes user code).
#
# samples/input/config/.zipnativerc.json:
#   { "create": { "deterministic": true, "level": 9 }, "extract": { "overwrite": true } }
#
# Usage:
#   pwsh -File samples/config/01-config.ps1
#
# Output: samples/output/config/01-with-config.zip, 01-no-config.zip

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/config'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Config = Join-Path $InputDir 'config/.zipnativerc.json'
$Text   = Join-Path $InputDir 'text'

Write-Host '→ Config file:'
Get-Content $Config

Write-Host ''
Write-Host '→ create --config … (deterministic + level 9 come from the file):'
zn create $Text --config $Config --output (Join-Path $OutputDir '01-with-config.zip') --json

Write-Host ''
Write-Host '→ Same build with --no-config (built-in defaults: level 6, node-zlib tier):'
zn create $Text --no-config --output (Join-Path $OutputDir '01-no-config.zip') --json

Write-Host ''
Write-Host "→ Discovery: run from the config's directory and it is picked up automatically:"
Push-Location (Join-Path $InputDir 'config')
try {
    zn create $Text --output (Join-Path $OutputDir '01-discovered.zip') --json
} finally {
    Pop-Location
}

Write-Host ''
Write-Host "→ CLI flags win: --level 1 overrides the file's level 9:"
zn create $Text --config $Config --level 1 --output (Join-Path $OutputDir '01-override.zip') --json

Write-Host ''
Write-Host '→ The extract section makes --overwrite the default for this config:'
$Extracted = Join-Path $OutputDir '01-extracted'
zn extract --input (Join-Path $OutputDir '01-with-config.zip') --output-dir $Extracted --config $Config --quiet
zn extract --input (Join-Path $OutputDir '01-with-config.zip') --output-dir $Extracted --config $Config --json
