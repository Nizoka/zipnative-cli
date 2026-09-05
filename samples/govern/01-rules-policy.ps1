# govern/01-rules-policy.ps1 — the AI-governance / HITL contract
#
# `govern rules` prints the human/agent protocol (agents are DRAFTSMEN, never
# autonomous submitters: no runtime dependencies, no anti-goals, no weakened
# security default, a local reproduction for every bug, a human review before
# anything is submitted under a human identity). `govern policy` prints the
# same contract as machine-readable JSON — agents that scan repository
# configuration on start-up read this once and honour it.
#
# Usage:
#   pwsh -File samples/govern/01-rules-policy.ps1
#
# Output: samples/output/govern/policy.json

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$OutputDir = Join-Path $RootDir 'samples/output/govern'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

Write-Host '→ zipnative govern rules:'
zn govern rules

Write-Host ''
Write-Host '→ zipnative govern policy --pretty (saved to policy.json):'
$PolicyFile = Join-Path $OutputDir 'policy.json'
zn govern policy --pretty | Tee-Object -FilePath $PolicyFile

Write-Host ''
Write-Host '→ The three policy flags an agent must check before drafting anything:'
$Policy = (Get-Content -Raw $PolicyFile | ConvertFrom-Json).policy
foreach ($k in 'runtime_dependencies_allowed', 'autonomous_github_writes_allowed', 'human_in_the_loop_mandatory') {
    Write-Host ("  {0,-34}{1}" -f $k, $Policy.$k)
}
