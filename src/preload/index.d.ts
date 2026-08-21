import type { AiProvider, IslandMode, IslandState } from "../shared/types"

export interface IslandApi {
  getState(): Promise<IslandState>
  setMode(mode: IslandMode): Promise<void>
  setHover(hovering: boolean): Promise<void>
  toggleLarge(): Promise<void>
  collapseOutside(): Promise<void>
  demoNotify(): Promise<void>
  demoLyric(): Promise<void>
  askAi(prompt: string, imagePath?: string): Promise<void>
  attachImage(caption?: string): Promise<void>
  pickImage(): Promise<{ path: string; preview: string } | null>
  saveTempImage(payload: { mime: string; data: ArrayBuffer }): Promise<{ path: string; preview: string }>
  previewImage(path: string): Promise<string>
  setAiProvider(provider: AiProvider): Promise<void>
  selectChat(title: string): Promise<void>
  onState(fn: (state: IslandState) => void): () => void
}

declare global {
  interface Window {
    island: IslandApi
  }
}

export {}
