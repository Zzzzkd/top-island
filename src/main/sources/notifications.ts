import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import type { NotificationEvent } from "../../shared/types"
import { scriptPath } from "../scriptsPath"

export type NotificationHandler = (event: NotificationEvent) => void
export type AccessHandler = (access: string) => void

export interface NotificationSource {
  start(): void
  stop(): void
  onNotification(handler: NotificationHandler): void
  onAccess?(handler: AccessHandler): void
}

export class DemoNotificationSource implements NotificationSource {
  private handler: NotificationHandler | null = null

  start(): void {}
  stop(): void {}
  onNotification(handler: NotificationHandler): void {
    this.handler = handler
  }

  push(event: NotificationEvent): void {
    this.handler?.(event)
  }
}

/** 监听 Windows 通知中心里的 Toast。需在系统设置里允许「访问通知」。 */
export class WindowsNotificationSource implements NotificationSource {
  private handler: NotificationHandler | null = null
  private accessHandler: AccessHandler | null = null
  private child: ChildProcessWithoutNullStreams | null = null
  private seen = new Set<string>()

  onNotification(handler: NotificationHandler): void {
    this.handler = handler
  }

  onAccess(handler: AccessHandler): void {
    this.accessHandler = handler
  }

  start(): void {
    const script = scriptPath("watch-notifications.ps1")
    this.child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
      { windowsHide: true }
    )
    let buffer = ""
    this.child.stdout.setEncoding("utf8")
    this.child.stdout.on("data", (chunk: string) => {
      buffer += chunk
      const parts = buffer.split("\n")
      buffer = parts.pop() ?? ""
      for (const line of parts) this.consume(line.trim())
    })
    this.child.on("exit", () => {
      this.child = null
    })
  }

  stop(): void {
    this.child?.kill()
    this.child = null
  }

  private consume(line: string): void {
    if (!line.startsWith("{")) return
    try {
      const raw = JSON.parse(line) as NotificationEvent & { type?: string; access?: string }
      if (raw.type === "status") {
        if (raw.access) this.accessHandler?.(raw.access)
        return
      }
      if (!raw.title && !raw.body) return
      const key = raw.id || `${raw.appId}|${raw.title}|${raw.body}`
      if (this.seen.has(key)) return
      this.seen.add(key)
      if (this.seen.size > 300) this.seen.clear()
      this.handler?.(raw)
    } catch {
      // 忽略解析失败的半行
    }
  }
}
