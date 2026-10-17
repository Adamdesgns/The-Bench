# run-listener.ps1 - keeps Benny's listener running and pings Adam's phone every time it stops.
# Create benny\STOP to end the loop for good; benny\HALT only pauses answers (the listener keeps running so !resume works).
$here = $PSScriptRoot
Set-Location (Split-Path -Parent $here)
while ($true) {
  & node "$here\listener.mjs"
  $code = $LASTEXITCODE
  try {
    Invoke-RestMethod -Method Post -Uri "https://ntfy.sh/bench-adam-7x3" `
      -Headers @{ Title = "BENNY LISTENER STOPPED"; Priority = "urgent" } `
      -Body "Exit code $code at $(Get-Date -Format s). Restarting in 60 seconds unless benny\STOP exists." | Out-Null
  } catch { }
  if (Test-Path "$here\STOP") { break }
  Start-Sleep -Seconds 60
}
