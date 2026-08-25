param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$Title = "",
  [string]$Artist = "",
  [string]$AppName = ""
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class MediaNative {
  [DllImport("user32.dll")]
  static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

  public static void Tap(byte virtualKey) {
    keybd_event(virtualKey, 0, 0, UIntPtr.Zero);
    keybd_event(virtualKey, 0, 2, UIntPtr.Zero);
  }
}
"@

function Write-Result($ok, $method) {
  $result = [ordered]@{ ok = [bool]$ok; method = [string]$method }
  $json = $result | ConvertTo-Json -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json + "`n")
  [Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)
}

function Await-WinRT($operation, [type]$resultType) {
  if ($null -eq $operation -or $null -eq $resultType) { return $null }
  try { Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop } catch { return $null }
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 } |
    Where-Object { $_.GetParameters()[0].ParameterType.Name -like "IAsyncOperation*" } |
    Select-Object -First 1
  if (-not $asTask) { return $null }
  try {
    $generic = $asTask.MakeGenericMethod($resultType)
    $task = $generic.Invoke($null, @($operation))
    if (-not $task.Wait(2500)) { return $null }
    return $task.Result
  } catch {
    return $null
  }
}

function Get-SmtcSessions {
  try {
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
    $manager = Await-WinRT ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    if (-not $manager) { return @() }
    $sessions = $manager.GetSessions()
    $list = @()
    $count = 0
    try { $count = [int]$sessions.Size } catch { $count = 0 }
    if ($count -gt 0) {
      for ($index = 0; $index -lt $count; $index++) {
        try { $list += $sessions.GetAt($index) } catch { }
      }
    } else {
      foreach ($session in $sessions) { $list += $session }
    }
    return $list
  } catch {
    return @()
  }
}

function Get-SmtcSession {
  $best = $null
  $bestScore = -1
  $propertyType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
  foreach ($session in (Get-SmtcSessions)) {
    try {
      $score = 0
      $source = [string]$session.SourceAppUserModelId
      if ($AppName -and ($source -like "*$AppName*" -or $AppName -like "*$source*")) { $score += 30 }
      if ($AppName -match "网易云|cloudmusic|netease" -and $source -match "cloudmusic|netease") { $score += 40 }
      $properties = Await-WinRT ($session.TryGetMediaPropertiesAsync()) $propertyType
      if ($properties) {
        if ($Title -and [string]$properties.Title -eq $Title) { $score += 100 }
        if ($Artist -and [string]$properties.Artist -eq $Artist) { $score += 40 }
      }
      $status = [string]$session.GetPlaybackInfo().PlaybackStatus
      if ($status -eq "Playing") { $score += 10 }
      if ($score -gt $bestScore) {
        $best = $session
        $bestScore = $score
      }
    } catch { }
  }
  return $best
}

$action = $Action.ToLowerInvariant()
switch ($action) {
  "playpause" {
    [MediaNative]::Tap(0xB3)
    Write-Result $true "media-key"
  }
  "next" {
    [MediaNative]::Tap(0xB0)
    Write-Result $true "media-key"
  }
  "prev" {
    [MediaNative]::Tap(0xB1)
    Write-Result $true "media-key"
  }
  "play" {
    $session = Get-SmtcSession
    $ok = if ($session) { [bool](Await-WinRT ($session.TryPlayAsync()) ([bool])) } else { $false }
    if (-not $ok) { [MediaNative]::Tap(0xB3); $ok = $true }
    Write-Result $ok $(if ($session) { "smtc" } else { "media-key" })
  }
  "pause" {
    $session = Get-SmtcSession
    $ok = if ($session) { [bool](Await-WinRT ($session.TryPauseAsync()) ([bool])) } else { $false }
    if (-not $ok) { [MediaNative]::Tap(0xB3); $ok = $true }
    Write-Result $ok $(if ($session) { "smtc" } else { "media-key" })
  }
  default {
    Write-Result $false "unsupported"
    exit 1
  }
}
