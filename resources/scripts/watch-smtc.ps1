$ErrorActionPreference = "SilentlyContinue"
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null

function Wait-WinRT($operation) {
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 } |
    Where-Object { $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation``1" } |
    Select-Object -First 1
  if (-not $asTask) { return $null }
  $generic = $asTask.MakeGenericMethod($operation.GetType().GenericTypeArguments[0])
  $task = $generic.Invoke($null, @($operation))
  $task.Wait() | Out-Null
  return $task.Result
}

$manager = Wait-WinRT ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync())
if (-not $manager) {
  while ($true) { Write-Output "null"; Start-Sleep -Milliseconds 1500 }
}

while ($true) {
  try {
    $session = $manager.GetCurrentSession()
    if (-not $session) {
      Write-Output "null"
    } else {
      $info = Wait-WinRT ($session.TryGetMediaPropertiesAsync())
      $timeline = $session.GetTimelineProperties()
      $status = $session.GetPlaybackInfo().PlaybackStatus.ToString().ToLower()
      if ($status -eq "playing" -or $status -eq "paused") {
        $payload = [ordered]@{
          title      = [string]$info.Title
          artist     = [string]$info.Artist
          album      = [string]$info.AlbumTitle
          appName    = [string]$session.SourceAppUserModelId
          status     = $status
          positionMs = [int64]$timeline.Position.TotalMilliseconds
          durationMs = [int64]$timeline.EndTime.TotalMilliseconds
        }
        ($payload | ConvertTo-Json -Compress)
      } else {
        Write-Output "null"
      }
    }
  } catch {
    Write-Output "null"
  }
  Start-Sleep -Milliseconds 1200
}
