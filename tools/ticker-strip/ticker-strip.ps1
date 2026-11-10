<#
.SYNOPSIS
  Starts the Bench ticker strip: a thin scrolling ticker docked above the Windows taskbar.

.DESCRIPTION
  Compiles TickerStrip.cs (next to this file) and shows it. The strip runs scripts\ticker-feed.mjs
  itself, hidden, every minute in market hours, and also hands the same quotes to the Grok Bot
  wallpaper (Bot Status\wallpaper-3d\tickers.json) when that folder exists.
  Only one strip runs at a time; a second launch exits quietly.
  Started at login by "Bench Ticker.vbs" in the Startup folder (install-ticker-strip.ps1).

  Read only. It never places an order and never reads an account.
#>
param(
  # Where the wallpaper's copy of the feed goes. Pass '' to skip it.
  [string]$Wallpaper = (Join-Path $env:USERPROFILE 'OneDrive\Documents\Bot Status\wallpaper-3d\tickers.json'),
  # The wallpaper's six-desk floor feed (Van's pod system, read only). Pass '' to skip it.
  [string]$PodDesks = (Join-Path $env:USERPROFILE 'OneDrive\Documents\Bot Status\pod-desks.mjs')
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $here '..\..')).Path

$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\BenchTickerStrip', [ref]$created)
if (-not $created) { exit 0 }

$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }

if ($Wallpaper -and -not (Test-Path (Split-Path -Parent $Wallpaper))) { $Wallpaper = '' }
if ($PodDesks -and -not (Test-Path $PodDesks)) { $PodDesks = '' }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing, System.Web.Extensions
Add-Type -Path (Join-Path $here 'TickerStrip.cs') -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Web.Extensions

[void][TickerStrip]::SetProcessDPIAware()
[System.Windows.Forms.Application]::EnableVisualStyles()
try {
  [System.Windows.Forms.Application]::Run((New-Object TickerStrip($root, $node, $Wallpaper, $PodDesks)))
} finally {
  $mutex.ReleaseMutex()
}
