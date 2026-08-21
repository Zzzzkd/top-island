const NOISE = /^(Apps|Open Tabs|On .+|Just now|\d+[smhd] ago|Send follow-up|Multitask|Copy message|Thumbs up|Thumbs down|Fork chat)$/i

export function splitReply(raw: string): { target: string; body: string } {
  const text = raw.trim()
  const matched = text.match(/^已发到「([^」]+)」[。.]?\s*([\s\S]*)$/)
  if (matched) {
    return { target: matched[1], body: cleanBody(matched[2]) }
  }
  return { target: "", body: cleanBody(text) }
}

export function cleanBody(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !NOISE.test(line))
  if (lines.length === 0) return ""
  const lastUser = [...lines].reverse().findIndex((line) => line.length <= 24 && !/[。！？.!?]$/.test(line))
  if (lastUser > 0 && lastUser < lines.length - 1) {
    return lines.slice(lines.length - lastUser).join("\n")
  }
  return lines.slice(-12).join("\n")
}

export function renderReplyLines(body: string): string[] {
  return body.split(/\n+/).filter(Boolean)
}
