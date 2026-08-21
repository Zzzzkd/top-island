import { execFileSync } from "node:child_process"

/** 启动时清掉本项目其它 Electron / electron-vite，只留当前这次。 */
export function killOtherTopIslandProcesses(): void {
  const keep = [process.pid, process.ppid]
  const script = `
    $keep = @(${keep.join(",")})
    Get-CimInstance Win32_Process | Where-Object {
      $_.CommandLine -and
      $_.CommandLine -like '*top-island*' -and
      $keep -notcontains $_.ProcessId -and
      (
        ($_.Name -eq 'electron.exe' -and $_.CommandLine -notlike '*--type=*') -or
        ($_.Name -eq 'node.exe' -and $_.CommandLine -like '*electron-vite*')
      )
    } | ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  `
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      timeout: 8000
    })
  } catch {
    // 清不掉也不挡这次启动
  }
}
