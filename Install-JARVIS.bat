@echo off
title J.A.R.V.I.S. Desktop App Installer
echo Installing J.A.R.V.I.S. Desktop App shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = '%~dp0'.TrimEnd('\'); " ^
  "$desk = [Environment]::GetFolderPath('Desktop'); " ^
  "$start = \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\"; " ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$lnk = $ws.CreateShortcut(\"$desk\J.A.R.V.I.S.lnk\"); " ^
  "$lnk.TargetPath = \"$env:SystemRoot\System32\wscript.exe\"; " ^
  "$lnk.Arguments = \"`\"$root\app\LaunchJarvis.vbs`\"\"; " ^
  "$lnk.WorkingDirectory = \"$root\app\"; " ^
  "$lnk.IconLocation = \"$root\app\jarvis.ico,0\"; " ^
  "$lnk.Description = 'J.A.R.V.I.S. Desktop Application'; " ^
  "$lnk.Save(); " ^
  "Copy-Item \"$desk\J.A.R.V.I.S.lnk\" \"$start\J.A.R.V.I.S.lnk\" -Force"
echo.
echo J.A.R.V.I.S. shortcut installed on your Desktop and Start Menu!
pause
