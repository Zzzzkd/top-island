import { useCallback, useEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"
import type { SystemVolumeState } from "../../../shared/types"
import { ElasticVolumeSlider } from "./ElasticVolumeSlider"

const initialVolume: SystemVolumeState = { level: 0, muted: false, available: false }
const presets = [0, 25, 50, 75, 100]

export function VolumePage() {
  const [volume, setVolume] = useState<SystemVolumeState>(initialVolume)
  const dragging = useRef(false)
  const writeTimer = useRef<number | null>(null)
  const latestLevel = useRef(0)
  const mutedRef = useRef(false)
  const localRevision = useRef(0)
  const settleTimer = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    const revision = localRevision.current
    const next = await window.island.getSystemVolume()
    if (!dragging.current && revision === localRevision.current) {
      latestLevel.current = next.level
      mutedRef.current = next.muted
      setVolume(next)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 1200)
    return () => {
      window.clearInterval(timer)
      if (writeTimer.current !== null) window.clearTimeout(writeTimer.current)
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
    }
  }, [refresh])

  const writeLevel = (level: number, immediate = false): void => {
    localRevision.current += 1
    if (mutedRef.current) {
      mutedRef.current = false
      void window.island.setSystemMuted(false).catch(() => void refresh())
    }
    latestLevel.current = level
    setVolume((current) => ({ ...current, level, muted: false }))
    if (writeTimer.current !== null) window.clearTimeout(writeTimer.current)

    const send = (): void => {
      writeTimer.current = null
      void window.island.setSystemVolume(latestLevel.current).catch(() => void refresh())
    }

    if (immediate) send()
    else writeTimer.current = window.setTimeout(send, 45)
  }

  const commitLevel = (level: number): void => {
    dragging.current = false
    writeLevel(level, true)
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null
      void refresh()
    }, 160)
  }

  const toggleMute = (): void => {
    const nextMuted = !mutedRef.current
    localRevision.current += 1
    mutedRef.current = nextMuted
    setVolume((current) => ({ ...current, muted: nextMuted }))
    void window.island.setSystemMuted(nextMuted).then(refresh, refresh)
  }

  return (
    <section className="volume-page" aria-label="系统音量页面">
      <div className="volume-control-card spotlight-card">
        <div className="volume-ambient" style={{ "--volume-level": `${volume.muted ? 0 : volume.level}%` } as CSSProperties} />
        <ElasticVolumeSlider
          value={volume.level}
          muted={volume.muted}
          disabled={!volume.available}
          onDragStart={() => {
            dragging.current = true
          }}
          onChange={(level) => writeLevel(level)}
          onCommit={commitLevel}
          onToggleMute={toggleMute}
        />
        <div className="volume-scale" aria-hidden="true">
          <span>安静</span><span>适中</span><span>响亮</span>
        </div>
      </div>

      <div className="volume-presets" role="group" aria-label="音量预设">
        {presets.map((level) => (
          <button
            type="button"
            key={level}
            className={!volume.muted && volume.level === level ? "active" : ""}
            disabled={!volume.available}
            onClick={() => writeLevel(level, true)}
          >
            {`${level}%`}
          </button>
        ))}
      </div>

      <div className="volume-footnote">
        <span className={`volume-status-dot${volume.available ? " online" : ""}`} />
        {volume.available ? "已连接系统默认输出设备" : "暂时无法读取系统音量"}
      </div>
    </section>
  )
}
