import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync } from "node:fs"
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

function identityOf(track: MediaTrack): string {
  return `${track.appName}|${track.title}|${track.artist}|${track.status}|${track.artwork || ""}`
}

function displayAppName(appName: string): string {
  const key = appName.toLowerCase()
  if (key.includes("cloudmusic") || key.includes("netease")) return "网易云音乐"
  if (key.includes("qqmusic") || key.includes("qqplayer")) return "QQ音乐"
  if (key.includes("kugou")) return "酷狗音乐"
  if (key.includes("kwmusic")) return "酷我音乐"
  if (key.includes("spotify")) return "Spotify"
  return appName
}

/** 读取播放器窗口标题，并在可用时叠加 Windows SMTC。 */
export class WindowsSmtcSource implements MediaSource {
  private handler: TrackHandler | null = null
  private child: ChildProcessWithoutNullStreams | null = null
  private lastIdentity = ""
  private lastPositionBucket = -1
  private stopped = false
  private restartTimer: NodeJS.Timeout | null = null

  onTrack(handler: TrackHandler): void {
    this.handler = handler
  }

  start(): void {
    this.stopped = false
    this.spawnWatcher()
  }

  stop(): void {
    this.stopped = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    this.child?.kill()
    this.child = null
  }

  private spawnWatcher(): void {
    if (this.stopped) return
    const script = scriptPath("watch-smtc.ps1")
    if (!existsSync(script)) {
      console.error("[media] missing script", script)
      return
    }
    this.child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
      { windowsHide: true }
    )
    let buffer = ""
    this.child.stdout.setEncoding("utf8")
    this.child.stderr.setEncoding("utf8")
    this.child.stdout.on("data", (chunk: string) => {
      buffer += chunk
      const parts = buffer.split("\n")
      buffer = parts.pop() ?? ""
      for (const line of parts) this.consume(line.trim())
    })
    this.child.stderr.on("data", (chunk: string) => {
      const text = chunk.trim()
      if (text) console.error("[media]", text)
    })
    this.child.on("exit", (code) => {
      this.child = null
      if (this.stopped) return
      console.error("[media] watcher exited", code)
      this.restartTimer = setTimeout(() => this.spawnWatcher(), 1200)
    })
  }


  private consume(line: string): void {
    if (!line) return
    if (line === "null") {
      if (!this.lastIdentity) return
      this.lastIdentity = ""
      this.lastPositionBucket = -1
      this.handler?.(null)
      return
    }
    const json = line.startsWith("{") ? line : line.slice(line.indexOf("{"))
    if (!json.startsWith("{")) return
    try {
      const track = JSON.parse(json) as MediaTrack
      if (!track.title) return
      track.appName = displayAppName(track.appName || "")
      const identity = identityOf(track)
      const bucket = Math.floor((track.positionMs || 0) / 400)
      if (identity === this.lastIdentity && bucket === this.lastPositionBucket) return
      this.lastIdentity = identity
      this.lastPositionBucket = bucket
      this.handler?.(track)
    } catch {
      // ignore malformed lines
    }
  }
}
