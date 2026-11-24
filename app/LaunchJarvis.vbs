' Silent launcher for J.A.R.V.I.S. Desktop App (zero CMD/PowerShell window flash)
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = appDir & "\JarvisApp.ps1"
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & ps1 & """", 0, False
