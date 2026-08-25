import { AnimatePresence, motion } from "motion/react"
import type { IslandState, LyricLine } from "../../../shared/types"

function lyricKey(line: LyricLine | null, slot: string): string {
  return line ? `${line.timeMs}:${line.text}` : `empty:${slot}`
}

function LyricBoard({
  previous,
  current,
  next,
  showTranslation,
  placeholder
}: {
  previous: LyricLine | null
  current: LyricLine | null
  next: LyricLine | null
  showTranslation: boolean
  placeholder: string
}) {
  const shownCurrent = current ?? { timeMs: -1, text: placeholder }
  const rows: Array<{ line: LyricLine | null; role: "near" | "current"; slot: string }> = [
    { line: previous, role: "near", slot: "prev" },
    { line: shownCurrent, role: "current", slot: "curr" },
    { line: next, role: "near", slot: "next" }
  ]

  return (
    <div className="lyric-stack">
      <AnimatePresence initial={false} mode="popLayout">
        {rows.map((row) => (
          <motion.div
            key={lyricKey(row.line, row.slot)}
            layout="position"
            className={`lyric-row is-${row.role}${row.line?.text ? "" : " is-empty"}`}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -18 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="lyric-text">{row.line?.text || " "}</div>
            {showTranslation && row.line?.translation ? <div className="lyric-trans">{row.line.translation}</div> : null}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function MediaPage({ state }: { state: IslandState }) {
  const track = state.track
  const playing = track?.status === "playing"
  const hasTrack = Boolean(track?.title)

  return (
    <section className={`media-page${playing ? " is-playing" : ""}`} aria-label="媒体页面">
      <div className={`album-art spotlight-card${playing ? " spinning" : ""}`} aria-hidden="true">
        {track?.artwork ? <img src={track.artwork} alt="" /> : <span>♫</span>}
        <div className="album-glow" />
      </div>
      <div className="media-copy">
        <div className="media-copy-top">
          <div className="page-eyebrow">{track?.status === "paused" ? "PAUSED" : "NOW PLAYING"}</div>
          {track?.appName ? <div className="media-source">{track.appName}</div> : null}
        </div>
        <h2>{track?.title || "还没有正在播放的音乐"}</h2>
        <p>{track?.artist || "打开网易云音乐或其他播放器"}</p>
      </div>

      <div className="lyric-card spotlight-card">
        <button
          type="button"
          className={`lyric-translate-toggle${state.settings.lyricsTranslationEnabled ? " active" : ""}`}
          aria-pressed={state.settings.lyricsTranslationEnabled}
          aria-label="显示歌词翻译"
          onClick={(event) => {
            event.stopPropagation()
            void window.island.setLyricsTranslationEnabled(!state.settings.lyricsTranslationEnabled)
          }}
        >
          译
        </button>
        <LyricBoard
          previous={state.lyricWindow.previous}
          current={state.lyricWindow.current}
          next={state.lyricWindow.next}
          showTranslation={state.settings.lyricsTranslationEnabled}
          placeholder={playing ? "正在匹配同步歌词…" : "播放音乐后会自动显示歌词"}
        />
      </div>

      <div className="media-controls">
        <button type="button" disabled={!hasTrack} aria-label="上一首" onClick={() => void window.island.mediaPrev()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h2.2v12H6V6Zm3.2 6L18 18V6l-8.8 6Z" /></svg>
        </button>
        <button
          type="button"
          className="media-play"
          disabled={!hasTrack}
          aria-label={playing ? "暂停" : "播放"}
          onClick={() => void window.island.mediaPlayPause()}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6h3.4v12H7V6Zm6.6 0H17v12h-3.4V6Z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.8v12.4L18.4 12 8 5.8Z" /></svg>
          )}
        </button>
        <button type="button" disabled={!hasTrack} aria-label="下一首" onClick={() => void window.island.mediaNext()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.8 6H18v12h-2.2V6ZM6 18l8.8-6L6 6v12Z" /></svg>
        </button>
      </div>
    </section>
  )
}
