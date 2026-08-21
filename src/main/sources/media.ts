import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import type { MediaTrack } from "../../shared/types"
import { scriptPath } from "../scriptsPath"

export type TrackHandler = (track: MediaTrack | null) => void

export interface MediaSource {
  start(): void
  stop(): void
  onTrack(handler: TrackHandler): void
}

export class DemoMediaSource implements MediaSource {
  private handler: TrackHandler | null = null
  start(): void {}
  stop(): void {}
  onTrack(handler: TrackHandler): void {
    this.handler = handler
  }
  push(track: MediaTrack | null): void {
    this.handler?.(track)
  }
}

/** 通过 SMTC 读取系统当前播放会话（网易云 / QQ / Spotify 等上报了媒体会话即可）。 */
export class WindowsSmtcSource implements MediaSource {
  private handler: TrackHandler | null = null
  private child: ChildProcessWithoutNullStreams | null = null
  private lastKey = ""

  onTrack(handler: TrackHandler): void {
    this.handler = handler
  }

  start(): void {
    const script = scriptPath("watch-smtc.ps1")
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
  }

  stop(): void {
    this.child?.kill()
    this.child = null
  }

  private consume(line: string): void {
    if (!line) return
    if (line === "null") {
      if (this.lastKey !== "null") {
        this.lastKey = "null"
        this.handler?.(null)
      }
      return
    }
    if (!line.startsWith("{")) return
    try {
      const track = JSON.parse(line) as MediaTrack
      const key = `${track.appName}|${track.title}|${track.artist}|${track.status}`
      if (key === this.lastKey) return
      this.lastKey = key
      this.handler?.(track)
    } catch {
      // ignore
    }
  }
}
