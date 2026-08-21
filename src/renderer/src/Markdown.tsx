import type { ReactNode } from "react"

function inline(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\[[^\]]+\]\([^)]+\))/g)
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>
    }
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (link) {
      return (
        <a key={index} href={link[2]} target="_blank" rel="noreferrer">
          {link[1]}
        </a>
      )
    }
    return <span key={index}>{part}</span>
  })
}

function renderBlock(block: string, key: number): ReactNode {
  const trimmed = block.trim()
  if (!trimmed) return null
  if (/^```/.test(trimmed)) {
    const lines = trimmed.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "")
    return (
      <pre key={key}>
        <code>{lines}</code>
      </pre>
    )
  }
  if (/^#{1,3} /.test(trimmed)) {
    const level = trimmed.match(/^#{1,3}/)?.[0].length ?? 1
    const Tag = (`h${level}` as "h1" | "h2" | "h3")
    return <Tag key={key}>{inline(trimmed.replace(/^#{1,3} /, ""))}</Tag>
  }
  if (/^[-*] /.test(trimmed) || /^\d+\. /.test(trimmed)) {
    const items = trimmed.split("\n").filter((line) => /^[-*] |^\d+\. /.test(line))
    return (
      <ul key={key}>
        {items.map((item, index) => (
          <li key={index}>{inline(item.replace(/^[-*] |^\d+\. /, ""))}</li>
        ))}
      </ul>
    )
  }
  if (/^> /.test(trimmed)) {
    return (
      <blockquote key={key}>
        {inline(
          trimmed
            .split("\n")
            .map((line) => line.replace(/^> ?/, ""))
            .join("\n")
        )}
      </blockquote>
    )
  }
  return <p key={key}>{inline(trimmed)}</p>
}

export function Markdown({ text }: { text: string }) {
  const chunks = text.split(/(```[\s\S]*?```)/g).filter((chunk) => chunk.length > 0)
  const blocks: string[] = []
  for (const chunk of chunks) {
    if (chunk.startsWith("```")) {
      blocks.push(chunk)
      continue
    }
    for (const part of chunk.split(/\n{2,}/)) {
      if (part.trim()) blocks.push(part)
    }
  }
  return <div className="md">{blocks.map((block, index) => renderBlock(block, index))}</div>
}
