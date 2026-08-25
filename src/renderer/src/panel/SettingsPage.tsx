import type { IslandState } from "../../../shared/types"

export function SettingsPage({ state }: { state: IslandState }) {
  return (
    <section className="settings-page" aria-label="设置页面">
      <div className="settings-group spotlight-card">
        <div className="settings-row-title">
          <span>显示方式</span>
          <small>选择收回后的形态</small>
        </div>
        <div className="mode-switch" role="group" aria-label="显示方式">
          {(["compact", "peek", "hidden"] as const).map((mode) => (
            <button
              type="button"
              className={state.mode === mode ? "active" : ""}
              key={mode}
              onClick={() => void window.island.setMode(mode)}
            >
              {mode === "compact" ? "紧凑" : mode === "peek" ? "半隐藏" : "全隐藏"}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-group spotlight-card settings-toggle-row">
        <div className="settings-toggle-copy">
          <span>歌词翻译</span>
          <small>媒体页显示当前句的对照翻译，可随时关闭</small>
        </div>
        <button
          type="button"
          className={`settings-toggle${state.settings.lyricsTranslationEnabled ? " active" : ""}`}
          role="switch"
          aria-checked={state.settings.lyricsTranslationEnabled}
          aria-label="歌词翻译"
          onClick={() => void window.island.setLyricsTranslationEnabled(!state.settings.lyricsTranslationEnabled)}
        >
          <span />
        </button>
      </div>

      <div className="settings-group spotlight-card settings-toggle-row">
        <div className="settings-toggle-copy">
          <span>悬浮歌词胶囊</span>
          <small>播放音乐时在屏幕顶部常驻显示封面与同步歌词</small>
        </div>
        <button
          type="button"
          className={`settings-toggle${state.settings.floatingLyricsEnabled ? " active" : ""}`}
          role="switch"
          aria-checked={state.settings.floatingLyricsEnabled}
          aria-label="悬浮歌词胶囊"
          onClick={() => void window.island.setFloatingLyricsEnabled(!state.settings.floatingLyricsEnabled)}
        >
          <span />
        </button>
      </div>

      <div className="settings-group spotlight-card">
        <div className="settings-row-title">
          <span>默认模型通道</span>
          <small>切回对话页后立即生效</small>
        </div>
        <div className="provider-cards">
          {(["cursor", "codex"] as const).map((provider) => (
            <button
              type="button"
              key={provider}
              className={state.ai.provider === provider ? "active" : ""}
              onClick={() => void window.island.setAiProvider(provider)}
            >
              <span className={`provider-mark ${provider}`}>{provider === "cursor" ? "C" : "X"}</span>
              <span><strong>{provider === "cursor" ? "Cursor" : "Codex"}</strong><small>{provider === "cursor" ? "窗口会话" : "本机 CLI"}</small></span>
              <i>{state.ai.provider === provider ? "✓" : ""}</i>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-footnote"><span className="dot" /> 所有能力均在本机运行</div>
    </section>
  )
}
