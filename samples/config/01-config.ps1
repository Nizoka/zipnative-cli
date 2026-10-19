# config/01-config.ps1 — .zipnativerc.json: presentation defaults only
#
# A config file supplies DEFAULT values for PRESENTATION flags only — format,
# fields, json, pretty, quiet, no-color, progress, strict, long, summary — and
# an explicit CLI flag always wins. Top-level keys apply to every command, a
# key named after a command scopes its object to that command, and a key
# applies only where the command declares the flag. Any other key (an input,
# an output, an opt-out such as overwrite / skip-unsafe, a --max-* bound,
# codec) is refused with E_USAGE naming the file: a .zipnativerc.json planted
# in a cloned repository can never relax a guard. Discovery walks up from the
# current directory; --config <file> names one and --no-config ignores them.
#
# samples/input/config/.zipnativerc.json:
#   { "pretty": true, "list": { "format": "json", "long": true },
#     "inspect": { "format": "json", "summary": true } }
# samples/input/config-unsafe/.zipnativerc.json (refused):
#   { "extract": { "overwrite": true, "skip-unsafe": true } }
#
# Usage:
#   pwsh -File samples/config/01-config.ps1
#
# Output: samples/output/config/01-archive.zip, 01-list.json

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/config'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Config  = Join-Path $InputDir 'config/.zipnativerc.json'
$Unsafe  = Join-Path $InputDir 'config-unsafe/.zipnativerc.json'
$Archive = Join-Path $OutputDir '01-archive.zip'

Write-Host '→ Build an archive hermetically (--no-config):'
zn create (Join-Path $InputDir 'text') --no-config --deterministic --output $Archive --overwrite --quiet

Write-Host ''
Write-Host '→ Config file:'
Get-Content $Config

Write-Host ''
Write-Host '→ list --config … (format json + long come from the file; an info: line names it):'
zn list $Archive --config $Config | Set-Content -Encoding utf8 (Join-Path $OutputDir '01-list.json')
(Get-Content -Raw (Join-Path $OutputDir '01-list.json')).Substring(0, 300) + ' …'

Write-Host ''
Write-Host "→ CLI flags win: --format text overrides the file's json:"
zn list $Archive --config $Config --format text

Write-Host ''
Write-Host "→ Discovery: run from the config's directory and it is picked up (inspect → a JSON --summary):"
Push-Location (Join-Path $InputDir 'config')
try {
    zn inspect $Archive
} finally {
    Pop-Location
}

Write-Host ''
Write-Host '→ A planted config that tries to relax a guard is REFUSED (exit 2, E_USAGE, file named):'
zn extract --input $Archive --output-dir (Join-Path $OutputDir '01-extracted') --config $Unsafe --json
Write-Host "exit code: $LASTEXITCODE (expected 2)"

Write-Host ''
Write-Host '→ --no-config is the escape hatch (and the posture for unattended runs):'
zn extract --input $Archive --output-dir (Join-Path $OutputDir '01-extracted') --no-config --overwrite --json
