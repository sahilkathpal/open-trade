"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Components } from "react-markdown"

const components: Components = {
  h2: ({ children }) => (
    <h2 className="text-xl font-semibold text-text-primary border-b border-border pb-2 mb-3 mt-6">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-semibold text-text-primary border-b border-border pb-1 mb-2 mt-4">
      {children}
    </h3>
  ),
  p: ({ children }) => <p className="text-text-muted mb-3 leading-relaxed">{children}</p>,
  a: ({ href, children }) => (
    <a href={href} className="text-accent-green hover:underline" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-accent-amber pl-4 my-3 text-text-muted italic">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => {
    const isBlock = className?.includes("language-")
    if (isBlock) {
      return (
        <code className="block bg-surface rounded p-4 font-mono text-sm overflow-x-auto my-3">
          {children}
        </code>
      )
    }
    return <code className="bg-surface px-1.5 py-0.5 rounded font-mono text-sm">{children}</code>
  },
  pre: ({ children }) => <pre className="my-3">{children}</pre>,
  table: ({ children }) => (
    <div className="overflow-x-auto my-3">
      <table className="w-full border-collapse border border-border text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-surface px-3 py-2 text-left text-text-primary font-medium">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-3 py-2 text-text-muted">{children}</td>
  ),
  ul: ({ children }) => <ul className="list-disc pl-5 mb-3 text-text-muted">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 text-text-muted">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
}

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  )
}
