import { motion } from "motion/react"
import type { PanelPage } from "./types"

const tabs: Array<{ id: PanelPage; label: string; icon: string }> = [
  { id: "chat", label: "对话", icon: "✦" },
  { id: "overview", label: "总览", icon: "◫" },
  { id: "media", label: "媒体", icon: "♫" },
  { id: "volume", label: "音量", icon: "◖" },
  { id: "settings", label: "设置", icon: "⌁" }
]

export function PanelTabs({ active, onChange }: { active: PanelPage; onChange: (page: PanelPage) => void }) {
  return (
    <nav className="panel-tabs" role="tablist" aria-label="Top Island 页面" onClick={(event) => event.stopPropagation()}>
      {tabs.map((tab) => {
        const selected = active === tab.id
        return (
          <button
            type="button"
            role="tab"
            aria-selected={selected}
            className={`panel-tab${selected ? " active" : ""}`}
            key={tab.id}
            onClick={() => onChange(tab.id)}
          >
            {selected ? (
              <motion.span
                className="panel-tab-pill"
                layoutId="panel-tab-pill"
                transition={{ type: "spring", stiffness: 520, damping: 38, mass: 0.65 }}
              />
            ) : null}
            <span className="panel-tab-icon" aria-hidden="true">{tab.icon}</span>
            <span className="panel-tab-label-window">
              <span className="panel-tab-label-rail">
                <span>{tab.label}</span>
                <span aria-hidden="true">{tab.label}</span>
              </span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}

