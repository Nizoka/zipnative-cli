# completion/01-generate.ps1 — shell completion scripts (bash|zsh|fish|powershell)
#
# The scripts are self-contained and generated from the CLI's own command /
# flag table, so they are always in sync with `--help`. Install by sourcing
# the output:
#   zipnative completion bash > /etc/bash_completion.d/zipnative
#   zipnative completion zsh  > "${fpath[1]}/_zipnative"
#   zipnative completion fish > ~/.config/fish/completions/zipnative.fish
#   zipnative completion powershell >> $PROFILE
#
# Usage:
#   pwsh -File samples/completion/01-generate.ps1
#
# Output: samples/output/completion/zipnative.{bash,zsh,fish,ps1}

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$OutputDir = Join-Path $RootDir 'samples/output/completion'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

foreach ($shell in 'bash', 'zsh', 'fish', 'powershell') {
    $ext  = if ($shell -eq 'powershell') { 'ps1' } else { $shell }
    $file = Join-Path $OutputDir "zipnative.$ext"
    zn completion $shell | Set-Content -Path $file -Encoding utf8
    Write-Host ("  {0,-10} → zipnative.{1} ({2} lines)" -f $shell, $ext, (Get-Content $file).Count)
}

Write-Host ''
Write-Host '→ Head of the PowerShell completer:'
Get-Content (Join-Path $OutputDir 'zipnative.ps1') -TotalCount 6

Write-Host ''
Write-Host "→ Try it in this session: dot-source it, then type 'zipnative cr<TAB>':"
Write-Host "  . $(Join-Path $OutputDir 'zipnative.ps1')"

# Expected failure — read $LASTEXITCODE instead of terminating.
$PSNativeCommandUseErrorActionPreference = $false
Write-Host ''
Write-Host '→ Missing shell argument is a usage error (exit 2):'
zn completion
Write-Host "  exit $LASTEXITCODE"
