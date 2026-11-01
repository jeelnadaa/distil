# Removes Distil's program files, shortcuts and Apps entry. Your data folder (%USERPROFILE%\Distil:
# library, chats, materials, keys) stays; delete it yourself if you want it gone.
$ErrorActionPreference = "Stop"
$installDir = $PSScriptRoot

if (Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $installDir "runtime\node.exe") }) {
  Write-Host "Distil is running. Close its window, then uninstall again."
  exit 1
}
foreach ($dir in @([Environment]::GetFolderPath("Programs"), [Environment]::GetFolderPath("Desktop"))) {
  Remove-Item (Join-Path $dir "Distil.lnk") -Force -ErrorAction SilentlyContinue
}
Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Distil" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $env:LOCALAPPDATA "Distil") -Recurse -Force -ErrorAction SilentlyContinue  # window profile and log
# A script can't delete the folder it runs from while it runs, so a hidden shell finishes the job.
Start-Process cmd.exe -ArgumentList "/c timeout /t 2 >nul & rmdir /s /q `"$installDir`"" -WindowStyle Hidden
Write-Host "Distil is uninstalled. Your data is still in $(Join-Path $env:USERPROFILE 'Distil')."
