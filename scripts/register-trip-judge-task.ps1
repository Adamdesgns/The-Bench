# register-trip-judge-task.ps1 - the Windows task that runs scripts/trip-judge.mjs.
# Weekdays, every 5 minutes from 08:30 to 15:05 Central (this PC's clock). Runs as Adam, only while
# he is logged on (the headless Claude run needs his sign-in). The script itself also refuses to
# work outside the window, so a mis-set clock costs nothing.
# Remove it with: Unregister-ScheduledTask -TaskName "Bench Trip Judge" -Confirm:$false

$repo = "C:\Users\steam\Projects\apps\the-bench"
$node = (Get-Command node).Source
$action = New-ScheduledTaskAction -Execute $node -Argument "scripts\trip-judge.mjs" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At "08:30"
$repeat = New-ScheduledTaskTrigger -Once -At "08:30" -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Hours 6 -Minutes 35)
$trigger.Repetition = $repeat.Repetition
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
Register-ScheduledTask -TaskName "Bench Trip Judge" -Action $action -Trigger $trigger -Settings $settings -Description "THE BENCH: judge a freshly crossed buy-side level on live Robinhood data and text Adam BUY/WAIT/NO (scripts/trip-judge.mjs). Never places orders." -Force | Out-Null
Get-ScheduledTask -TaskName "Bench Trip Judge" | Select-Object TaskName, State
