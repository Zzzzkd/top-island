import { Notification, app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } from "electron"
import { join } from "node:path"
import { IslandController } from "./islandController"
import { DemoNotificationSource, WindowsNotificationSource } from "./sources/notifications"
import { DemoMediaSource, WindowsSmtcSource } from "./sources/media"
import { CompositeLyricSource } from "./sources/lyrics"
import type { AiProvider, IslandMode } from "../shared/types"
import { IPC } from "../shared/types"
import { killOtherTopIslandProcesses } from "./singleton"
import { getSystemVolume, setSystemMuted, setSystemVolume } from "./systemVolume"

killOtherTopIslandProcesses()
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let tray: Tray | null = null
let controller: IslandController | null = null

function createWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay()
  const area = display.bounds
  const win = new BrowserWindow({
    width: area.width,
    height: area.height,
    x: area.x,
    y: area.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.setAlwaysOnTop(true, "screen-saver")
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true, { forward: true })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"))
  }

  win.once("ready-to-show", () => win.showInactive())
  return win
}

function bindIpc(island: IslandController): void {
  ipcMain.handle(IPC.getState, () => island.getState())
  ipcMain.handle(IPC.setMode, (_event, mode: IslandMode) => {
    island.setUserMode(mode)
  })
  ipcMain.handle(IPC.hover, (_event, hovering: boolean) => {
    island.setHover(hovering)
  })
  ipcMain.handle(IPC.toggleLarge, () => island.toggleLarge())
  ipcMain.handle(IPC.collapseOutside, () => island.collapseOutside())
  ipcMain.handle(IPC.demoNotify, () => island.emitDemoNotification())
  ipcMain.handle(IPC.demoLyric, () => island.emitDemoLyric())
  ipcMain.handle(IPC.askAi, (_event, prompt: string, imagePath?: string) => island.askAi(prompt, imagePath))
  ipcMain.handle(IPC.attachImage, (_event, caption?: string) => island.attachImage(caption))
  ipcMain.handle(IPC.pickImage, () => island.pickImage())
  ipcMain.handle(IPC.saveTempImage, (_event, payload: { mime: string; data: ArrayBuffer }) => island.saveTempImage(payload))
  ipcMain.handle(IPC.previewImage, (_event, path: string) => island.previewImage(path))
  ipcMain.handle(IPC.setAiProvider, (_event, provider: AiProvider) => {
    island.setAiProvider(provider)
  })
  ipcMain.handle(IPC.setFloatingLyricsEnabled, (_event, enabled: boolean) => {
    island.setFloatingLyricsEnabled(enabled)
  })
  ipcMain.handle(IPC.setLyricsTranslationEnabled, (_event, enabled: boolean) => {
    island.setLyricsTranslationEnabled(enabled)
  })
  ipcMain.handle(IPC.selectChat, (_event, title: string) => island.selectChat(title))
  ipcMain.handle(IPC.getSystemVolume, () => getSystemVolume())
  ipcMain.handle(IPC.setSystemVolume, (_event, level: number) => setSystemVolume(level))
  ipcMain.handle(IPC.setSystemMuted, (_event, muted: boolean) => setSystemMuted(muted))
  ipcMain.handle(IPC.mediaPlayPause, () => island.controlMedia("playpause"))
  ipcMain.handle(IPC.mediaNext, () => island.controlMedia("next"))
  ipcMain.handle(IPC.mediaPrev, () => island.controlMedia("prev"))
}

function loadTrayIcon(): Electron.NativeImage {
  const file = app.isPackaged
    ? join(process.resourcesPath, "tray-icon.png")
    : join(app.getAppPath(), "resources", "tray-icon.png")
  const icon = nativeImage.createFromPath(file)
  if (icon.isEmpty()) {
    return nativeImage.createEmpty()
  }
  return icon.resize({ width: 16, height: 16 })
}

function createTray(island: IslandController): Tray {
  const next = new Tray(loadTrayIcon())
  const applyMenu = (): void => {
    next.setContextMenu(
      Menu.buildFromTemplate([
        { label: "紧凑显示", click: () => island.setUserMode("compact") },
        { label: "半隐藏（只露一条）", click: () => island.setUserMode("peek") },
        { label: "全隐藏", click: () => island.setUserMode("hidden") },
        { type: "separator" },
        { label: "放大 / 收回岛", click: () => island.toggleLarge() },
        { label: "发送测试系统通知", click: () => sendTestToast() },
        { label: "打开通知权限设置", click: () => void shell.openExternal("ms-settings:privacy-notifications") },
        { label: "演示：微信通知", click: () => island.emitDemoNotification() },
        { label: "演示：歌词", click: () => island.emitDemoLyric() },
        { type: "separator" },
        { label: "退出", click: () => app.quit() }
      ])
    )
  }
  applyMenu()
  next.setToolTip("Top Island")
  return next
}

function sendTestToast(): void {
  controller?.presentNotification({
    id: `test-${Date.now()}`,
    appId: "com.topisland.app",
    appName: "系统",
    title: "Top Island",
    body: "系统通知已接到岛上",
    at: Date.now()
  })
  if (!Notification.isSupported()) return
  const toast = new Notification({
    title: "Top Island",
    body: "系统通知已接到岛上"
  })
  toast.show()
}

app.setAppUserModelId("com.topisland.app")

app.whenReady().then(() => {
  const win = createWindow()
  const notify = process.argv.includes("--demo-only")
    ? new DemoNotificationSource()
    : new WindowsNotificationSource()
  const media = process.argv.includes("--demo-only") ? new DemoMediaSource() : new WindowsSmtcSource()
  const lyrics = new CompositeLyricSource()

  controller = new IslandController(win, { notify, media, lyrics })
  bindIpc(controller)
  tray = createTray(controller)
  controller.start()
})

app.on("window-all-closed", () => {
  tray?.destroy()
  app.quit()
})
