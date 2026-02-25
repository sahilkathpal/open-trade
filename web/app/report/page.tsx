"use client"

import { useEffect, useCallback, useState } from "react"
import { useAuth } from "@/lib/auth"
import { MarketRegimeBadge } from "@/components/MarketRegimeBadge"
import { MarkdownRenderer } from "@/components/MarkdownRenderer"
import { StrategyBadge } from "@/components/StrategyBadge"

export default function ReportPage() {
  const { authFetch } = useAuth()
  const [content, setContent] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true)
      const res = await authFetch("/api/memory/MARKET.md")
      if (!res.ok) throw new Error("fetch failed")
      const data = await res.json()
      setContent(data.content)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    fetchReport()
  }, [fetchReport])

  if (loading) {
    return <div className="text-text-muted text-center py-12">Loading report...</div>
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-accent-red mb-2">Failed to load report</div>
        <p className="text-text-muted text-sm">Could not fetch MARKET.md from the API</p>
      </div>
    )
  }

  if (!content.trim()) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-xl font-semibold text-text-primary">Market Brief</h1>
          <StrategyBadge />
        </div>
        <div className="bg-surface rounded-lg border border-border p-12 text-center">
          <p className="text-text-muted">No report yet.</p>
          <p className="text-text-muted text-sm mt-1">The agent generates this during the pre-market scan at 8:45 AM.</p>
        </div>
      </div>
    )
  }

  const dateMatch = content.match(/^#\s*Market.*?(\d{4}-\d{2}-\d{2}|\w+ \d+,?\s*\d{4})/m)
  const dateStr = dateMatch ? dateMatch[1] : null

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-text-primary">Market Brief</h1>
            <StrategyBadge />
          </div>
          {dateStr && <p className="text-text-muted text-sm">{dateStr}</p>}
        </div>
        <MarketRegimeBadge content={content} />
      </div>

      <div className="bg-surface rounded-lg border border-border p-6">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  )
}
