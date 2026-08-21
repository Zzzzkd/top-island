import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"
import type { AiProvider } from "../../shared/types"
import { sendToCursorWindow } from "./cursorWindow"

type JsonRpc = {
  jsonrpc?: string
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message?: string }
}

function firstExisting(paths: string[]): string | null {
  for (const path of paths) {
    if (path && existsSync(path)) return path
  }
  return null
}

function which(name: string): string | null {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    for (const ext of exts) {
      const full = join(dir, `${name}${ext}`)
      if (existsSync(full)) return full
    }
  }
  return null
}

function findCursorAgent(): string | null {
  return (
    which("agent") ||
    firstExisting([
      join(homedir(), "AppData", "Local", "cursor-agent", "agent.cmd"),
      join(homedir(), "AppData", "Local", "cursor-agent", "agent.ps1"),
      join(homedir(), ".local", "bin", "agent.exe"),
      join(homedir(), ".local", "bin", "agent")
    ])
  )
}

function findCodex(): string | null {
  return (
    which("codex") ||
    firstExisting([
      join(homedir(), ".local", "bin", "codex.exe"),
      join(homedir(), "AppData", "Roaming", "npm", "codex.cmd"),
      join(homedir(), "AppData", "Local", "Programs", "Codex", "codex.exe")
    ])
  )
}

function spawnAgent(bin: string): ChildProcessWithoutNullStreams {
  const script = bin.endsWith(".cmd") ? bin.replace(/agent\.cmd$/i, "cursor-agent.ps1") : bin
  if (script.endsWith(".ps1")) {
    return spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "acp"],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
    )
  }
  return spawn(bin, ["acp"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
}

class CursorAcpBridge {
  private child: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private buffer = ""
  private sessionId: string | null = null
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private chunks: string[] = []

  async ask(prompt: string): Promise<string> {
    const bin = findCursorAgent()
    if (!bin) {
      return [
        "还没接到本机 Cursor CLI。",
        "岛上发送会走本机 Cursor 的 agent（ask 只读），回复直接显示在岛上，不用切到 Cursor 窗口。",
        "请先安装并登录：https://cursor.com/docs/cli  然后执行 agent login，再重启 Top Island。"
      ].join("\n")
    }
    await this.ensure(bin)
    this.chunks = []
    const result = (await this.send("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text: prompt }]
    })) as { stopReason?: string } | undefined
    const text = this.chunks.join("").trim()
    return text || `Cursor 已收到，但没有返回正文（${result?.stopReason ?? "ok"}）。`
  }

  private ensure(bin: string): Promise<void> {
    if (this.child && this.sessionId) return Promise.resolve()
    this.child = spawnAgent(bin)
    this.child.stdout.setEncoding("utf8")
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk))
    this.child.on("exit", () => {
      this.child = null
      this.sessionId = null
    })
    return this.handshake()
  }

  private async handshake(): Promise<void> {
    await this.send("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "top-island", version: "0.1.0" }
    })
    try {
      await this.send("authenticate", { methodId: "cursor_login" })
    } catch {
      // 已登录时可能直接可用
    }
    const created = (await this.send("session/new", {
      cwd: process.cwd(),
      mcpServers: [],
      mode: "ask"
    })) as { sessionId?: string }
    this.sessionId = created.sessionId ?? null
    if (!this.sessionId) throw new Error("Cursor ACP 没有返回 sessionId")
  }

  private send(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error("等待 Cursor 超时"))
        }
      }, 120000)
    })
  }

  private respond(id: number, result: unknown): void {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`)
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    const lines = this.buffer.split("\n")
    this.buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      let msg: JsonRpc
      try {
        msg = JSON.parse(line) as JsonRpc
      } catch {
        continue
      }
      if (msg.id && (msg.result !== undefined || msg.error)) {
        const waiter = this.pending.get(msg.id)
        if (!waiter) continue
        this.pending.delete(msg.id)
        if (msg.error) waiter.reject(new Error(msg.error.message || "Cursor 返回错误"))
        else waiter.resolve(msg.result)
        continue
      }
      if (msg.method === "session/update") {
        const update = msg.params as { update?: { sessionUpdate?: string; content?: { text?: string } } }
        if (update.update?.sessionUpdate === "agent_message_chunk" && update.update.content?.text) {
          this.chunks.push(update.update.content.text)
        }
        continue
      }
      if (msg.method === "session/request_permission" && msg.id) {
        this.respond(msg.id, { outcome: { outcome: "selected", optionId: "reject-once" } })
      }
    }
  }
}

const cursorBridge = new CursorAcpBridge()

async function askCodex(prompt: string): Promise<string> {
  const bin = findCodex()
  if (!bin) {
    return [
      "还没接到本机 Codex CLI。",
      "岛上发送会走本机 Codex（app-server / exec），回复显示在岛上，不用切到 Codex 窗口。",
      "请先安装 Codex CLI 并登录，再重启 Top Island。"
    ].join("\n")
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(bin, ["exec", "--skip-git-repo-check", "-"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    })
    let out = ""
    let err = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (c: string) => {
      out += c
    })
    child.stderr.on("data", (c: string) => {
      err += c
    })
    child.on("error", reject)
    child.on("close", (code) => {
      const text = out.trim() || err.trim()
      if (!text) {
        resolve(`Codex 已调用，但没有正文（退出码 ${code}）。`)
        return
      }
      resolve(text)
    })
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

export async function sendToLocalApp(
  provider: AiProvider,
  prompt: string,
  onUpdate?: (text: string) => void,
  imagePath?: string,
  chatTitle?: string
): Promise<string> {
  const text = prompt.trim()
  if (!text && !imagePath) return "先输入要发给本机应用的内容。"
  if (provider === "codex") return askCodex(text || "请看这张图")
  return sendToCursorWindow(text, onUpdate, imagePath, chatTitle)
}
