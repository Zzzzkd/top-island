import type { LyricLine, LyricPayload, MediaTrack } from "../../shared/types"

export interface LyricSource {
  fetch(track: MediaTrack): Promise<LyricPayload | null>
}

const DEMO_LIBRARY: Record<string, LyricLine[]> = {
  "周杰伦|晴天": [
    { timeMs: 0, text: "故事的小黄花" },
    { timeMs: 3500, text: "从出生那年就飘着" },
    { timeMs: 7200, text: "童年的荡秋千" },
    { timeMs: 10800, text: "随记忆一直晃到现在" }
  ]
}

function keyOf(track: MediaTrack): string {
  return `${track.artist}|${track.title}`
}

export class LocalLyricSource implements LyricSource {
  async fetch(track: MediaTrack): Promise<LyricPayload | null> {
    const key = keyOf(track)
    const lines = DEMO_LIBRARY[key]
    if (!lines) return null
    return { trackKey: key, lines }
  }
}

/** 可在这里换成 LRCLIB / 网易云等接口。失败时退回歌名。 */
export class LrclibLyricSource implements LyricSource {
  async fetch(track: MediaTrack): Promise<LyricPayload | null> {
    const url = new URL("https://lrclib.net/api/get")
    url.searchParams.set("track_name", track.title)
    url.searchParams.set("artist_name", track.artist)
    if (track.durationMs) url.searchParams.set("duration", String(Math.round(track.durationMs / 1000)))
    try {
      const res = await fetch(url, { headers: { "User-Agent": "top-island/0.1" } })
      if (!res.ok) return null
      const data = (await res.json()) as { syncedLyrics?: string | null }
      if (!data.syncedLyrics) return null
      return { trackKey: keyOf(track), lines: parseLrc(data.syncedLyrics) }
    } catch {
      return null
    }
  }
}

export class CompositeLyricSource implements LyricSource {
  private readonly chain: LyricSource[] = [new LocalLyricSource(), new LrclibLyricSource()]

  async fetch(track: MediaTrack): Promise<LyricPayload | null> {
    for (const source of this.chain) {
      const payload = await source.fetch(track)
      if (payload?.lines.length) return payload
    }
    return {
      trackKey: keyOf(track),
      lines: [{ timeMs: 0, text: `${track.artist} · ${track.title}` }]
    }
  }
}

function parseLrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const row of raw.split(/\r?\n/)) {
    const match = row.match(/\[(\d+):(\d+)(?:\.(\d+))?\](.*)/)
    if (!match) continue
    const min = Number(match[1])
    const sec = Number(match[2])
    const frac = match[3] ? Number(match[3].padEnd(3, "0").slice(0, 3)) : 0
    const text = match[4].trim()
    if (!text) continue
    lines.push({ timeMs: min * 60000 + sec * 1000 + frac, text })
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs)
}
