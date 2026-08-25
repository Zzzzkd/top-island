import loudness from "loudness"
import type { SystemVolumeState } from "../shared/types"

const FALLBACK_VOLUME: SystemVolumeState = {
  level: 0,
  muted: false,
  available: false
}

let writeQueue: Promise<void> = Promise.resolve()

function clampVolume(level: number): number {
  if (!Number.isFinite(level)) return 0
  return Math.round(Math.min(100, Math.max(0, level)))
}

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  const next = writeQueue.then(task, task)
  writeQueue = next.catch(() => undefined)
  return next
}

export async function getSystemVolume(): Promise<SystemVolumeState> {
  try {
    await writeQueue
    const [level, muted] = await Promise.all([loudness.getVolume(), loudness.getMuted()])
    return { level: clampVolume(level), muted, available: true }
  } catch {
    return FALLBACK_VOLUME
  }
}

export function setSystemVolume(level: number): Promise<void> {
  const next = clampVolume(level)
  return enqueueWrite(() => loudness.setVolume(next))
}

export function setSystemMuted(muted: boolean): Promise<void> {
  return enqueueWrite(() => loudness.setMuted(Boolean(muted)))
}
