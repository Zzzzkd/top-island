$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding


Add-Type @"
using System;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;

public static class NeteasePlaybackMemory {
  const uint PROCESS_VM_READ = 0x0010;
  const uint PROCESS_QUERY_INFORMATION = 0x0400;
  static readonly int[] Pattern = { 0x66, 0x0F, 0x2E, 0x0D, -1, -1, -1, -1, 0x7A, -1, 0x75, -1, 0x66, 0x0F, 0x2E, 0x15 };
  static int cachedPid;
  static IntPtr processHandle = IntPtr.Zero;
  static long positionAddress;

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, int size, out IntPtr bytesRead);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr handle);

  static void Reset() {
    if (processHandle != IntPtr.Zero) CloseHandle(processHandle);
    cachedPid = 0;
    processHandle = IntPtr.Zero;
    positionAddress = 0;
  }

  static bool Resolve(int pid) {
    if (cachedPid == pid && processHandle != IntPtr.Zero && positionAddress != 0) return true;
    Reset();
    try {
      Process process = Process.GetProcessById(pid);
      ProcessModule module = process.Modules.Cast<ProcessModule>().FirstOrDefault(
        value => string.Equals(value.ModuleName, "cloudmusic.dll", StringComparison.OrdinalIgnoreCase));
      if (module == null) return false;
      IntPtr handle = OpenProcess(PROCESS_VM_READ | PROCESS_QUERY_INFORMATION, false, pid);
      if (handle == IntPtr.Zero) return false;
      byte[] bytes = new byte[module.ModuleMemorySize];
      IntPtr bytesRead;
      if (!ReadProcessMemory(handle, module.BaseAddress, bytes, bytes.Length, out bytesRead)) {
        CloseHandle(handle);
        return false;
      }
      int limit = Math.Min(bytes.Length, (int)bytesRead.ToInt64()) - Pattern.Length;
      int match = -1;
      for (int index = 0; index <= limit; index++) {
        bool found = true;
        for (int offset = 0; offset < Pattern.Length; offset++) {
          if (Pattern[offset] >= 0 && bytes[index + offset] != Pattern[offset]) {
            found = false;
            break;
          }
        }
        if (found) {
          match = index;
          break;
        }
      }
      if (match < 0) {
        CloseHandle(handle);
        return false;
      }
      long displacementAddress = module.BaseAddress.ToInt64() + match + 4;
      int displacement = BitConverter.ToInt32(bytes, match + 4);
      cachedPid = pid;
      processHandle = handle;
      positionAddress = displacementAddress + displacement + 4;
      return true;
    } catch {
      Reset();
      return false;
    }
  }

  public static double ReadSeconds(int pid) {
    if (!Resolve(pid)) return double.NaN;
    byte[] bytes = new byte[8];
    IntPtr bytesRead;
    if (!ReadProcessMemory(processHandle, new IntPtr(positionAddress), bytes, bytes.Length, out bytesRead) || bytesRead.ToInt64() != 8) {
      Reset();
      return double.NaN;
    }
    double seconds = BitConverter.ToDouble(bytes, 0);
    if (double.IsNaN(seconds) || double.IsInfinity(seconds) || seconds < 0 || seconds > 86400) return double.NaN;
    return seconds;
  }
}
"@

function Write-JsonLine($obj) {
  $json = ($obj | ConvertTo-Json -Compress -Depth 5)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json + "`n")
  [Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)
}

function Write-NullLine {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes("null`n")
  [Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)
}

function Await-WinRT($operation, [type]$resultType) {
  if ($null -eq $operation -or $null -eq $resultType) { return $null }
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 } |
    Where-Object { $_.GetParameters()[0].ParameterType.Name -like "IAsyncOperation*" } |
    Select-Object -First 1
  if (-not $asTask) { return $null }
  $generic = $asTask.MakeGenericMethod($resultType)
  $task = $generic.Invoke($null, @($operation))
  if (-not $task.Wait(3000)) { return $null }
  return $task.Result
}

function Convert-Https($url) {
  if (-not $url) { return "" }
  return ([string]$url) -replace "^http://", "https://"
}

$script:metaCache = $null
$script:metaAt = Get-Date
$script:metaTitle = ""

function Read-NeteaseMeta($title, $artist) {
  $result = @{ durationMs = 0; artwork = ""; album = "" }
  if (-not $title) { return $result }
  if ($script:metaCache -and $script:metaTitle -eq $title -and ((Get-Date) - $script:metaAt).TotalSeconds -lt 20) {
    return $script:metaCache
  }
  $files = @(
    (Join-Path $env:LOCALAPPDATA "Netease\CloudMusic\webdata\file\fmPlay"),
    (Join-Path $env:LOCALAPPDATA "Netease\CloudMusic\webdata\file\playingList")
  )
  foreach ($path in $files) {
    if (-not (Test-Path $path)) { continue }
    try {
      $data = (Get-Content -LiteralPath $path -Raw -Encoding UTF8) | ConvertFrom-Json
    } catch {
      continue
    }
    $songs = @()
    if ($data.queue) { $songs += @($data.queue) }
    if ($data.list) { $songs += @($data.list) }
    $hit = $null
    foreach ($song in $songs) {
      $candidate = if ($song.track) { $song.track } else { $song }
      if ([string]$candidate.name -ne $title) { continue }
      $names = @($candidate.artists | ForEach-Object { [string]$_.name })
      if ($artist -and $names.Count -gt 0 -and ($names -notcontains $artist) -and (($names -join " / ") -ne $artist)) {
        if (-not $hit) { $hit = $candidate }
        continue
      }
      $hit = $candidate
      break
    }
    if (-not $hit) { continue }
    $result.durationMs = [int64]$hit.duration
    if ($hit.album) {
      $result.album = [string]$hit.album.name
      $cover = $hit.album.picUrl
      if (-not $cover) { $cover = $hit.album.cover }
      $result.artwork = Convert-Https $cover
    }
    break
  }
  $script:metaCache = $result
  $script:metaTitle = $title
  $script:metaAt = Get-Date
  return $result
}

function New-TrackPayload($title, $artist, $album, $appName, $status, $positionMs, $durationMs, $artwork, $positionSource = "estimated", $seekable = $false) {
  return [ordered]@{
    title      = [string]$title
    artist     = [string]$artist
    album      = [string]$album
    appName    = [string]$appName
    status     = [string]$status
    positionMs = [int64]$positionMs
    durationMs = [int64]$durationMs
    artwork    = [string]$artwork
    positionSource = [string]$positionSource
    seekable   = [bool]$seekable
  }
}

function Split-TitleArtist([string]$text) {
  $match = [regex]::Match($text, "^(?<title>.+?)\s*[-]\s+(?<artist>.+)$")
  if (-not $match.Success) { return $null }
  $title = $match.Groups["title"].Value.Trim()
  $artist = $match.Groups["artist"].Value.Trim()
  if (-not $title -or -not $artist) { return $null }
  return @{ title = $title; artist = $artist }
}

$ignoreTitles = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
@("CloudMusic", "Orpheus", "QQMusic", "Spotify", "Spotify Premium", "Lyric") | ForEach-Object {
  [void]$ignoreTitles.Add($_)
}

$script:neteaseKey = ""
$script:neteaseLastPosition = -1
$script:neteaseLastSampleAt = Get-Date
$script:neteaseStatus = "playing"

function Get-NeteasePlayback($proc, $key) {
  $seconds = [NeteasePlaybackMemory]::ReadSeconds([int]$proc.Id)
  if ([double]::IsNaN($seconds)) { return $null }
  $positionMs = [int64][Math]::Round($seconds * 1000)
  $now = Get-Date
  if ($script:neteaseKey -ne $key) {
    $script:neteaseKey = $key
    $script:neteaseLastPosition = $positionMs
    $script:neteaseLastSampleAt = $now
    $script:neteaseStatus = "playing"
  } else {
    $elapsedMs = [Math]::Max(1, ($now - $script:neteaseLastSampleAt).TotalMilliseconds)
    $deltaMs = $positionMs - $script:neteaseLastPosition
    if ($deltaMs -gt [Math]::Max(80, $elapsedMs * 0.35)) {
      $script:neteaseStatus = "playing"
    } elseif ([Math]::Abs($deltaMs) -lt 40) {
      $script:neteaseStatus = "paused"
    }
    $script:neteaseLastPosition = $positionMs
    $script:neteaseLastSampleAt = $now
  }
  return @{ positionMs = $positionMs; status = $script:neteaseStatus }
}

function Get-WindowTrack {
  $names = @(
    @{ process = "cloudmusic"; app = "cloudmusic" },
    @{ process = "QQMusic"; app = "QQMusic" },
    @{ process = "QQPlayer"; app = "QQMusic" },
    @{ process = "KuGou"; app = "KuGou" },
    @{ process = "kugou"; app = "KuGou" },
    @{ process = "KwMusic"; app = "KwMusic" },
    @{ process = "Spotify"; app = "Spotify" },
    @{ process = "YesPlayMusic"; app = "YesPlayMusic" },
    @{ process = "lx-music-desktop"; app = "lx-music" }
  )
  foreach ($item in $names) {
    $procs = @(Get-Process -Name $item.process -ErrorAction SilentlyContinue)
    foreach ($proc in $procs) {
      $text = [string]$proc.MainWindowTitle
      if (-not $text) { continue }
      if ($ignoreTitles.Contains($text)) { continue }
      $parsed = Split-TitleArtist $text
      if (-not $parsed) { continue }
      $durationMs = 0
      $artwork = ""
      $album = ""
      if ($item.process -eq "cloudmusic") {
        try {
          $meta = Read-NeteaseMeta $parsed.title $parsed.artist
          $durationMs = [int64]$meta.durationMs
          $artwork = [string]$meta.artwork
          $album = [string]$meta.album
        } catch { }
      }
      $key = "$($parsed.title)|$($parsed.artist)|$($item.app)"
      if ($item.process -eq "cloudmusic") {
        $playback = Get-NeteasePlayback $proc $key
        if ($playback) {
          $positionMs = [int64]$playback.positionMs
          if ($durationMs -gt 0 -and $positionMs -gt $durationMs) { $positionMs = $durationMs }
          return New-TrackPayload $parsed.title $parsed.artist $album $item.app $playback.status $positionMs $durationMs $artwork "netease" $true
        }
      }
      if ($script:windowKey -ne $key) {
        $script:windowKey = $key
        $script:windowStarted = Get-Date
      }
      $positionMs = [int64]((Get-Date) - $script:windowStarted).TotalMilliseconds
      if ($durationMs -gt 0 -and $positionMs -gt $durationMs) { $positionMs = $durationMs }
      return New-TrackPayload $parsed.title $parsed.artist $album $item.app "playing" $positionMs $durationMs $artwork "estimated" $false
    }
  }
  return $null
}

function Get-SmtcSessions($manager) {
  $list = @()
  if (-not $manager) { return $list }
  try { $sessions = $manager.GetSessions() } catch { return $list }
  $count = 0
  try { $count = [int]$sessions.Size } catch { $count = 0 }
  if ($count -gt 0) {
    for ($i = 0; $i -lt $count; $i++) {
      try { $list += $sessions.GetAt($i) } catch { }
    }
    return $list
  }
  foreach ($session in $sessions) { $list += $session }
  return $list
}

function Get-SmtcTrack($manager) {
  if (-not $manager) { return $null }
  $best = $null
  $bestScore = -1
  $propType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
  foreach ($session in (Get-SmtcSessions $manager)) {
    try {
      $info = Await-WinRT ($session.TryGetMediaPropertiesAsync()) $propType
      if (-not $info) { continue }
      $title = [string]$info.Title
      if (-not $title) { continue }
      $status = [string]$session.GetPlaybackInfo().PlaybackStatus
      $statusKey = $status.ToLowerInvariant()
      if ($statusKey -ne "playing" -and $statusKey -ne "paused") { continue }
      $app = [string]$session.SourceAppUserModelId
      $score = 0
      if ($statusKey -eq "playing") { $score += 100 } else { $score += 40 }
      if ($app -match "cloudmusic|Spotify|QQMusic|kugou|Kw|AppleMusic|iTunes|foobar|YesPlayMusic|lx-music") { $score += 20 }
      if ($app -match "chrome|msedge|firefox|opera") { $score -= 15 }
      if ($score -le $bestScore) { continue }
      $timeline = $session.GetTimelineProperties()
      $bestScore = $score
      $best = New-TrackPayload $title ([string]$info.Artist) ([string]$info.AlbumTitle) $app $statusKey ([int64]$timeline.Position.TotalMilliseconds) ([int64]$timeline.EndTime.TotalMilliseconds) "" "smtc" $true
    } catch {
      continue
    }
  }
  return $best
}

function Test-PlayerProcess($appName) {
  $key = [string]$appName
  $names = @()
  if ($key -match "cloudmusic|netease|Netease|CloudMusic") { $names += "cloudmusic" }
  if ($key -match "QQMusic|qqmusic|QQPlayer") { $names += @("QQMusic", "QQPlayer") }
  if ($key -match "kugou|KuGou") { $names += @("KuGou", "kugou") }
  if ($key -match "KwMusic|kwmusic") { $names += "KwMusic" }
  if ($key -match "Spotify") { $names += "Spotify" }
  if ($key -match "YesPlayMusic") { $names += "YesPlayMusic" }
  if ($key -match "lx-music") { $names += "lx-music-desktop" }
  if ($names.Count -eq 0) { return $null }
  foreach ($name in $names) {
    if (Get-Process -Name $name -ErrorAction SilentlyContinue) { return $true }
  }
  return $false
}

function Merge-Track($smtc, $window) {
  if ($window) {
    if ($smtc -and $smtc.title -eq $window.title) {
      if (-not $window.artwork -and $smtc.artwork) { $window.artwork = $smtc.artwork }
      if (-not $window.album -and $smtc.album) { $window.album = $smtc.album }
      if (-not $window.durationMs -and $smtc.durationMs) { $window.durationMs = $smtc.durationMs }
    }
    return $window
  }
  if ($smtc -and ((Test-PlayerProcess $smtc.appName) -eq $false)) { return $null }
  return $smtc
}

function Get-SmtcManager {
  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
    return Await-WinRT ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  } catch {
    return $null
  }
}

$script:windowKey = ""
$script:windowStarted = Get-Date
$script:lastTrack = $null
$manager = Get-SmtcManager

while ($true) {
  $smtc = $null
  $window = $null
  try { $smtc = Get-SmtcTrack $manager } catch { $smtc = $null }
  try { $window = Get-WindowTrack } catch { $window = $null }
  $track = Merge-Track $smtc $window
  if ($track) {
    $script:lastTrack = $track
    Write-JsonLine $track
  } elseif ($script:lastTrack -and ((Test-PlayerProcess $script:lastTrack.appName) -eq $true)) {
    Write-JsonLine $script:lastTrack
  } else {
    $script:lastTrack = $null
    Write-NullLine
  }
  Start-Sleep -Milliseconds 500
}
