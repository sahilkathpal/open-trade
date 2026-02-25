"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/lib/auth"
import { MarkdownRenderer } from "@/components/MarkdownRenderer"
import { StrategyBadge } from "@/components/StrategyBadge"

export default function JournalPage() {
  const { authFetch } = useAuth()
  const [content, setContent] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function fetchJournal() {
      try {
        const res = await authFetch("/api/memory/JOURNAL.md")
        if (!res.ok) throw new Error("fetch failed")
        const data = await res.json()
        setContent(data.content)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    fetchJournal()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFetch])

  if (loading) return <div className="text-text-muted text-center py-12">Loading journal...</div>

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-accent-red mb-2">Failed to load journal</div>
        <p className="text-text-muted text-sm">Could not fetch JOURNAL.md from the API</p>
      </div>
    )
  }

  const heading = (
    <div className="flex items-center gap-3">
      <h1 className="text-xl font-semibold text-text-primary">Trade Journal</h1>
      <StrategyBadge />
    </div>
  )

  if (!content.trim()) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">{heading}</div>
        <div className="bg-surface rounded-lg border border-border p-12 text-center">
          <p className="text-text-muted">No trades yet.</p>
          <p className="text-text-muted text-sm mt-1">The agent logs every trade here at end of day.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {heading}
      <div className="bg-surface rounded-lg border border-border p-6">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  )
}
