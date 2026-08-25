import type { LyricLine, LyricPayload, MediaTrack } from "../../shared/types"

export interface LyricSource {
  fetch(track: MediaTrack): Promise<LyricPayload | null>
}

interface LrclibRecord {
  trackName?: string
  artistName?: string
  duration?: number
  syncedLyrics?: string | null
}

interface NeteaseSong {
  id: number
  name?: string
  artists?: Array<{ name?: string }>
  ar?: Array<{ name?: string }>
  duration?: number
  dt?: number
}

interface NeteaseSearchResponse {
  result?: { songs?: NeteaseSong[] }
}

interface NeteaseLyricResponse {
  lrc?: { lyric?: string }
  tlyric?: { lyric?: string }
}

interface NeteaseSongDetailResponse {
  songs?: Array<{
    album?: { name?: string; picUrl?: string; blurPicUrl?: string }
    al?: { name?: string; picUrl?: string }
  }>
}

const DEMO_LIBRARY: Record<string, LyricLine[]> = {
  "周杰伦|晴天": [
    { timeMs: 0, text: "故事的小黄花", translation: "A little yellow flower from the story" },
    { timeMs: 3500, text: "从出生那年就飘着", translation: "Has been drifting since the year I was born" },
    { timeMs: 7200, text: "童年的荡秋千", translation: "The swing from childhood" },
    { timeMs: 10800, text: "随记忆一直晃到现在", translation: "Has been swaying in memory until now" }
  ]
}

const REQUEST_TIMEOUT_MS = 5500
const CACHE_LIMIT = 100

function keyOf(track: MediaTrack): string {
  return `${track.artist}|${track.title}`
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function cleanTitle(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s*[（(\[].*?(?:live|remaster(?:ed)?|version|edit|mix|伴奏|现场|翻唱|纯音乐).*?[）)\]]\s*/gi, " ")
    .replace(/\s*[-–—]\s*(?:live|remaster(?:ed)?(?:\s+\d{4})?|radio edit|single version|album version|现场版|伴奏版).*$/gi, "")
    .replace(/\s+(?:feat\.?|ft\.?)\s+.+$/gi, "")
    .replace(/\s+/g, " ")
    .trim()
}

function cleanArtist(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+(?:feat\.?|ft\.?)\s+.+$/gi, "")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeForMatch(value: string): string {
  return cleanTitle(value)
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
}

function textSimilarity(left: string, right: string): number {
  const a = normalizeForMatch(left)
  const b = normalizeForMatch(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length)

  const pairs = (value: string): Set<string> => {
    if (value.length < 2) return new Set([value])
    const result = new Set<string>()
    for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2))
    return result
  }
  const aPairs = pairs(a)
  const bPairs = pairs(b)
  let overlap = 0
  for (const pair of aPairs) if (bPairs.has(pair)) overlap += 1
  return (2 * overlap) / (aPairs.size + bPairs.size)
}

function scoreRecord(record: LrclibRecord, track: MediaTrack): number {
  if (!record.syncedLyrics) return Number.NEGATIVE_INFINITY
  const titleScore = textSimilarity(record.trackName || "", track.title)
  const artistScore = textSimilarity(record.artistName || "", track.artist)
  const targetDuration = track.durationMs > 0 ? track.durationMs / 1000 : 0
  const durationDiff = targetDuration && record.duration ? Math.abs(targetDuration - record.duration) : 0
  const durationScore = targetDuration && record.duration ? Math.max(-0.5, 1 - durationDiff / 12) : 0.35
  return titleScore * 5 + artistScore * 3 + durationScore * 2
}

async function requestJson<T>(url: URL, init: RequestInit = {}): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        "User-Agent": "top-island/0.1 (Windows synchronized lyrics)",
        ...init.headers
      },
      signal: controller.signal
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function toPayload(track: MediaTrack, record: LrclibRecord | null): LyricPayload | null {
  if (!record?.syncedLyrics) return null
  const lines = parseLrc(record.syncedLyrics)
  if (!lines.length) return null
  return {
    trackKey: keyOf(track),
    lines,
    durationMs: record.duration ? Math.round(record.duration * 1000) : undefined
  }
}

export class LocalLyricSource implements LyricSource {
  async fetch(track: MediaTrack): Promise<LyricPayload | null> {
    const key = keyOf(track)
    const lines = DEMO_LIBRARY[key]
    if (!lines) return null
    return { trackKey: key, lines }
  }
}

/** 网易云公开网页接口对中文曲库命中率较高，同时也可为其他播放器补充歌词。 */
export class NeteaseLyricSource implements LyricSource {
  async fetch(track: MediaTrack): Promise<LyricPayload | null> {
    const searchUrl = new URL("https://music.163.com/api/search/get")
    const body = new URLSearchParams({
      s: `${cleanTitle(track.title)} ${cleanArtist(track.artist)}`,
      type: "1",
      limit: "8",
      offset: "0"
    })
    const search = await requestJson<NeteaseSearchResponse>(searchUrl, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Referer: "https://music.163.com/"
      }
    })
    const songs = search?.result?.songs || []
    const best = songs
      .map((song) => {
        const artist = (song.artists || song.ar || []).map((item) => item.name || "").filter(Boolean).join(", ")
        const record: LrclibRecord = {
          trackName: song.name,
          artistName: artist,
          duration: (song.duration || song.dt || 0) / 1000,
          syncedLyrics: "pending"
        }
        return { song, artist, score: scoreRecord(record, track) }
      })
      .filter(({ song, artist }) =>
        Boolean(song.id) &&
        textSimilarity(song.name || "", track.title) >= 0.55 &&
        (!artist || textSimilarity(artist, track.artist) >= 0.28)
      )
      .sort((left, right) => right.score - left.score)[0]
    if (!best) return null

    const lyricUrl = new URL("https://music.163.com/api/song/lyric")
    lyricUrl.searchParams.set("id", String(best.song.id))
    lyricUrl.searchParams.set("lv", "1")
    lyricUrl.searchParams.set("kv", "1")
    lyricUrl.searchParams.set("tv", "1")
    const detailUrl = new URL("https://music.163.com/api/song/detail/")
    detailUrl.searchParams.set("ids", JSON.stringify([best.song.id]))

    const [lyric, detail] = await Promise.all([
      requestJson<NeteaseLyricResponse>(lyricUrl, {
        headers: { Referer: "https://music.163.com/" }
      }),
      requestJson<NeteaseSongDetailResponse>(detailUrl, {
        headers: { Referer: "https://music.163.com/" }
      })
    ])
    const lines = attachTranslations(
      lyric?.lrc?.lyric ? parseLrc(lyric.lrc.lyric) : [],
      lyric?.tlyric?.lyric ? parseLrc(lyric.tlyric.lyric) : []
    )
    const album = detail?.songs?.[0]?.album || detail?.songs?.[0]?.al
    const artwork = (album?.picUrl || album?.blurPicUrl)?.replace(/^http:/, "https:")
    if (!lines.length && !artwork) return null
    return {
      trackKey: keyOf(track),
      lines,
      durationMs: best.song.duration || best.song.dt,
      artwork,
      album: album?.name
    }
  }
}

/** 先精确查询 LRCLIB，失败后用清洗过的歌名和歌手搜索并选择最接近的同步歌词。 */
export class LrclibLyricSource implements LyricSource {
  async fetch(track: MediaTrack): Promise<LyricPayload | null> {
    const titles = unique([track.title, cleanTitle(track.title)])
    const artists = unique([
      track.artist,
      cleanArtist(track.artist),
      cleanArtist(track.artist).split(/\s*(?:[,&/、，]|\band\b)\s*/i)[0]
    ])

    const exactCandidates = unique([
      `${titles[0]}\n${artists[0]}`,
      `${titles.at(-1) || titles[0]}\n${artists.at(-1) || artists[0]}`
    ])
    for (const candidate of exactCandidates) {
      const [title, artist] = candidate.split("\n")
      const url = new URL("https://lrclib.net/api/get")
      url.searchParams.set("track_name", title)
      url.searchParams.set("artist_name", artist)
      if (track.album) url.searchParams.set("album_name", track.album)
      if (track.durationMs) url.searchParams.set("duration", String(Math.round(track.durationMs / 1000)))
      const payload = toPayload(track, await requestJson<LrclibRecord>(url))
      if (payload) return payload
    }

    const searchUrl = new URL("https://lrclib.net/api/search")
    searchUrl.searchParams.set("track_name", titles.at(-1) || track.title)
    searchUrl.searchParams.set("artist_name", artists.at(-1) || track.artist)
    const records = await requestJson<LrclibRecord[]>(searchUrl)
    if (!Array.isArray(records)) return null

    const best = records
      .filter((record) => Boolean(record.syncedLyrics) && textSimilarity(record.trackName || "", track.title) >= 0.45)
      .sort((left, right) => scoreRecord(right, track) - scoreRecord(left, track))[0]
    return toPayload(track, best || null)
  }
}

export class CompositeLyricSource implements LyricSource {
  private readonly chain: LyricSource[] = [new LocalLyricSource(), new NeteaseLyricSource(), new LrclibLyricSource()]
  private readonly cache = new Map<string, Promise<LyricPayload>>()

  fetch(track: MediaTrack): Promise<LyricPayload> {
    const key = keyOf(track)
    const cached = this.cache.get(key)
    if (cached) return cached

    const pending = this.fetchUncached(track)
    this.cache.set(key, pending)
    if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value as string)
    return pending
  }

  private async fetchUncached(track: MediaTrack): Promise<LyricPayload> {
    let metadata: Pick<LyricPayload, "artwork" | "album" | "durationMs"> = {}
    for (const source of this.chain) {
      const payload = await source.fetch(track).catch(() => null)
      if (!payload) continue
      metadata = {
        artwork: metadata.artwork || payload.artwork,
        album: metadata.album || payload.album,
        durationMs: metadata.durationMs || payload.durationMs
      }
      if (payload.lines.length) return { ...metadata, ...payload }
    }
    return {
      trackKey: keyOf(track),
      lines: [{ timeMs: 0, text: `${track.artist} · ${track.title}` }],
      ...metadata
    }
  }
}

export function parseLrc(raw: string): LyricLine[] {
  const offsetMatch = raw.match(/^\[offset:([+-]?\d+)\]/im)
  const offset = offsetMatch ? Number(offsetMatch[1]) : 0
  const grouped = new Map<number, string[]>()

  for (const row of raw.split(/\r?\n/)) {
    const matches = [...row.matchAll(/\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)]
    if (!matches.length) continue
    const text = row.slice((matches.at(-1)?.index || 0) + (matches.at(-1)?.[0].length || 0)).trim()
    if (!text) continue

    for (const match of matches) {
      const min = Number(match[1])
      const sec = Number(match[2])
      const frac = match[3] ? Number(match[3].padEnd(3, "0").slice(0, 3)) : 0
      const timeMs = Math.max(0, min * 60000 + sec * 1000 + frac + offset)
      const texts = grouped.get(timeMs) || []
      if (!texts.includes(text)) texts.push(text)
      grouped.set(timeMs, texts)
    }
  }

  return [...grouped.entries()]
    .map(([timeMs, texts]) => ({ timeMs, text: texts[0], translation: texts[1] }))
    .sort((left, right) => left.timeMs - right.timeMs)
}

export function attachTranslations(lines: LyricLine[], translated: LyricLine[]): LyricLine[] {
  if (!lines.length || !translated.length) return lines
  return lines.map((line) => {
    if (line.translation) return line
    let best: LyricLine | undefined
    let bestDiff = 420
    for (const item of translated) {
      const diff = Math.abs(item.timeMs - line.timeMs)
      if (diff <= bestDiff) {
        best = item
        bestDiff = diff
      }
    }
    return best ? { ...line, translation: best.text } : line
  })
}
