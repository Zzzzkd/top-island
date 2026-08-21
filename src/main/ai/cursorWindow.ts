import { spawn } from "node:child_process"
import { scriptPath } from "../scriptsPath"

function fromB64(value?: string): string | undefined {
  if (!value) return undefined
  try {
    return Buffer.from(value, "base64").toString("utf8")
  } catch {
    return value
  }
}

export type CursorWindowResult = {
  ok: boolean
  window?: string
  chatTitle?: string
  reply?: string
  stamp?: string
  chats?: string[]
  error?: string
}

function runCursorWindow(
  action: "status" | "send" | "read" | "peek" | "send-image" | "list" | "select",
  text = "",
  waitSeconds = 90,
  imagePath = "",
  chatTitle = ""
): Promise<CursorWindowResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath("cursor-window.ps1"),
        "-Action",
        action,
        "-WaitSeconds",
        String(waitSeconds),
        ...(text ? ["-TextBase64", Buffer.from(text, "utf8").toString("base64")] : []),
        ...(imagePath ? ["-ImagePath", imagePath] : []),
        ...(chatTitle ? ["-ChatTitleBase64", Buffer.from(chatTitle, "utf8").toString("base64")] : [])
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    )
    const chunks: Buffer[] = []
    let err = ""
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk)
    })
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      err += chunk
    })
    child.on("error", reject)
    child.on("close", () => {
      const raw = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "")
      const line = raw.trim().split(/\r?\n/).pop() || ""
      try {
        const parsed = JSON.parse(line) as {
          ok: boolean
          window?: string
          chatTitle?: string
          reply?: string
          stamp?: string
          chats?: string
          error?: string
        }
        const chatText = fromB64(parsed.chats) || ""
        resolve({
          ok: parsed.ok,
          error: parsed.error,
          stamp: parsed.stamp,
          window: fromB64(parsed.window),
          chatTitle: fromB64(parsed.chatTitle),
          reply: fromB64(parsed.reply),
          chats: chatText ? chatText.split("\n").filter(Boolean) : []
        })
      } catch {
        resolve({ ok: false, error: "没发到当前 Cursor 会话，请再试一次。" })
      }
    })
  })
}

export async function peekCursorWindow(): Promise<CursorWindowResult> {
  return runCursorWindow("peek")
}

export async function listCursorChats(): Promise<CursorWindowResult> {
  return runCursorWindow("list")
}

export async function selectCursorChat(title: string): Promise<CursorWindowResult> {
  return runCursorWindow("select", "", 90, "", title)
}

export async function readCursorReply(): Promise<CursorWindowResult> {
  return runCursorWindow("read")
}

export async function sendToCursorWindow(
  prompt: string,
  onUpdate?: (text: string) => void,
  imagePath?: string,
  chatTitle?: string
): Promise<string> {
  const text = prompt.trim()
  if (!text && !imagePath) return "先输入要发给当前 Cursor 会话的内容。"

  const sent = imagePath
    ? await runCursorWindow("send-image", text, 90, imagePath, chatTitle)
    : await runCursorWindow("send", text, 90, "", chatTitle)
  if (!sent.ok) {
    if (sent.error === "cursor-window-not-found") {
      return "没有找到已打开的 Cursor 窗口输入框。请先打开 Cursor Agents 或当前对话。"
    }
    if (sent.error === "empty-prompt") return "先输入要发给当前 Cursor 会话的内容。"
    if (sent.error === "image-not-found") return "没找到要发送的图片。"
    if (sent.error === "cursor-window-failed") return "没发到当前 Cursor 会话，请再试一次。"
    return sent.error || "没接到当前 Cursor 窗口。"
  }

  onUpdate?.("正在回复…")

  const started = Date.now()
  const limitMs = 120000
  let streamed = ""
  let thinking = "正在回复…"
  let finished = 0

  const stripUser = (live: string): string => {
    const prompt = text.trim()
    if (!prompt || !live) return live
    if (live === prompt) return ""
    if (live.startsWith(`${prompt}\n`)) return live.slice(prompt.length).trim()
    return live
  }

  while (Date.now() - started < limitMs) {
    await new Promise((resolve) => setTimeout(resolve, 280))
    const peek = await runCursorWindow("peek")
    if (!peek.ok) continue
    const live = stripUser(peek.reply?.trim() || "")
    if (live && live !== streamed && live.length >= streamed.length) {
      streamed = live
      onUpdate?.(streamed)
    } else if (!streamed && peek.reply && peek.reply !== thinking) {
      thinking = peek.reply
      onUpdate?.(thinking)
    }
    if (peek.stamp && peek.stamp !== sent.stamp) {
      finished += 1
    } else {
      finished = 0
    }
    if (finished >= 2) break
  }

  const last = await runCursorWindow("read")
  const copied = last.ok ? last.reply?.trim() || "" : ""
  return copied || streamed || thinking || "已提交，但还没读到这一轮回复。"
}
