# run-listener.ps1 - keeps Benny's listener running and logs every stop to listener.log (no phone ping since 2026-11-04).
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
  # Phone ping removed 2026-11-04 (Adam: "nothing comes to my phone except our plans and plays"). The stop is in listener.log.
  if (Test-Path "$here\STOP") { break }
  Start-Sleep -Seconds 60
}
