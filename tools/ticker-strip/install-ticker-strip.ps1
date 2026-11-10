<#
.SYNOPSIS
  Makes the Bench ticker strip start when you log in (or stops that with -Remove).

.DESCRIPTION
  Adds one shortcut, "Bench Ticker", to your own Startup folder. It runs ticker-strip-launch.vbs next to this file,
  which starts the strip with no console window. Nothing else is changed: no scheduled task, no registry key,
  no admin rights. -Remove deletes that one shortcut. To stop a running strip, right-click it and pick "Quit ticker".
#>
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$link = Join-Path ([Environment]::GetFolderPath('Startup')) 'Bench Ticker.lnk'

if ($Remove) {
  if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link; "removed $link" } else { "nothing to remove" }
  exit 0
}

$s = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
$s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$s.Arguments = '"' + (Join-Path $here 'ticker-strip-launch.vbs') + '"'
$s.WorkingDirectory = $here
$s.Description = 'Bench ticker strip above the taskbar'
$s.Save()
"created $link"
