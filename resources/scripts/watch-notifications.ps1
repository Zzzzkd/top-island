$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding

function Write-JsonLine($obj) {
  $json = ($obj | ConvertTo-Json -Compress)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json + "`n")
  [Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)
}

function Wait-WinRT($operation) {
  if ($null -eq $operation) { return $null }
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 } |
    Where-Object { $_.GetParameters()[0].ParameterType.Name -like "IAsyncOperation*" } |
    Select-Object -First 1
  if (-not $asTask) { return $null }
  $generic = $asTask.MakeGenericMethod($operation.GetType().GenericTypeArguments[0])
  $task = $generic.Invoke($null, @($operation))
  $task.Wait() | Out-Null
  return $task.Result
}

Add-Type @"
using System.Runtime.InteropServices;
public class AumidHelper {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
}
"@
[void][AumidHelper]::SetCurrentProcessExplicitAppUserModelID("com.topisland.app")

[Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications.Management, ContentType = WindowsRuntime] | Out-Null
[Windows.UI.Notifications.NotificationKinds, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.UI.Notifications.KnownNotificationBindings, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null

$listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
$access = Wait-WinRT ($listener.RequestAccessAsync())
Write-JsonLine ([ordered]@{
  type   = "status"
  access = "$access"
})

if ("$access" -ne "Allowed") {
  while ($true) { Start-Sleep -Seconds 20 }
}

$seen = New-Object "System.Collections.Generic.HashSet[string]"
$seeded = $false

while ($true) {
  try {
    $notes = Wait-WinRT ($listener.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast))
    if ($null -eq $notes) {
      Start-Sleep -Milliseconds 800
      continue
    }
    foreach ($note in $notes) {
      $id = [string]$note.Id
      if (-not $seeded) {
        [void]$seen.Add($id)
        continue
      }
      if ($seen.Contains($id)) { continue }
      [void]$seen.Add($id)

      $appId = ""
      $appName = "系统"
      try {
        $appId = [string]$note.AppInfo.AppUserModelId
        $appName = [string]$note.AppInfo.DisplayInfo.DisplayName
      } catch {
        if ($appId) { $appName = $appId }
      }

      $title = ""
      $body = ""
      try {
        $binding = $note.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric)
        $texts = $binding.GetTextElements()
        if ($texts.Count -gt 0) { $title = [string]$texts[0].Text }
        if ($texts.Count -gt 1) {
          $rest = @()
          for ($i = 1; $i -lt $texts.Count; $i++) { $rest += [string]$texts[$i].Text }
          $body = ($rest -join " ")
        }
      } catch {}

      if (-not $title -and -not $body) { continue }

      Write-JsonLine ([ordered]@{
        type    = "toast"
        id      = $id
        appId   = $appId
        appName = $appName
        title   = $title
        body    = $body
        at      = [int64]([DateTimeOffset]::Now.ToUnixTimeMilliseconds())
      })
    }
    $seeded = $true
  } catch {
    Write-JsonLine ([ordered]@{
      type  = "status"
      error = $_.Exception.Message
    })
  }
  Start-Sleep -Milliseconds 800
}
