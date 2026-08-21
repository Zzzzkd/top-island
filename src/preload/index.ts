import { contextBridge, ipcRenderer } from "electron"
import type { AiProvider, IslandMode, IslandState } from "../shared/types"
import { IPC } from "../shared/types"

contextBridge.exposeInMainWorld("island", {
  getState: (): Promise<IslandState> => ipcRenderer.invoke(IPC.getState),
  setMode: (mode: IslandMode): Promise<void> => ipcRenderer.invoke(IPC.setMode, mode),
  setHover: (hovering: boolean): Promise<void> => ipcRenderer.invoke(IPC.hover, hovering),
  toggleLarge: (): Promise<void> => ipcRenderer.invoke(IPC.toggleLarge),
  collapseOutside: (): Promise<void> => ipcRenderer.invoke(IPC.collapseOutside),
  demoNotify: (): Promise<void> => ipcRenderer.invoke(IPC.demoNotify),
  demoLyric: (): Promise<void> => ipcRenderer.invoke(IPC.demoLyric),
  askAi: (prompt: string, imagePath?: string): Promise<void> => ipcRenderer.invoke(IPC.askAi, prompt, imagePath),
  attachImage: (caption?: string): Promise<void> => ipcRenderer.invoke(IPC.attachImage, caption),
  pickImage: (): Promise<{ path: string; preview: string } | null> => ipcRenderer.invoke(IPC.pickImage),
  saveTempImage: (payload: { mime: string; data: ArrayBuffer }): Promise<{ path: string; preview: string }> =>
    ipcRenderer.invoke(IPC.saveTempImage, payload),
  previewImage: (path: string): Promise<string> => ipcRenderer.invoke(IPC.previewImage, path),
  setAiProvider: (provider: AiProvider): Promise<void> => ipcRenderer.invoke(IPC.setAiProvider, provider),
  selectChat: (title: string): Promise<void> => ipcRenderer.invoke(IPC.selectChat, title),
  onState: (fn: (state: IslandState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: IslandState): void => fn(state)
    ipcRenderer.on(IPC.stateChanged, listener)
    return () => ipcRenderer.removeListener(IPC.stateChanged, listener)
  }
})
