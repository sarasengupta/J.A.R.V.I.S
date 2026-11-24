@echo off
title J.A.R.V.I.S. Desktop App Installer
echo Installing J.A.R.V.I.S. Desktop App shortcut...
powershell -NoProfile -Command ^
  "$root = '%~dp0'.TrimEnd('\'); " ^
  "$desk = [Environment]::GetFolderPath('Desktop'); " ^
  "$start = \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\"; " ^
  "$node = 'C:\Program Files\nodejs\node.exe'; " ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$lnk = $ws.CreateShortcut(\"$desk\J.A.R.V.I.S.lnk\"); " ^
  "$lnk.TargetPath = $node; " ^
  "$lnk.Arguments = \"`\"$root\app\start.js`\"\"; " ^
  "$lnk.WorkingDirectory = \"$root\app\"; " ^
  "$lnk.WindowStyle = 7; " ^
  "$lnk.IconLocation = \"$root\app\jarvis.ico,0\"; " ^
  "$lnk.Description = 'J.A.R.V.I.S. Desktop Application'; " ^
  "$lnk.Save(); " ^
  "Copy-Item \"$desk\J.A.R.V.I.S.lnk\" \"$start\J.A.R.V.I.S.lnk\" -Force"
echo.
echo J.A.R.V.I.S. shortcut installed on your Desktop and Start Menu!
pause
