import { useEffect, useRef, useState } from "react"
import { motion } from "motion/react"
import type { IslandState } from "../../shared/types"
import { TOP_OFFSET, currentPillSize, isExpandedMode, pillSlideY } from "../../shared/types"
import { Markdown } from "./Markdown"

const idle: IslandState = {
  mode: "peek",
  hide: 1,
  large: false,
  notification: null,
  track: null,
  lyric: "",
  ai: {
    provider: "cursor",
    prompt: "",
    reply: "发给当前打开的 Cursor 窗口，回复同步回岛上。",
    messages: [],
    busy: false,
    chatTitle: "",
    chats: []
  }
}

function clockLabel(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
}

export default function App(): React.JSX.Element {
  const [state, setState] = useState<IslandState>(idle)
  const [clock, setClock] = useState(clockLabel)
  const [draft, setDraft] = useState("")
  const [pendingImage, setPendingImage] = useState<{ path: string; preview: string } | null>(null)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const replyBox = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stickBottom = useRef(true)
  const expanded = isExpandedMode(state.mode)
  const size = currentPillSize(state.mode, state.large)
  const tucked = !state.large && state.hide > 0.5

  useEffect(() => {
    void window.island.getState().then(setState)
    return window.island.onState(setState)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(clockLabel()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const box = replyBox.current
    if (!box || !stickBottom.current) return
    box.scrollTop = box.scrollHeight
  }, [state.ai.reply, state.ai.messages])

  useEffect(() => {
    if (!state.large) setChatOpen(false)
  }, [state.large])

  const send = (): void => {
    const text = draft.trim()
    if (state.ai.busy) return
    if (!text && !pendingImage) return
    stickBottom.current = true
    setDraft("")
    const imagePath = pendingImage?.path
    setPendingImage(null)
    void window.island.askAi(text, imagePath)
  }

  const addImageFile = async (file: File): Promise<void> => {
    const data = await file.arrayBuffer()
    const saved = await window.island.saveTempImage({ mime: file.type || "image/png", data })
    setPendingImage(saved)
  }

  const onComposerPaste = (event: React.ClipboardEvent<HTMLFormElement>): void => {
    const items = Array.from(event.clipboardData.items)
    const imageItem = items.find((item) => item.type.startsWith("image/"))
    if (!imageItem) return
    const file = imageItem.getAsFile()
    if (!file) return
    event.preventDefault()
    void addImageFile(file)
  }

  return (
    <div
      className={`stage${state.large ? " catch" : ""}`}
      onClick={() => {
        if (state.large) void window.island.collapseOutside()
      }}
    >
      <motion.div
        initial={false}
        animate={{
          width: size.width,
          height: size.height,
          y: pillSlideY(state.mode, state.hide, state.large),
          borderRadius: state.large ? 28 : 999
        }}
        transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.75 }}
        className={`pill ${state.mode}${expanded ? " expanded" : ""}${tucked ? " tucked" : ""}${state.large ? " large" : ""}`}
        style={{ top: TOP_OFFSET }}
        onClick={(event) => {
          event.stopPropagation()
          void window.island.toggleLarge()
        }}
      >
        {state.large ? (
          <div className="panel">
            <div className="panel-top">
              <span className="dot" />
              <div className="title">Top Island</div>
              <div className="hint">{clock} · 点外面收回</div>
            </div>
            <div className="chat-bar" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="chat-pick"
                disabled={state.ai.busy}
                onClick={() => setChatOpen((open) => !open)}
              >
                <span>{state.ai.chatTitle || "选择会话"}</span>
                <span className="chat-pick-caret">▾</span>
              </button>
              {chatOpen ? (
                <div className="chat-menu">
                  {(state.ai.chatTitle && !state.ai.chats.includes(state.ai.chatTitle)
                    ? [state.ai.chatTitle, ...state.ai.chats]
                    : state.ai.chats
                  ).map((title) => (
                    <button
                      type="button"
                      key={title}
                      className={`chat-option${title === state.ai.chatTitle ? " active" : ""}`}
                      onClick={() => {
                        setChatOpen(false)
                        void window.island.selectChat(title)
                      }}
                    >
                      {title}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div
              className="panel-reply"
              ref={replyBox}
              onClick={(event) => event.stopPropagation()}
              onScroll={() => {
                const box = replyBox.current
                if (!box) return
                stickBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 56
              }}
            >
              {state.ai.messages.length > 0
                ? state.ai.messages.map((item, index) =>
                    item.role === "user" ? (
                      <div className="reply-user" key={`u-${index}`}>
                        {item.text}
                      </div>
                    ) : (
                      <div
                        className={`reply-bubble${state.ai.busy && index === state.ai.messages.length - 1 ? " live" : ""}`}
                        key={`a-${index}`}
                      >
                        <Markdown text={item.text || (state.ai.busy ? "正在回复…" : "")} />
                      </div>
                    )
                  )
                : (
                  <div className="reply-bubble">
                    <Markdown text={state.ai.reply} />
                  </div>
                )}
            </div>
            <form
              className="composer"
              onClick={(event) => event.stopPropagation()}
              onPaste={onComposerPaste}
              onSubmit={(event) => {
                event.preventDefault()
                send()
              }}
            >
              <button
                type="button"
                className="composer-plus"
                onClick={() => {
                  void window.island.pickImage().then((picked) => {
                    if (!picked) return
                    setPendingImage(picked)
                  })
                }}
                title="添加图片"
              >
                +
              </button>
              {pendingImage ? (
                <div className="composer-thumb-wrap">
                  <button
                    type="button"
                    className="composer-thumb"
                    title="预览图片"
                    onClick={() => {
                      void window.island.previewImage(pendingImage.path).then(setPreviewSrc)
                    }}
                  >
                    <img src={pendingImage.preview} alt="" />
                  </button>
                  <button
                    type="button"
                    className="composer-thumb-x"
                    title="删除图片"
                    onClick={(event) => {
                      event.stopPropagation()
                      setPendingImage(null)
                      setPreviewSrc(null)
                      inputRef.current?.focus()
                    }}
                  >
                    ×
                  </button>
                </div>
              ) : null}
              <input
                ref={inputRef}
                className="composer-input"
                value={draft}
                disabled={state.ai.busy}
                placeholder={pendingImage ? "可再写一句，回车发送…" : "发给当前 Cursor 会话…"}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit" className="composer-send" disabled={state.ai.busy} title="发送">
                ↑
              </button>
            </form>
            {previewSrc ? (
              <div
                className="image-preview"
                onClick={(event) => {
                  event.stopPropagation()
                  setPreviewSrc(null)
                }}
              >
                <img src={previewSrc} alt="" onClick={(event) => event.stopPropagation()} />
              </div>
            ) : null}
          </div>
        ) : (
          <>
            {state.mode === "notify" && state.notification ? (
              <>
                <div
                  className={`icon ${/微信|wechat/i.test(state.notification.appName + state.notification.appId) ? "wechat" : "music"}`}
                >
                  {/微信|wechat/i.test(state.notification.appName + state.notification.appId) ? "微" : "讯"}
                </div>
                <div className="copy">
                  <div className="title">
                    {state.notification.appName} · {state.notification.title}
                  </div>
                  <div className="body">{state.notification.body}</div>
                </div>
              </>
            ) : null}

            {state.mode === "lyrics" ? (
              <>
                <div className="icon music">♪</div>
                <div className="lyric">{state.lyric || "正在播放"}</div>
              </>
            ) : null}

            {state.mode === "compact" || state.mode === "peek" || state.mode === "hidden" ? (
              <>
                <span className="dot" />
                {expanded && !tucked ? <div className="title">Top Island</div> : null}
              </>
            ) : null}
          </>
        )}
      </motion.div>
    </div>
  )
}
