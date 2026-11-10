' executor-watcher-hidden.vbs - runs one executor watcher tick with no window,
' so a task that fires every minute does not flash a console on screen.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
log = shell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.bench-executor\watcher.log"
shell.Run "cmd /c node executor\executor.mjs watch --once --live >> """ & log & """ 2>&1", 0, True
