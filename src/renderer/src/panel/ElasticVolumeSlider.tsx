import { animate, motion, useMotionValue, useTransform } from "motion/react"
import { useEffect, useRef, useState } from "react"

interface ElasticVolumeSliderProps {
  value: number
  muted: boolean
  disabled?: boolean
  onChange: (value: number) => void
  onCommit: (value: number) => void
  onDragStart?: () => void
  onToggleMute: () => void
}

type OverflowRegion = "left" | "middle" | "right"

const MAX_OVERFLOW = 38

function clamp(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

function softenOverflow(distance: number): number {
  const normalized = distance / MAX_OVERFLOW
  return Math.tanh(normalized) * MAX_OVERFLOW
}

function VolumeGlyph({ loud = false, muted = false }: { loud?: boolean; muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.4v5.2h3.5l4.2 3.4V6L7.5 9.4H4Z" />
      {muted ? <path className="volume-glyph-stroke" d="m16 9 4 4m0-4-4 4" /> : null}
      {!muted ? <path className="volume-glyph-stroke" d={loud ? "M15 8.2a5.2 5.2 0 0 1 0 7.6M17.7 5.6a8.7 8.7 0 0 1 0 12.8" : "M15 9.2a4 4 0 0 1 0 5.6"} /> : null}
    </svg>
  )
}

export function ElasticVolumeSlider({
  value,
  muted,
  disabled = false,
  onChange,
  onCommit,
  onDragStart,
  onToggleMute
}: ElasticVolumeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const hovered = useRef(false)
  const latestValue = useRef(clamp(value))
  const [region, setRegion] = useState<OverflowRegion>("middle")
  const overflow = useMotionValue(0)
  const interactionScale = useMotionValue(1)
  const trackScaleX = useTransform(overflow, (amount) => 1 + amount / 220)
  const trackScaleY = useTransform(overflow, [0, MAX_OVERFLOW], [1, 0.78])
  const leftShift = useTransform(overflow, (amount) => (region === "left" ? -amount * 0.55 : 0))
  const rightShift = useTransform(overflow, (amount) => (region === "right" ? amount * 0.55 : 0))

  useEffect(() => {
    latestValue.current = clamp(value)
  }, [value])

  const updateFromPointer = (clientX: number): number => {
    const track = trackRef.current
    if (!track) return latestValue.current
    const bounds = track.getBoundingClientRect()
    const next = clamp(((clientX - bounds.left) / bounds.width) * 100)
    const outside = clientX < bounds.left ? bounds.left - clientX : clientX > bounds.right ? clientX - bounds.right : 0
    const nextRegion: OverflowRegion = clientX < bounds.left ? "left" : clientX > bounds.right ? "right" : "middle"

    latestValue.current = next
    setRegion(nextRegion)
    overflow.jump(softenOverflow(outside))
    onChange(next)
    return next
  }

  const finishDrag = (): void => {
    if (!dragging.current) return
    dragging.current = false
    onCommit(latestValue.current)
    void animate(overflow, 0, { type: "spring", stiffness: 330, damping: 18, mass: 0.65 }).then(() => setRegion("middle"))
    void animate(interactionScale, hovered.current ? 1.018 : 1, { type: "spring", stiffness: 420, damping: 28 })
  }

  const commitKeyboardValue = (next: number): void => {
    const clamped = clamp(next)
    latestValue.current = clamped
    onChange(clamped)
    onCommit(clamped)
    void animate(interactionScale, [1, 1.045, 1], { duration: 0.24 })
  }

  return (
    <motion.div
      className={`elastic-volume${disabled ? " disabled" : ""}`}
      style={{ scale: interactionScale }}
      onPointerEnter={() => {
        hovered.current = true
        if (!disabled && !dragging.current) {
          void animate(interactionScale, 1.018, { type: "spring", stiffness: 420, damping: 30 })
        }
      }}
      onPointerLeave={() => {
        hovered.current = false
        if (!dragging.current) {
          void animate(interactionScale, 1, { type: "spring", stiffness: 420, damping: 30 })
        }
      }}
    >
      <motion.button
        type="button"
        className={`volume-icon-button${muted ? " active" : ""}`}
        aria-label={muted ? "取消静音" : "静音"}
        disabled={disabled}
        style={{ x: leftShift }}
        animate={{ scale: region === "left" ? [1, 1.28, 1] : 1 }}
        transition={{ duration: 0.24 }}
        onClick={onToggleMute}
      >
        <VolumeGlyph muted={muted} />
      </motion.button>

      <div
        ref={trackRef}
        className="elastic-volume-control"
        role="slider"
        aria-label="系统音量"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={muted ? `已静音，音量 ${value}%` : `音量 ${value}%`}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(event) => {
          if (disabled) return
          if (event.key === "ArrowLeft" || event.key === "ArrowDown") commitKeyboardValue(value - 2)
          else if (event.key === "ArrowRight" || event.key === "ArrowUp") commitKeyboardValue(value + 2)
          else if (event.key === "Home") commitKeyboardValue(0)
          else if (event.key === "End") commitKeyboardValue(100)
          else return
          event.preventDefault()
        }}
        onPointerDown={(event) => {
          if (disabled) return
          dragging.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          onDragStart?.()
          updateFromPointer(event.clientX)
          void animate(interactionScale, 1.055, { type: "spring", stiffness: 430, damping: 28 })
        }}
        onPointerMove={(event) => {
          if (dragging.current) updateFromPointer(event.clientX)
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={finishDrag}
      >
        <span className="elastic-volume-value" style={{ left: `${value}%` }}>{muted ? "静音" : value}</span>
        <motion.div
          className="elastic-volume-track-shell"
          style={{
            scaleX: trackScaleX,
            scaleY: trackScaleY,
            transformOrigin: region === "left" ? "right center" : "left center"
          }}
        >
          <div className="elastic-volume-track">
            <motion.div className="elastic-volume-range" animate={{ width: `${muted ? 0 : value}%` }} transition={{ duration: 0.08 }} />
            <span className="elastic-volume-sheen" />
          </div>
        </motion.div>
      </div>

      <motion.button
        type="button"
        className="volume-icon-button"
        aria-label="将音量调到最大"
        disabled={disabled}
        style={{ x: rightShift }}
        animate={{ scale: region === "right" ? [1, 1.28, 1] : 1 }}
        transition={{ duration: 0.24 }}
        onClick={() => commitKeyboardValue(100)}
      >
        <VolumeGlyph loud />
      </motion.button>
    </motion.div>
  )
}
