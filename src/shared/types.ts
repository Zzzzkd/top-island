export type IslandMode = "hidden" | "peek" | "compact" | "notify" | "lyrics"

export interface NotificationEvent {
  id: string
  appId: string
  appName: string
  title: string
  body: string
  at: number
}

export interface MediaTrack {
  title: string
  artist: string
  album?: string
  appName?: string
  status: "playing" | "paused" | "stopped"
  positionMs: number
  durationMs: number
}

export interface LyricLine {
  timeMs: number
  text: string
}

export interface LyricPayload {
  trackKey: string
  lines: LyricLine[]
}

export type AiProvider = "cursor" | "codex"

export interface IslandChatMessage {
  role: "user" | "assistant"
  text: string
}

export interface AiState {
  provider: AiProvider
  prompt: string
  reply: string
  messages: IslandChatMessage[]
  busy: boolean
  chatTitle: string
  chats: string[]
}

export interface IslandState {
  mode: IslandMode
  hide: number
  large: boolean
  notification: NotificationEvent | null
  track: MediaTrack | null
  lyric: string
  ai: AiState
}

export const IPC = {
  getState: "island:get-state",
  setMode: "island:set-mode",
  hover: "island:hover",
  toggleLarge: "island:toggle-large",
  collapseOutside: "island:collapse-outside",
  stateChanged: "island:state",
  demoNotify: "island:demo-notify",
  demoLyric: "island:demo-lyric",
  askAi: "island:ask-ai",
  attachImage: "island:attach-image",
  pickImage: "island:pick-image",
  saveTempImage: "island:save-temp-image",
  previewImage: "island:preview-image",
  setAiProvider: "island:set-ai-provider",
  selectChat: "island:select-chat"
} as const

/** 对齐 WinIsland：固定画布，岛在内部滑动，不靠改窗口大小做半隐藏。 */
export const CANVAS = { width: 520, height: 300 }
export const TOP_OFFSET = 8
export const HIDDEN_SLIVER = 7
export const PANEL_SIZE = { width: 440, height: 328 }

export const PILL_SIZE: Record<IslandMode, { width: number; height: number }> = {
  hidden: { width: 120, height: 28 },
  peek: { width: 120, height: 28 },
  compact: { width: 120, height: 28 },
  notify: { width: 360, height: 72 },
  lyrics: { width: 420, height: 52 }
}

export function currentPillSize(mode: IslandMode, large: boolean): { width: number; height: number } {
  return large ? PANEL_SIZE : PILL_SIZE[mode]
}

export function isExpandedMode(mode: IslandMode): boolean {
  return mode === "compact" || mode === "notify" || mode === "lyrics"
}

export function hideTarget(mode: IslandMode): number {
  if (mode === "hidden") return 1.15
  if (mode === "peek") return 1
  return 0
}

export function pillSlideY(mode: IslandMode, hide: number, large = false): number {
  if (large) return 0
  const height = PILL_SIZE[mode].height
  const sliver = mode === "hidden" ? 1 : HIDDEN_SLIVER
  return -hide * (height - sliver)
}

export function pillHitRect(
  mode: IslandMode,
  hide: number,
  large = false
): { x: number; y: number; width: number; height: number } {
  const size = currentPillSize(mode, large)
  const y = TOP_OFFSET + pillSlideY(mode, hide, large)
  return {
    x: (CANVAS.width - size.width) / 2,
    y,
    width: size.width,
    height: size.height
  }
}

/** 展开后把岛上方到屏幕顶的空隙算进悬停，避免在缝里反复收回/弹出。 */
export function hoverHitRect(
  mode: IslandMode,
  hide: number,
  large = false
): { x: number; y: number; width: number; height: number } {
  const pill = pillHitRect(mode, hide, large)
  const top = hide > 0.5 ? Math.max(0, pill.y) : 0
  const bottom = pill.y + pill.height
  return {
    x: pill.x,
    y: top,
    width: pill.width,
    height: Math.max(1, bottom - top)
  }
}
