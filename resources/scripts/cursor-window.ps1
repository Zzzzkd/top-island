param(
  [ValidateSet("status", "send", "read", "peek", "send-image", "list", "select")]
  [string]$Action = "status",
  [int]$WaitSeconds = 90,
  [string]$TextBase64 = "",
  [string]$ImagePath = "",
  [string]$ChatTitleBase64 = ""
)

$ErrorActionPreference = "Stop"
trap {
  try {
    Write-Json @{ ok = $false; error = "cursor-window-failed" }
  } catch {}
  exit 2
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

if (-not ("WinQuiet" -as [type])) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WinQuiet {
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
  public const uint WM_CHAR = 0x0102;
  public const int VK_RETURN = 0x0D;
  public const int SW_SHOWNOACTIVATE = 4;
  public const int SW_SHOWMINNOACTIVE = 7;
  public const int DWMWA_CLOAK = 13;
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct WINDOWPLACEMENT {
    public int length; public int flags; public int showCmd;
    public POINT min; public POINT max; public RECT normal;
  }
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);
  [DllImport("user32.dll")] public static extern bool SetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr child, string cls, string title);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

  public static void Cloak(IntPtr hwnd, bool cloak) {
    int v = cloak ? 1 : 0;
    DwmSetWindowAttribute(hwnd, DWMWA_CLOAK, ref v, 4);
  }
  static WINDOWPLACEMENT ReadPlacement(IntPtr hwnd) {
    WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
    wp.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
    GetWindowPlacement(hwnd, ref wp);
    return wp;
  }
  public static bool WakeHidden(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return false;
    if (!IsIconic(hwnd) && ReadPlacement(hwnd).showCmd != 2) return false;
    Cloak(hwnd, true);
    WINDOWPLACEMENT wp = ReadPlacement(hwnd);
    wp.showCmd = SW_SHOWNOACTIVATE;
    SetWindowPlacement(hwnd, ref wp);
    return true;
  }
  public static void SleepHidden(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return;
    WINDOWPLACEMENT wp = ReadPlacement(hwnd);
    wp.showCmd = SW_SHOWMINNOACTIVE;
    SetWindowPlacement(hwnd, ref wp);
    Cloak(hwnd, false);
  }
  public static IntPtr FindRender(IntPtr root) {
    IntPtr child = IntPtr.Zero;
    while (true) {
      child = FindWindowEx(root, child, null, null);
      if (child == IntPtr.Zero) return IntPtr.Zero;
      StringBuilder sb = new StringBuilder(256);
      GetClassName(child, sb, 256);
      string name = sb.ToString();
      if (name.IndexOf("RenderWidgetHost") >= 0) return child;
      IntPtr nested = FindRender(child);
      if (nested != IntPtr.Zero) return nested;
    }
  }
  public static void PostEnter(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return;
    IntPtr vk = (IntPtr)VK_RETURN;
    PostMessage(hwnd, WM_KEYDOWN, vk, IntPtr.Zero);
    PostMessage(hwnd, WM_CHAR, vk, IntPtr.Zero);
    PostMessage(hwnd, WM_KEYUP, vk, IntPtr.Zero);
  }
}
"@
}

function To-B64([string]$value) {
  if (-not $value) { return "" }
  return [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($value))
}

function Write-Json($obj) {
  $chats = ""
  if ($obj.chats) { $chats = @($obj.chats) -join "`n" }
  $payload = @{
    ok = [bool]$obj.ok
    error = [string]$obj.error
    stamp = [string]$obj.stamp
    window = To-B64 ([string]$obj.window)
    chatTitle = To-B64 ([string]$obj.chatTitle)
    reply = To-B64 ([string]$obj.reply)
    chats = To-B64 $chats
  } | ConvertTo-Json -Compress -Depth 4
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload + "`n")
  $stdout = [Console]::OpenStandardOutput()
  $stdout.Write($bytes, 0, $bytes.Length)
}

function Get-CursorWindows {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $kids = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  $found = @()
  foreach ($win in $kids) {
    $name = $win.Current.Name
    $proc = ""
    try { $proc = (Get-Process -Id $win.Current.ProcessId -ErrorAction SilentlyContinue).ProcessName } catch {}
    if ($proc -ne "Cursor" -and $name -notmatch "Cursor") { continue }
    if ($name -eq "Top Island") { continue }
    $found += $win
  }
  return $found
}

function Find-SendButton($win, $box) {
  $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $fallback = $null
  $sendZh = ([string][char]0x53D1) + ([string][char]0x9001)
  foreach ($el in $all) {
    try {
      $type = $el.Current.ControlType.ProgrammaticName
      if ($type -ne "ControlType.Button" -and $type -ne "ControlType.SplitButton") { continue }
      $name = [string]$el.Current.Name
      $cls = ([string]$el.Current.ClassName).ToLowerInvariant()
      $id = ([string]$el.Current.AutomationId).ToLowerInvariant()
      if ($name -match "follow-up|Thumbs|Copy|Fork") { continue }
      $hit = ($name -eq "Send") -or ($name.StartsWith("Send ")) -or ($name -eq "Submit") -or ($name -eq $sendZh) -or $cls.Contains("send") -or $cls.Contains("submit") -or $id.Contains("send") -or $id.Contains("submit")
      if (-not $hit) { continue }
      if ($el.Current.IsEnabled) { return $el }
      if (-not $fallback) { $fallback = $el }
    } catch {}
  }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $node = $box
  for ($i = 0; $i -lt 8 -and $node; $i++) {
    try { $node = $walker.GetParent($node) } catch { break }
    if (-not $node) { break }
    $cls = [string]$node.Current.ClassName
    if ($cls -notmatch "composer|prompt|aislash") { continue }
    $last = $null
    $kids = $node.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($el in $kids) {
      if ($el.Current.ControlType.ProgrammaticName -ne "ControlType.Button") { continue }
      if (-not $el.Current.IsEnabled) { continue }
      $name = [string]$el.Current.Name
      if ($name -match "Add|Image|Mention|Context|Model|Agent|\+") { continue }
      $last = $el
    }
    if ($last) { return $last }
  }
  return $fallback
}

function Invoke-Quiet($el) {
  $invoke = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invoke.Invoke()
}

function Post-Enter($win, $box) {
  $hwnds = @(
    [IntPtr]$box.Current.NativeWindowHandle,
    [IntPtr]$win.Current.NativeWindowHandle,
    [WinQuiet]::FindRender([IntPtr]$win.Current.NativeWindowHandle)
  )
  foreach ($hwnd in $hwnds) {
    [WinQuiet]::PostEnter($hwnd)
  }
}

function Use-HiddenWake($win, [scriptblock]$work) {
  $hwnd = [IntPtr]$win.Current.NativeWindowHandle
  $woke = $false
  try {
    $woke = [WinQuiet]::WakeHidden($hwnd)
    if ($woke) { Start-Sleep -Milliseconds 280 }
    & $work
  } finally {
    if ($woke) { [WinQuiet]::SleepHidden($hwnd) }
  }
}

function Find-Prompt($win) {
  $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($el in $all) {
    $cls = $el.Current.ClassName
    if ($cls -match "ui-prompt-input-editor__input|ProseMirror") {
      return $el
    }
  }
  return $null
}

function Clean-ChatName([string]$name) {
  $n = $name -replace '^(Completed|Draft)\s+', ""
  $n = $n -replace '\s+\d+[smhd]$', ""
  return $n.Trim()
}

function Get-ChatList($win) {
  $skip = "New Chat|Search |Automations|Customize|Hide Sidebar|Go Back|Go Forward|Account menu|Settings|Open Workspace|Repositories|No agents yet|No Repo|^File$|^Edit$|^View$|^Help$|^Cursor$|^IDE$|Chat actions|Show Apps|Chat title"
  $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $names = New-Object System.Collections.Generic.List[string]
  foreach ($el in $all) {
    if ($el.Current.ControlType.ProgrammaticName -ne "ControlType.Button") { continue }
    $cls = $el.Current.ClassName
    $name = $el.Current.Name
    if (-not $name) { continue }
    if ($cls -match "sidebar-section-head") { continue }
    if ($cls -notmatch "sidebar-menu-button") { continue }
    if ($name -match $skip) { continue }
    $clean = Clean-ChatName $name
    if (-not $clean -or $names.Contains($clean)) { continue }
    $names.Add($clean)
  }
  return @($names)
}

function Select-Chat($win, [string]$title) {
  if (-not $title) { return $false }
  $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($el in $all) {
    if ($el.Current.ControlType.ProgrammaticName -ne "ControlType.Button") { continue }
    $cls = $el.Current.ClassName
    $name = $el.Current.Name
    if ($cls -notmatch "sidebar-menu-button") { continue }
    if ($cls -match "sidebar-section-head") { continue }
    $clean = Clean-ChatName $name
    if ($clean -ne $title -and $name -notmatch [regex]::Escape($title)) { continue }
    $invoke = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
    Start-Sleep -Milliseconds 350
    return $true
  }
  return $false
}

function Get-ChatTitle($win) {
  $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($el in $all) {
    $name = $el.Current.Name
    if ($name -match "^Chat title\.\s*(.+)$") { return $Matches[1].Trim() }
  }
  return $win.Current.Name
}

function Get-CopyButtons($win) {
  $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $buttons = @()
  foreach ($el in $all) {
    if ($el.Current.Name -eq "Copy message") { $buttons += $el }
  }
  return $buttons
}

function Get-LastStamp($win) {
  $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $last = ""
  foreach ($el in $all) {
    $name = $el.Current.Name
    if ($name -match "^Message sent ") { $last = $name }
  }
  return $last
}

function Find-ByClass($win, $pattern) {
  $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($el in $all) {
    if ($el.Current.ClassName -match $pattern) { return $el }
  }
  return $null
}

function Get-LiveReply($win) {
  $root = Find-ByClass $win "composer-react-transcript-root"
  if (-not $root) { $root = Find-ByClass $win "conversations" }
  if (-not $root) { $root = $win }
  $skip = "^(Copy message|Thumbs up|Thumbs down|Fork chat|Send follow-up|Multitask|Explored |Message sent |Chat title|Apps|Open Tabs|On |Just now|\d+[smhd] ago|Planning next moves|Thinking|Exploring|Reading files)$"
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $chunk = New-Object System.Collections.Generic.List[string]
  foreach ($el in $all) {
    $name = [string]$el.Current.Name
    if (-not $name) { continue }
    if ($name -eq "Copy message") {
      $chunk.Clear()
      continue
    }
    $type = $el.Current.ControlType.ProgrammaticName
    if ($type -ne "ControlType.Text" -and $type -ne "ControlType.Group") { continue }
    if ($name -match $skip) { continue }
    if ($name.Length -lt 1) { continue }
    if ($chunk.Count -gt 0) {
      $prev = $chunk[$chunk.Count - 1]
      if ($prev -eq $name) { continue }
      if ($prev.Contains($name) -and $prev.Length -gt $name.Length) { continue }
      if ($name.Contains($prev) -and $name.Length -gt $prev.Length) {
        $chunk[$chunk.Count - 1] = $name
        continue
      }
    }
    $chunk.Add($name)
  }
  if ($chunk.Count -eq 0) { return "" }
  $text = ($chunk -join "`n").Trim()
  if ($text.Length -gt 6000) { return $text.Substring($text.Length - 6000) }
  return $text
}
  $all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $hit = ""
  foreach ($el in $all) {
    $name = $el.Current.Name
    if (-not $name) { continue }
    if ($name -match "Planning next moves|Thinking|Exploring|Reading files") { $hit = $name }
    elseif ($name.Contains(([string][char]0x6B63) + ([string][char]0x5728) + ([string][char]0x601D) + ([string][char]0x8003))) { $hit = $name }
    elseif ($name.Contains(([string][char]0x6B63) + ([string][char]0x5728) + ([string][char]0x56DE) + ([string][char]0x590D))) { $hit = $name }
  }
  return $hit
}

function Copy-LastReply($win) {
  $buttons = @(Get-CopyButtons $win)
  if ($buttons.Count -eq 0) { return "" }
  $btn = $buttons[$buttons.Count - 1]
  $old = [System.Windows.Forms.Clipboard]::GetText()
  $invoke = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invoke.Invoke()
  Start-Sleep -Milliseconds 250
  $text = [System.Windows.Forms.Clipboard]::GetText()
  try { [System.Windows.Forms.Clipboard]::SetText($old) } catch {}
  if (-not $text) { return "" }
  if ($text.Length -gt 4000) { return $text.Substring(0, 4000) }
  return $text
}

function Test-Minimized($win) {
  try {
    $pat = $win.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
    return $pat.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized
  } catch {
    return $false
  }
}

function Set-PromptText($win, $box, $text) {
  try {
    $vp = $box.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $vp.SetValue($text)
    return $true
  } catch {}
  try {
    $acc = $box.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
    $acc.SetValue($text)
    return $true
  } catch {}
  if (Test-Minimized $win) { return $false }
  $box.SetFocus()
  Start-Sleep -Milliseconds 80
  [System.Windows.Forms.SendKeys]::SendWait("^a")
  Start-Sleep -Milliseconds 40
  [System.Windows.Forms.Clipboard]::SetText($text)
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  return $true
}

function Submit-Prompt($win, $box) {
  $send = Find-SendButton $win $box
  if ($send) {
    try {
      Invoke-Quiet $send
      return
    } catch {}
  }
  Post-Enter $win $box
}

function Paste-Image($box, $path) {
  Add-Type -AssemblyName System.Drawing
  $img = [System.Drawing.Image]::FromFile($path)
  [System.Windows.Forms.Clipboard]::SetImage($img)
  $img.Dispose()
  $box.SetFocus()
  Start-Sleep -Milliseconds 120
  [System.Windows.Forms.SendKeys]::SendWait("^v")
}

$windows = @(Get-CursorWindows)
$target = $null
$prompt = $null
foreach ($win in $windows) {
  $p = Find-Prompt $win
  if ($p) { $target = $win; $prompt = $p; break }
}

if (-not $target) {
  Write-Json @{ ok = $false; error = "cursor-window-not-found" }
  exit 2
}

$wantedChat = ""
if ($ChatTitleBase64) {
  $wantedChat = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($ChatTitleBase64))
}
if ($wantedChat -and ($Action -eq "select" -or $Action -eq "send" -or $Action -eq "send-image")) {
  Select-Chat $target $wantedChat | Out-Null
  $prompt = Find-Prompt $target
}

$title = Get-ChatTitle $target

if ($Action -eq "list") {
  Write-Json @{
    ok = $true
    window = $target.Current.Name
    chatTitle = $title
    chats = @(Get-ChatList $target)
  }
  exit 0
}

if ($Action -eq "select") {
  Write-Json @{
    ok = $true
    window = $target.Current.Name
    chatTitle = $title
    chats = @(Get-ChatList $target)
  }
  exit 0
}

if ($Action -eq "status") {
  Write-Json @{ ok = $true; window = $target.Current.Name; chatTitle = $title }
  exit 0
}

if ($Action -eq "peek") {
  $live = Get-LiveReply $target
  $think = Get-Thinking $target
  Write-Json @{
    ok = $true
    window = $target.Current.Name
    chatTitle = $title
    reply = $(if ($live) { $live } else { $think })
    stamp = (Get-LastStamp $target)
  }
  exit 0
}

if ($Action -eq "read") {
  Write-Json @{
    ok = $true
    window = $target.Current.Name
    chatTitle = $title
    reply = (Copy-LastReply $target)
    stamp = (Get-LastStamp $target)
  }
  exit 0
}

$text = ""
if ($TextBase64) {
  $text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($TextBase64))
}

if ($Action -eq "send-image") {
  if (-not $ImagePath -or -not (Test-Path -LiteralPath $ImagePath)) {
    Write-Json @{ ok = $false; error = "image-not-found" }
    exit 2
  }
  $before = Get-LastStamp $target
  Use-HiddenWake $target {
    $script:prompt = Find-Prompt $target
    Paste-Image $script:prompt $ImagePath
    if ($text.Trim()) {
      Start-Sleep -Milliseconds 150
      Set-PromptText $target $script:prompt $text.Trim() | Out-Null
    }
    Submit-Prompt $target $script:prompt
  }
  Write-Json @{
    ok = $true
    window = $target.Current.Name
    chatTitle = $title
    stamp = $before
    reply = ""
  }
  exit 0
}

if (-not $text -or -not $text.Trim()) {
  Write-Json @{ ok = $false; error = "empty-prompt" }
  exit 2
}

$before = Get-LastStamp $target
Use-HiddenWake $target {
  $script:prompt = Find-Prompt $target
  Set-PromptText $target $script:prompt $text.Trim() | Out-Null
  Submit-Prompt $target $script:prompt
}
Write-Json @{
  ok = $true
  window = $target.Current.Name
  chatTitle = $title
  stamp = $before
  reply = ""
}
exit 0
