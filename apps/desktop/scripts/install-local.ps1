param(
  [string]$SourceRoot = (Join-Path $PSScriptRoot "..\release-install17\win-unpacked")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path (Join-Path $SourceRoot "pi-ling.exe"))) {
  throw "Missing build at $SourceRoot. Run: pnpm run build && pnpm exec electron-builder --config electron-builder.yml --win dir --x64 --config.directories.output=release-install17"
}

Get-Process pi-ling -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$dest = Join-Path $env:LOCALAPPDATA "Programs\pi-ling"
robocopy $SourceRoot $dest /E /NFL /NDL /NJH /NJS /NP /XD "logs" | Out-Null
if ($LASTEXITCODE -ge 8) {
  throw "robocopy failed with exit code $LASTEXITCODE"
}

$exe = Join-Path $dest "pi-ling.exe"
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath("Desktop")
$lnk = $shell.CreateShortcut((Join-Path $desktop "pi-ling.lnk"))
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = $dest
$lnk.IconLocation = "$exe,0"
$lnk.Description = "pi-ling coding agent"
$lnk.Save()

Start-Process $exe
Write-Host "Installed to $dest and launched."
