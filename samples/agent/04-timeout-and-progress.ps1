# agent/04-timeout-and-progress.ps1 — a deadline (--timeout) and progress events (--progress)
#
# `--timeout <duration>` (500, 500ms, 30s, 5m, 1h) arms one deadline for the
# whole run, starting with the process. Past it the run stops at the next
# chunk or entry boundary with E_LIMIT — detail { limit: "timeout",
# configured, observed } in milliseconds — and the file being written is
# removed. It is a bound like the --max-* flags, so it needs no new error
# class. A 1 ms deadline below is always already past when the writer starts:
# the failure is deterministic.
#
# `--progress` (or ZIPNATIVE_PROGRESS=1) prints the engine's progress
# snapshots on stderr where the engine measures them (create --stream /
# --stdin-name / --parallel, extract without --buffered, stream, cat): a
# throttled text line, or under --json one NDJSON {"type":"progress",...}
# object per update before the final envelope. stdout is never touched.
#
# Usage:
#   pwsh -File samples/agent/04-timeout-and-progress.ps1
#
# Output: samples/output/agent/04-progress.zip, 04-progress.ndjson

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/agent'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$TimedOut = Join-Path $OutputDir '04-timed-out.zip'
$Progress = Join-Path $OutputDir '04-progress.zip'
$Events   = Join-Path $OutputDir '04-progress.ndjson'

# The first call is EXPECTED to fail: keep a non-zero native exit code from
# becoming a terminating error and read $LASTEXITCODE instead.
$PSNativeCommandUseErrorActionPreference = $false

Write-Host '→ --timeout 1ms: E_LIMIT (detail.limit "timeout"), and no partial file is left:'
zn create $InputDir --stream --timeout 1ms --output $TimedOut --json
Write-Host "  exit $LASTEXITCODE"
if (Test-Path $TimedOut) { Write-Host '  unexpected: output left behind' } else { Write-Host '  ✓ 04-timed-out.zip does not exist' }

$PSNativeCommandUseErrorActionPreference = $true

Write-Host ''
Write-Host '→ --progress in text mode (stderr):'
zn create $InputDir --stream --progress --output $Progress --overwrite

Write-Host ''
Write-Host '→ --quiet silences it (nothing printed):'
zn create $InputDir --stream --progress --quiet --output $Progress --overwrite

Write-Host ''
Write-Host '→ --progress under --json: NDJSON events, then the status envelope (all on stderr):'
& $ZnExe @ZnPre create $InputDir --stream --progress --json --output $Progress --overwrite 2> $Events
Get-Content $Events
