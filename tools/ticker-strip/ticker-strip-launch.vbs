' Starts the Bench ticker strip with no console window. The Startup shortcut "Bench Ticker" runs this at login
' (made by install-ticker-strip.ps1). Double-click it to start the strip by hand; a second copy exits by itself.
Dim fso, here
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "\ticker-strip.ps1""", 0, False
