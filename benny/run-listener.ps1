# run-listener.ps1 - keeps Benny's listener running and pings Adam's phone every time it stops.
# Create benny\STOP to end the loop for good; benny\HALT only pauses answers (the listener keeps running so !resume works).
$here = $PSScriptRoot
Set-Location (Split-Path -Parent $here)
# Log every start and stop (2026-10-18: the listener died silently after a reboot and nothing recorded why).
$log = "$here\listener.log"
function Note($m) { "$(Get-Date -Format s) $m" | Out-File -FilePath $log -Append -Encoding utf8 }
Note "launcher start (pid $PID)"
while ($true) {
  try { & node "$here\listener.mjs" 2>&1 | ForEach-Object { "$_" } | Out-File -FilePath $log -Append -Encoding utf8; $code = $LASTEXITCODE } catch { $code = "error: $($_.Exception.Message)" }
  Note "listener exited: $code"
  try {
    Invoke-RestMethod -Method Post -Uri "https://ntfy.sh/bench-adam-7x3" `
      -Headers @{ Title = "BENNY LISTENER STOPPED"; Priority = "urgent" } `
      -Body "Exit code $code at $(Get-Date -Format s). Restarting in 60 seconds unless benny\STOP exists." | Out-Null
  } catch { }
  if (Test-Path "$here\STOP") { break }
  Start-Sleep -Seconds 60
}
