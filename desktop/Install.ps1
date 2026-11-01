# Installs Distil for the current user (no administrator rights needed): copies it to
# %LOCALAPPDATA%\Programs\Distil, adds Start menu and desktop shortcuts and an entry in
# Settings > Apps. Right-click this file and choose "Run with PowerShell".
# -NoSystemEntries skips the shortcuts and the Apps entry (for a portable copy).
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\Distil"),
  [switch]$NoSystemEntries
)
$ErrorActionPreference = "Stop"
$source = $PSScriptRoot
$version = (Get-Content (Join-Path $source "current.txt") -Raw).Trim()

if (Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $InstallDir "runtime\node.exe") }) {
  Write-Host "Distil is running. Close its window, then run the installer again."
  exit 1
}

Write-Host "Installing Distil ($version) to $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
# The data folder (%USERPROFILE%\Distil) is never touched; earlier app versions are replaced.
Get-ChildItem $InstallDir -Directory -Filter "app-*" -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne $version } | Remove-Item -Recurse -Force
Remove-Item (Join-Path $InstallDir "next.txt") -Force -ErrorAction SilentlyContinue
# Folders go through robocopy, which copies paths longer than 260 characters (deep node_modules).
foreach ($dir in @("runtime", $version)) {
  robocopy (Join-Path $source $dir) (Join-Path $InstallDir $dir) /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying $dir failed (robocopy exit $LASTEXITCODE)." }
}
foreach ($item in @("launcher.mjs", "current.txt", "distil.ico", "Uninstall.ps1", "CREDITS.md", "LICENSE", "update-feed.txt")) {
  $from = Join-Path $source $item
  if (Test-Path $from) { Copy-Item $from -Destination $InstallDir -Force }
}

if (-not $NoSystemEntries) {
  $node = Join-Path $InstallDir "runtime\node.exe"
  $launcher = Join-Path $InstallDir "launcher.mjs"
  $icon = Join-Path $InstallDir "distil.ico"
  $shell = New-Object -ComObject WScript.Shell
  foreach ($dir in @([Environment]::GetFolderPath("Programs"), [Environment]::GetFolderPath("Desktop"))) {
    $link = $shell.CreateShortcut((Join-Path $dir "Distil.lnk"))
    $link.TargetPath = $node
    $link.Arguments = "`"$launcher`""
    $link.WorkingDirectory = $InstallDir
    $link.IconLocation = $icon
    $link.WindowStyle = 7  # minimised: the launcher hides itself at once
    $link.Description = "Distil - learn anything from your own material"
    $link.Save()
  }
  $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Distil"
  New-Item -Path $key -Force | Out-Null
  $entries = @{
    DisplayName = "Distil"; DisplayVersion = $version -replace "^app-", ""; Publisher = "Distil contributors"
    DisplayIcon = $icon; InstallLocation = $InstallDir; NoModify = 1; NoRepair = 1
    UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'Uninstall.ps1')`""
  }
  foreach ($name in $entries.Keys) { Set-ItemProperty -Path $key -Name $name -Value $entries[$name] }
}

Write-Host "Done. Open Distil from the Start menu or the desktop."
