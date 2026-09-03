# agent/03-token-economy.ps1 — smaller reports: --summary, --fields, compact JSON
#
# Full reports are verbose by design. For an LLM loop every byte is a token:
# --summary collapses a report to its headline numbers, --fields keeps only
# the named dot-paths (array elements are projected), and --json makes the
# output compact (single line) unless --pretty is added. The script prints
# the byte count of each variant side by side.
# NOTE: --summary and --fields do not combine — when both are passed the
# summary shape wins and --fields is ignored. Project the FULL report instead.
#
# Usage:
#   pwsh -File samples/agent/03-token-economy.ps1
#
# Output: samples/output/agent/03-*.json

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/agent'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }

$Zip = Join-Path $OutputDir '03-archive.zip'
zn create $InputDir --deterministic --output $Zip --quiet

function Save-Report([string]$Name, [string[]]$CliArgs) {
    $file = Join-Path $OutputDir $Name
    zn @CliArgs | Set-Content -Path $file -Encoding utf8 -NoNewline
    return $file
}
$Variants = @(
    @{ Label = 'inspect --format json --entries (pretty)'; File = (Save-Report '03-full-pretty.json'  @('inspect', '--input', $Zip, '--format', 'json', '--entries')) },
    @{ Label = 'inspect --json --entries (compact)';       File = (Save-Report '03-full-compact.json' @('inspect', '--input', $Zip, '--json', '--entries')) },
    @{ Label = 'inspect --json';                           File = (Save-Report '03-no-entries.json'   @('inspect', '--input', $Zip, '--json')) },
    @{ Label = 'inspect --json --summary';                 File = (Save-Report '03-summary.json'      @('inspect', '--input', $Zip, '--json', '--summary')) },
    @{ Label = 'inspect --json --fields a.b,c.d';          File = (Save-Report '03-fields.json'       @('inspect', '--input', $Zip, '--json', '--fields', 'archive.bytes,determinism.deterministic')) },
    @{ Label = 'list --json --fields entries.name';        File = (Save-Report '03-list-names.json'   @('list', '--input', $Zip, '--json', '--fields', 'entries.name')) }
)

Write-Host '→ Same archive, six report sizes:'
foreach ($v in $Variants) { Write-Host ("  {0,-42} {1,6} bytes" -f $v.Label, (Get-Item $v.File).Length) }

Write-Host ''
Write-Host '→ The smallest one:'
Get-Content (Join-Path $OutputDir '03-fields.json')

Write-Host ''
Write-Host '→ --pretty re-indents any compact report when a human is reading:'
zn inspect --input $Zip --json --summary --pretty
