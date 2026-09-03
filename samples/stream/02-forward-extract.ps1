# stream/02-forward-extract.ps1 — extract from a pipe (stream --output-dir)
#
# The same containment guards as `extract` apply (sanitizeEntryPath + root
# check, --skip-unsafe, --overwrite, --on-duplicate, --flat), but with no
# central directory --preserve-mode / --allow-symlinks / --skip-symlinks are
# unavailable and --skip-unsupported is the escape hatch for encrypted or
# unknown-method entries. The script compares the streamed files with a
# regular `extract` of the same archive — they are byte-identical.
#
# Usage:
#   pwsh -File samples/stream/02-forward-extract.ps1
#
# Output: samples/output/stream/02-extract/, 02-forward-extract/

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent (Split-Path -Parent $ScriptDir)
$InputDir  = Join-Path $RootDir 'samples/input'
$OutputDir = Join-Path $RootDir 'samples/output/stream'
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Get-Command zipnative -ErrorAction SilentlyContinue) { $ZnExe = 'zipnative'; $ZnPre = @() }
else { $ZnExe = 'node'; $ZnPre = @((Join-Path $RootDir 'dist/cli.cjs')) }
function zn { & $ZnExe @ZnPre @args }
$CatJs = 'require("fs").createReadStream(process.argv[1]).pipe(process.stdout)'

$Zip = Join-Path $OutputDir 'archive.zip'
$Ref = Join-Path $OutputDir '02-extract'
$Fwd = Join-Path $OutputDir '02-forward-extract'
if (-not (Test-Path $Zip)) {
    zn create (Join-Path $InputDir 'text') --output $Zip --quiet
}
foreach ($d in $Ref, $Fwd) { if (Test-Path $d) { Remove-Item -Recurse -Force $d } }

Write-Host '→ Reference: extract from the file on disk:'
zn extract --input $Zip --output-dir $Ref --quiet

Write-Host '→ Forward: <archive bytes> | zipnative stream --output-dir …:'
& node -e $CatJs $Zip | & $ZnExe @ZnPre stream --output-dir $Fwd --json

Write-Host ''
foreach ($f in 'text/readme.txt', 'text/notes.md', 'text/with-dash_and.dots.txt') {
    $a = (Get-FileHash -Algorithm SHA256 (Join-Path $Ref $f)).Hash
    $b = (Get-FileHash -Algorithm SHA256 (Join-Path $Fwd $f)).Hash
    if ($a -eq $b) { Write-Host "  ✓ $f identical" } else { Write-Error "  ✗ $f differs" }
}

Write-Host ''
Write-Host '→ --dry-run plans the extraction without touching the disk:'
& node -e $CatJs $Zip | & $ZnExe @ZnPre stream --output-dir (Join-Path $OutputDir '02-never-created') --include '**/*.md' --dry-run --json
