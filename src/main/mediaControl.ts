import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { MediaTrack } from "../shared/types"
import { scriptPath } from "./scriptsPath"

const execFileAsync = promisify(execFile)

export type MediaCommand = "playpause" | "play" | "pause" | "next" | "prev"

export interface MediaCommandResult {
  ok: boolean
  method: "media-key" | "smtc" | "unsupported"
}

export async function sendMediaCommand(
  command: MediaCommand,
  track?: MediaTrack | null
): Promise<MediaCommandResult> {
  const script = scriptPath("control-media.ps1")
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Action", command]
  if (track?.title) args.push("-Title", track.title)
  if (track?.artist) args.push("-Artist", track.artist)
  if (track?.appName) args.push("-AppName", track.appName)

  try {
    const { stdout } = await execFileAsync("powershell.exe", args, { windowsHide: true, timeout: 8000 })
    const line = stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .findLast((value) => value.startsWith("{"))
    if (!line) return { ok: true, method: "media-key" }
    return JSON.parse(line) as MediaCommandResult
  } catch (error) {
    const stdout = typeof error === "object" && error && "stdout" in error ? String(error.stdout || "") : ""
    const line = stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .findLast((value) => value.startsWith("{"))
    if (line) {
      try {
        return JSON.parse(line) as MediaCommandResult
      } catch {
        // fall through
      }
    }
    return { ok: false, method: "unsupported" }
  }
}
