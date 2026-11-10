' executor-watcher-hidden.vbs - runs one executor watcher tick with no window,
' so a task that fires every minute does not flash a console on screen.
' The task passes node's full path as the first argument (resolved once, at
' registration, by register-executor-watcher.ps1). Node and cmd are both called
' by full path, so a node.cmd or cmd.exe dropped in the repo folder is never run.
If WScript.Arguments.Count < 1 Then WScript.Quit 2
nodeExe = WScript.Arguments(0)
Set fso = CreateObject("Scripting.FileSystemObject")
If Not fso.FileExists(nodeExe) Then WScript.Quit 2
Set shell = CreateObject("WScript.Shell")
shell.Environment("PROCESS")("NoDefaultCurrentDirectoryInExePath") = "1"
shell.CurrentDirectory = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
cmdExe = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\cmd.exe"
log = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.bench-executor\watcher.log"
shell.Run """" & cmdExe & """ /c """"" & nodeExe & """ executor\executor.mjs watch --once --live >> """ & log & """ 2>&1""", 0, True
