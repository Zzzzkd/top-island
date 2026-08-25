import { BrowserWindow, app, dialog, nativeImage, screen } from "electron"
import { randomBytes } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AiProvider, IslandChatMessage, IslandMode, IslandState, LyricLine, LyricWindow, MediaTrack, NotificationEvent } from "../shared/types"
import { listCursorChats, peekCursorWindow, readCursorReply, selectCursorChat } from "./ai/cursorWindow"
import { sendToLocalApp } from "./ai/localApps"
import { IPC, hideTarget, hoverHitRect } from "../shared/types"
import type { MediaSource } from "./sources/media"
import type { NotificationSource } from "./sources/notifications"
import type { LyricSource } from "./sources/lyrics"
import { sendMediaCommand } from "./mediaControl"

interface Sources {
  notify: NotificationSource
  media: MediaSource
  lyrics: LyricSource
}

const NOTIFY_HOLD_MS = 5200
const HOVER_COLLAPSE_MS = 220
const CURSOR_MS = 32

function emptyLyricWindow(): LyricWindow {
  return { previous: null, current: null, next: null, index: -1 }
}

export class IslandController {
  private mode: IslandMode = "peek"
  private hide = 1
  private userPinned: IslandMode | null = "peek"
  private notification: NotificationEvent | null = null
  private track: MediaTrack | null = null
  private trackKey = ""
  private trackOrigin = 0
  private trackBasePos = 0
  private heldStatus: { key: string; status: "playing" | "paused"; until: number } | null = null
  private lyric = ""
  private lyricIndex = -1
  private lines: LyricLine[] = []
  private lyricsTranslationEnabled = true
  private notifyTimer: NodeJS.Timeout | null = null
  private lyricTimer: NodeJS.Timeout | null = null
  private lyricFetchKey = ""
  private lastLyricPositionBucket = -1
  private hoverExpanded = false
  private large = false
  private hoverLeaveTimer: NodeJS.Timeout | null = null
  private cursorTimer: NodeJS.Timeout | null = null
  private lastOverPill = false
  private floatingLyricsEnabled = true
  private aiProvider: AiProvider = "cursor"
  private aiPrompt = ""
  private aiReply = "发给当前打开的 Cursor 窗口，回复同步回岛上。"
  private aiBusy = false
  private aiChatTitle = ""
  private aiChats: string[] = []
  private threads: Record<string, IslandChatMessage[]> = {}
  private lastCursorStamp = ""
  private persistTimer: NodeJS.Timeout | null = null
  private syncTimer: NodeJS.Timeout | null = null
  private syncing = false

  constructor(
    private readonly win: BrowserWindow,
    private readonly sources: Sources
  ) {}

  start(): void {
    this.loadSettings()
    this.sources.notify.onNotification((event) => this.showNotification(event))
    this.sources.notify.onAccess?.((access) => {
      if (access !== "Allowed") {
        this.showNotification({
          id: "access-denied",
          appId: "system",
          appName: "系统",
          title: "需要通知权限",
          body: "总开关已开还不够。等应用列表加载完，打开 Top Island 或 Windows PowerShell",
          at: Date.now()
        })
      }
    })
    this.sources.media.onTrack((track) => this.onTrack(track))
    this.sources.notify.start()
    this.sources.media.start()
    this.placeCanvas()
    screen.on("display-metrics-changed", () => this.placeCanvas())
    this.win.setIgnoreMouseEvents(true, { forward: true })
    this.cursorTimer = setInterval(() => this.syncCursor(), CURSOR_MS)
    this.syncTimer = setInterval(() => void this.syncCursorChat(), 2200)
    this.loadChat()
    void this.syncCursorChat(true)
    this.pushState()
  }

  getState(): IslandState {
    return {
      mode: this.mode,
      hide: this.hide,
      large: this.large,
      notification: this.notification,
      track: this.track,
      lyric: this.lyric,
      lyricWindow: this.buildLyricWindow(),
      settings: {
        floatingLyricsEnabled: this.floatingLyricsEnabled,
        lyricsTranslationEnabled: this.lyricsTranslationEnabled
      },
      ai: {
        provider: this.aiProvider,
        prompt: this.aiPrompt,
        reply: this.aiReply,
        messages: this.currentMessages(),
        busy: this.aiBusy,
        chatTitle: this.aiChatTitle,
        chats: this.aiChats
      }
    }
  }

  setAiProvider(provider: AiProvider): void {
    this.aiProvider = provider
    this.pushState()
  }

  setLyricsTranslationEnabled(enabled: boolean): void {
    if (this.lyricsTranslationEnabled === enabled) return
    this.lyricsTranslationEnabled = enabled
    this.saveSettings()
    this.pushState()
  }

  setFloatingLyricsEnabled(enabled: boolean): void {
    if (this.floatingLyricsEnabled === enabled) return
    this.floatingLyricsEnabled = enabled
    this.saveSettings()
    if (!this.large && !this.notification) {
      if (enabled && this.track?.status === "playing") this.presentNowPlaying()
      else if (!enabled && this.mode === "lyrics") this.restoreIdle()
      else this.pushState()
      return
    }
    this.pushState()
  }

  async selectChat(title: string): Promise<void> {
    if (!title || this.aiBusy) return
    this.aiChatTitle = title
    this.pushState()
    const selected = await selectCursorChat(title)
    if (selected.chatTitle) this.aiChatTitle = selected.chatTitle
    if (selected.chats?.length) this.mergeChats(selected.chats, this.aiChatTitle)
    const last = await readCursorReply()
    if (last.reply) {
      this.aiReply = last.reply
      if (last.stamp) this.lastCursorStamp = last.stamp
      const msgs = this.currentMessages()
      if (msgs.length === 0) this.setMessages([{ role: "assistant", text: last.reply }])
      else this.patchLastAssistant(last.reply)
    }
    this.pushState()
  }

  private mergeChats(chats: string[], current?: string): void {
    const next = [...chats]
    if (current && !next.includes(current)) next.unshift(current)
    this.aiChats = next
  }

  private async syncCursorChat(forceList = false): Promise<void> {
    if (this.aiBusy || this.syncing) return
    this.syncing = true
    try {
      const peek = await peekCursorWindow()
      if (!peek.ok) return
      if (peek.chatTitle && peek.chatTitle !== this.aiChatTitle) {
        this.aiChatTitle = peek.chatTitle
        this.mergeChats(this.aiChats, peek.chatTitle)
      }
      if (this.aiBusy && peek.reply && peek.reply !== this.aiReply) {
        this.aiReply = peek.reply
        this.patchLastAssistant(peek.reply)
      }
      if (peek.stamp && peek.stamp !== this.lastCursorStamp) {
        const last = await readCursorReply()
        if (last.ok && last.reply) {
          this.aiReply = last.reply
          this.lastCursorStamp = peek.stamp
          this.patchLastAssistant(last.reply)
        }
      }
      if (forceList || this.aiChats.length === 0) {
        const listed = await listCursorChats()
        if (listed.ok) {
          if (listed.chatTitle) this.aiChatTitle = listed.chatTitle
          this.mergeChats(listed.chats || [], this.aiChatTitle)
        }
      }
      this.pushState()
    } catch {
      // keep last known chat state
    } finally {
      this.syncing = false
    }
  }

  async askAi(prompt: string, imagePath?: string): Promise<void> {
    if (this.aiBusy) return
    this.large = true
    this.hide = 0
    this.placeCanvas()
    this.aiBusy = true
    this.aiPrompt = prompt.trim() || (imagePath ? "图片" : "")
    this.aiReply = "正在回复…"
    this.appendMessage({ role: "user", text: this.aiPrompt })
    this.appendMessage({ role: "assistant", text: "正在回复…" })
    this.pushState()
    try {
      this.aiReply = await sendToLocalApp(
        this.aiProvider,
        prompt,
        (text) => {
          this.aiReply = text
          this.patchLastAssistant(text)
          this.pushState()
        },
        imagePath,
        this.aiChatTitle
      )
      this.patchLastAssistant(this.aiReply)
    } catch (error) {
      this.aiReply = error instanceof Error ? error.message : "分析失败"
      this.patchLastAssistant(this.aiReply)
    } finally {
      this.aiBusy = false
      this.pushState()
    }
  }

  async attachImage(caption?: string): Promise<void> {
    const picked = await this.pickImage()
    if (!picked) return
    await this.askAi(caption?.trim() || "", picked.path)
  }

  async pickImage(): Promise<{ path: string; preview: string } | null> {
    const picked = await dialog.showOpenDialog(this.win, {
      title: "选择要发给当前 Cursor 会话的图片",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return null
    const path = picked.filePaths[0]
    const preview = nativeImage.createFromPath(path).resize({ width: 72, height: 72 }).toDataURL()
    return { path, preview }
  }

  async saveTempImage(payload: { mime: string; data: ArrayBuffer }): Promise<{ path: string; preview: string }> {
    const ext = payload.mime.includes("png")
      ? "png"
      : payload.mime.includes("webp")
        ? "webp"
        : payload.mime.includes("gif")
          ? "gif"
          : "png"
    const path = join(tmpdir(), `top-island-${randomBytes(6).toString("hex")}.${ext}`)
    await writeFile(path, Buffer.from(payload.data))
    const preview = nativeImage.createFromPath(path).resize({ width: 96, height: 96 }).toDataURL()
    return { path, preview }
  }

  previewImage(path: string): string {
    return nativeImage.createFromPath(path).toDataURL()
  }

  setUserMode(mode: IslandMode): void {
    this.hoverExpanded = false
    this.large = false
    this.clearHoverLeave()
    this.userPinned = mode === "notify" || mode === "lyrics" ? null : mode
    this.setMode(mode)
    this.syncCursor(true)
  }

  toggleLarge(): void {
    this.large = !this.large
    if (this.large) {
      this.hide = 0
      if (this.mode === "peek" || this.mode === "hidden") {
        this.mode = "compact"
      }
    } else {
      this.restoreIdle()
      this.syncCursor(true)
      return
    }
    this.placeCanvas()
    this.pushState()
    this.syncCursor(true)
  }

  collapseOutside(): void {
    if (!this.large && !this.hoverExpanded) return
    this.large = false
    this.hoverExpanded = false
    this.clearHoverLeave()
    this.restoreIdle()
    this.syncCursor(true)
  }

  setHover(hovering: boolean): void {
    if (hovering) {
      this.clearHoverLeave()
      if (this.mode === "peek" || this.mode === "hidden") {
        this.hoverExpanded = true
        this.setMode("compact")
      }
      return
    }

    this.clearHoverLeave()
    this.hoverLeaveTimer = setTimeout(() => {
      if (this.large) return
      if (!this.hoverExpanded || this.mode !== "compact") return
      if (this.pointOverPill()) return
      this.hoverExpanded = false
      this.setMode(this.userPinned === "hidden" ? "hidden" : "peek")
    }, HOVER_COLLAPSE_MS)
  }

  presentNotification(event: NotificationEvent): void {
    this.showNotification(event)
  }

  emitDemoNotification(): void {
    this.showNotification({
      id: `demo-${Date.now()}`,
      appId: "WeChat",
      appName: "微信",
      title: "小明",
      body: "晚上一起吃饭吗？",
      at: Date.now()
    })
  }

  emitDemoLyric(): void {
    this.onTrack({
      title: "晴天",
      artist: "周杰伦",
      status: "playing",
      positionMs: 0,
      durationMs: 269000,
      appName: "demo"
    })
    this.lines = [
      { timeMs: 0, text: "故事的小黄花" },
      { timeMs: 3500, text: "从出生那年就飘着" },
      { timeMs: 7200, text: "童年的荡秋千" },
      { timeMs: 10800, text: "随记忆一直晃到现在" }
    ]
    this.lyric = this.lines[0].text
    this.lyricIndex = 0
    this.startLyricClock()
    this.presentNowPlaying()
  }

  private showNotification(event: NotificationEvent): void {
    this.large = false
    this.notification = event
    this.mode = "notify"
    this.hide = 0
    this.placeCanvas()
    this.pushState()
    this.syncCursor(true)
    if (this.notifyTimer) clearTimeout(this.notifyTimer)
    this.notifyTimer = setTimeout(() => {
      this.notification = null
      this.restoreIdle()
    }, NOTIFY_HOLD_MS)
  }

  async controlMedia(command: "playpause" | "next" | "prev"): Promise<void> {
    const commandTrack = this.track
    if (command === "playpause" && commandTrack) {
      const previousStatus = commandTrack.status
      const status = previousStatus === "playing" ? "paused" : "playing"
      const position = this.currentPosition()
      this.heldStatus = {
        key: `${commandTrack.artist}|${commandTrack.title}`,
        status,
        until: Date.now() + 1800
      }
      this.track = { ...commandTrack, status, positionMs: position }
      this.trackBasePos = position
      this.trackOrigin = Date.now()
      this.pushState()
      if (status === "playing") this.presentNowPlaying()
      else if (this.mode === "lyrics") this.restoreIdle()

      const result = await sendMediaCommand(command, commandTrack)
      if (!result.ok && this.trackKey === `${commandTrack.artist}|${commandTrack.title}` && this.track) {
        this.heldStatus = null
        this.track = { ...this.track, status: previousStatus, positionMs: position }
        this.trackBasePos = position
        this.trackOrigin = Date.now()
        this.pushState()
      }
      return
    }

    if (command === "next" || command === "prev") {
      this.heldStatus = null
    }
    await sendMediaCommand(command, commandTrack)
  }

  private onTrack(track: MediaTrack | null): void {
    const nextKey = track ? `${track.artist}|${track.title}` : ""
    const prevStatus = this.track?.status
    const now = Date.now()
    if (this.heldStatus && (now >= this.heldStatus.until || (nextKey && nextKey !== this.heldStatus.key))) {
      this.heldStatus = null
    }
    const sameSong = nextKey !== "" && nextKey === this.trackKey
    const songChanged = nextKey !== this.trackKey

    // 播放器的后续进度事件经常不再携带封面，保留当前歌曲已经补全的媒体信息。
    if (track && sameSong && this.track) {
      track = {
        ...track,
        durationMs: track.durationMs || this.track.durationMs,
        artwork: track.artwork || this.track.artwork,
        album: track.album || this.track.album,
        positionSource: track.positionSource || this.track.positionSource
      }
    }

    if (track && this.heldStatus && nextKey === this.heldStatus.key) {
      if (track.status === this.heldStatus.status) {
        // 播放器已确认刚才的播放/暂停操作，立即恢复以真实状态为准。
        this.heldStatus = null
      } else {
        track = { ...track, status: this.heldStatus.status }
      }
    }

    if (
      track &&
      sameSong &&
      track.positionSource === "estimated" &&
      (track.positionMs || 0) === 0 &&
      this.track &&
      this.track.positionMs > 1500
    ) {
      track = { ...track, positionMs: this.track.positionMs }
    }

    this.track = track
    this.trackBasePos = track?.positionMs ?? 0
    this.trackOrigin = now

    if (!this.track) {
      this.trackKey = ""
      this.lyricFetchKey = ""
      this.lines = []
      this.lyric = ""
      this.lyricIndex = -1
      this.lastLyricPositionBucket = -1
      this.pushState()
      this.restoreIdle()
      return
    }

    this.trackKey = nextKey
    if (songChanged) {
      this.lines = []
      this.lyric = `${this.track.artist} · ${this.track.title}`
      this.lyricIndex = -1
      this.lyricFetchKey = ""
      this.lastLyricPositionBucket = -1
    }
    this.pushState()

    if (this.track.status !== "playing") {
      if (this.mode === "lyrics") this.restoreIdle()
      this.fetchTrackExtras(nextKey)
      return
    }

    const started = prevStatus !== "playing"
    this.startLyricClock()
    if (songChanged || started) this.presentNowPlaying()
    this.fetchTrackExtras(nextKey)
  }

  private fetchTrackExtras(nextKey: string): void {
    if (this.lyricFetchKey === nextKey) return
    this.lyricFetchKey = nextKey
    const lyricTrack = this.track
    if (!lyricTrack) return
    void this.sources.lyrics.fetch(lyricTrack).then((payload) => {
      if (this.trackKey !== nextKey || this.lyricFetchKey !== nextKey) return
      this.lines = payload?.lines ?? []
      if (this.track && payload) {
        this.track = {
          ...this.track,
          durationMs: this.track.durationMs || payload.durationMs || 0,
          artwork: this.track.artwork || payload.artwork,
          album: this.track.album || payload.album
        }
      }
      this.lyric = this.pickLyric(this.currentPosition())
      this.pushState()
    })
  }

  private currentPosition(): number {
    if (!this.track) return 0
    if (this.track.status !== "playing") return this.track.positionMs
    const pos = this.trackBasePos + (Date.now() - this.trackOrigin)
    const duration = this.track.durationMs || 0
    return duration > 0 ? Math.min(pos, duration) : pos
  }

  private startLyricClock(): void {
    if (this.lyricTimer) return
    this.lyricTimer = setInterval(() => {
      if (!this.track || this.track.status !== "playing") return
      const pos = this.currentPosition()
      this.track = { ...this.track, positionMs: pos }
      const next = this.pickLyric(pos)
      const lyricChanged = next !== this.lyric
      const positionBucket = Math.floor(pos / 500)
      const positionChanged = positionBucket !== this.lastLyricPositionBucket
      this.lyric = next
      this.lastLyricPositionBucket = positionBucket
      if (lyricChanged || positionChanged) this.pushState()
    }, 200)
  }

  private pickLyric(positionMs: number): string {
    let text = this.track ? `${this.track.artist} · ${this.track.title}` : ""
    let index = -1
    for (let i = 0; i < this.lines.length; i += 1) {
      if (this.lines[i].timeMs > positionMs) break
      index = i
      text = this.lines[i].text
    }
    this.lyricIndex = index
    return text
  }

  private buildLyricWindow(): LyricWindow {
    const index = this.lyricIndex
    if (index < 0) {
      return {
        ...emptyLyricWindow(),
        current: this.lyric ? { timeMs: 0, text: this.lyric } : null
      }
    }
    return {
      previous: index > 0 ? this.lines[index - 1] : null,
      current: this.lines[index] || null,
      next: this.lines[index + 1] || null,
      index
    }
  }

  private restoreIdle(): void {
    if (this.large) return
    if (this.floatingLyricsEnabled && this.track?.status === "playing") {
      this.hoverExpanded = false
      this.setMode("lyrics")
      return
    }
    const fallback = this.userPinned ?? "peek"
    this.setMode(fallback === "notify" || fallback === "lyrics" ? "peek" : fallback)
  }

  private presentNowPlaying(): void {
    if (!this.floatingLyricsEnabled || this.large || this.notification) return
    this.hoverExpanded = false
    this.setMode("lyrics")
  }

  private setMode(mode: IslandMode): void {
    this.mode = mode
    this.hide = this.large ? 0 : hideTarget(mode)
    this.placeCanvas()
    this.pushState()
  }

  private placeCanvas(): void {
    const area = screen.getPrimaryDisplay().bounds
    const next = { x: area.x, y: area.y, width: area.width, height: area.height }
    const cur = this.win.getBounds()
    if (cur.x === next.x && cur.y === next.y && cur.width === next.width && cur.height === next.height) return
    this.win.setBounds(next)
  }

  private syncCursor(force = false): void {
    if (this.win.isDestroyed()) return
    if (this.large) {
      if (this.lastOverPill) this.lastOverPill = false
      this.win.setIgnoreMouseEvents(false)
      return
    }
    const over = this.pointOverPill()
    // Closing the large panel changes the native window from fully interactive
    // back to click-through. Force the update even when the cached hover value
    // is already false, otherwise the fullscreen transparent window keeps
    // swallowing clicks outside the island.
    if (!force && over === this.lastOverPill) return
    this.lastOverPill = over
    this.win.setIgnoreMouseEvents(!over, { forward: true })
    this.setHover(over)
  }

  private pointOverPill(): boolean {
    const point = screen.getCursorScreenPoint()
    const bounds = this.win.getBounds()
    const hit = hoverHitRect(this.mode, this.hide, this.large, bounds.width, Boolean(this.track?.title))
    const x = point.x - bounds.x
    const y = point.y - bounds.y
    return x >= hit.x && x <= hit.x + hit.width && y >= hit.y && y <= hit.y + hit.height
  }

  private clearHoverLeave(): void {
    if (this.hoverLeaveTimer) {
      clearTimeout(this.hoverLeaveTimer)
      this.hoverLeaveTimer = null
    }
  }

  private threadKey(): string {
    return this.aiChatTitle || "_"
  }

  private currentMessages(): IslandChatMessage[] {
    return this.threads[this.threadKey()] ?? []
  }

  private setMessages(messages: IslandChatMessage[]): void {
    this.threads[this.threadKey()] = messages.slice(-40)
  }

  private appendMessage(message: IslandChatMessage): void {
    this.setMessages([...this.currentMessages(), message])
  }

  private patchLastAssistant(text: string): void {
    const msgs = this.currentMessages()
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "assistant") {
        msgs[i] = { role: "assistant", text }
        this.setMessages(msgs)
        return
      }
    }
    this.appendMessage({ role: "assistant", text })
  }

  private settingsFile(): string {
    return join(app.getPath("userData"), "island-settings.json")
  }

  private loadSettings(): void {
    try {
      const raw = JSON.parse(readFileSync(this.settingsFile(), "utf8")) as {
        floatingLyricsEnabled?: boolean
        lyricsTranslationEnabled?: boolean
      }
      if (typeof raw.floatingLyricsEnabled === "boolean") {
        this.floatingLyricsEnabled = raw.floatingLyricsEnabled
      }
      if (typeof raw.lyricsTranslationEnabled === "boolean") {
        this.lyricsTranslationEnabled = raw.lyricsTranslationEnabled
      }
    } catch {
      // first run
    }
  }

  private saveSettings(): void {
    try {
      writeFileSync(
        this.settingsFile(),
        JSON.stringify({
          floatingLyricsEnabled: this.floatingLyricsEnabled,
          lyricsTranslationEnabled: this.lyricsTranslationEnabled
        })
      )
    } catch {
      // ignore disk errors
    }
  }

  private chatFile(): string {
    return join(app.getPath("userData"), "island-chat.json")
  }

  private loadChat(): void {
    try {
      const raw = JSON.parse(readFileSync(this.chatFile(), "utf8")) as {
        chatTitle?: string
        prompt?: string
        reply?: string
        threads?: Record<string, IslandChatMessage[]>
      }
      if (raw.chatTitle) this.aiChatTitle = raw.chatTitle
      if (raw.threads && typeof raw.threads === "object") this.threads = raw.threads
      const msgs = this.currentMessages()
      const lastUser = [...msgs].reverse().find((item) => item.role === "user")
      const lastAssistant = [...msgs].reverse().find((item) => item.role === "assistant")
      if (lastUser) this.aiPrompt = lastUser.text
      if (lastAssistant) this.aiReply = lastAssistant.text
      else if (raw.reply) this.aiReply = raw.reply
    } catch {
      // first run
    }
  }

  private saveChat(): void {
    try {
      writeFileSync(
        this.chatFile(),
        JSON.stringify({
          chatTitle: this.aiChatTitle,
          prompt: this.aiPrompt,
          reply: this.aiReply,
          threads: this.threads
        })
      )
    } catch {
      // ignore disk errors
    }
  }

  private pushState(): void {
    if (!this.win.isDestroyed()) {
      this.win.webContents.send(IPC.stateChanged, this.getState())
    }
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => this.saveChat(), 250)
  }
}
