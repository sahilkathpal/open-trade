"use client"

import { useEffect, useCallback, useState } from "react"
import { useAuth } from "@/lib/auth"
import { MarkdownRenderer } from "@/components/MarkdownRenderer"
import { StrategyBadge } from "@/components/StrategyBadge"

export default function StrategyPage() {
  const { authFetch } = useAuth()
  const [content, setContent] = useState<string>("")
  const [lastModified, setLastModified] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const fetchStrategy = useCallback(async () => {
    try {
      setLoading(true)
      const res = await authFetch("/api/memory/STRATEGY.md")
      if (!res.ok) throw new Error("fetch failed")
      const data = await res.json()
      setContent(data.content)
      setLastModified(data.last_modified || "")
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    fetchStrategy()
  }, [fetchStrategy])

  if (loading) return <div className="text-text-muted text-center py-12">Loading strategy...</div>
  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-accent-red mb-2">Failed to load strategy</div>
        <p className="text-text-muted text-sm">Could not fetch STRATEGY.md from the API</p>
      </div>
    )
  }

  if (!content.trim()) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-xl font-semibold text-text-primary">Strategy</h1>
          <StrategyBadge />
        </div>
        <div className="bg-surface rounded-lg border border-border p-12 text-center">
          <p className="text-text-muted">No strategy notes yet.</p>
          <p className="text-text-muted text-sm mt-1">The agent builds this over time after each EOD session.</p>
        </div>
      </div>
    )
  }

  const modifiedStr = lastModified
    ? new Date(lastModified).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    : null

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-text-primary">Strategy</h1>
          <StrategyBadge />
        </div>
        {modifiedStr && <p className="text-text-muted text-sm">Last updated: {modifiedStr}</p>}
      </div>

      <div className="bg-surface rounded-lg border border-border p-6">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  )
}
