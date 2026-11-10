# register-executor-watcher.ps1 - ADAM RUNS THIS, at his own terminal, after the
# checklist in docs/executor-test-protocol.md. No AI session registers this task.
# Checks once a minute, all day, so a night-before approval is picked up while
# the message is still readable. Runs only while he is logged on.
# Pause it:   Disable-ScheduledTask -TaskName "Bench Executor Watcher"
# Remove it:  Unregister-ScheduledTask -TaskName "Bench Executor Watcher" -Confirm:$false
# A HALT sent from the phone stops every approved ticket not yet placed.
# Node is found once, here, and its full path is stored in the task, so the
# task never searches the repo folder for a program called node.

$repo = "C:\Users\steam\Projects\apps\the-bench"
$script = Join-Path $repo "scripts\executor-watcher-hidden.vbs"
$node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
if ($node -like "$repo*") { throw "node resolves inside the repo ($node); refusing" }
Write-Host "Using node at $node"
New-Item -ItemType Directory -Force -Path (Join-Path $env:USERPROFILE ".bench-executor") | Out-Null
$wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
$action = New-ScheduledTaskAction -Execute $wscript -Argument "`"$script`" `"$node`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At "00:00"
$repeat = New-ScheduledTaskTrigger -Once -At "00:00" -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Hours 24)
$trigger.Repetition = $repeat.Repetition
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
Register-ScheduledTask -TaskName "Bench Executor Watcher" -Action $action -Trigger $trigger -Settings $settings -Description "THE BENCH: places real orders Adam pre-approved from his phone with a one-time code. Nothing runs without that approval." -Force | Out-Null
Get-ScheduledTask -TaskName "Bench Executor Watcher" | Select-Object TaskName, State
