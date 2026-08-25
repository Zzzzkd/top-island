import type { IslandState } from "../../../shared/types"

export function OverviewPage({ state, clock }: { state: IslandState; clock: string }) {
  const provider = state.ai.provider === "cursor" ? "Cursor" : "Codex"
  const mediaText = state.track?.title || "等待播放"

  return (
    <section className="overview-page" aria-label="总览页面">
      <div className="overview-hero spotlight-card">
        <div>
          <div className="page-eyebrow">ISLAND OVERVIEW</div>
          <div className="overview-time">{clock}</div>
          <div className="page-subtitle">桌面信息已集中到这里</div>
        </div>
        <div className="signal-orb" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className="status-grid">
        <article className="status-card spotlight-card">
          <span className="status-card-icon green">✦</span>
          <div>
            <strong>{provider}</strong>
            <small>{state.ai.busy ? "正在回复" : "连接待命"}</small>
          </div>
        </article>
        <article className="status-card spotlight-card">
          <span className="status-card-icon violet">♫</span>
          <div>
            <strong>{mediaText}</strong>
            <small>{state.track?.artist || state.track?.appName || "媒体会话"}</small>
          </div>
        </article>
        <article className="status-card spotlight-card wide">
          <span className="status-card-icon blue">◉</span>
          <div>
            <strong>通知监听已开启</strong>
            <small>{state.notification ? `最近：${state.notification.appName}` : "等待 Windows 通知"}</small>
          </div>
          <span className="status-live">LIVE</span>
        </article>
      </div>

      <div className="quick-actions">
        <button type="button" onClick={() => void window.island.demoNotify()}>
          <span>↗</span> 测试通知
        </button>
        <button type="button" onClick={() => void window.island.demoLyric()}>
          <span>♪</span> 演示歌词
        </button>
      </div>
    </section>
  )
}
