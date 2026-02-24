"use client"

import { useEffect, useState } from "react"
import { MarketRegimeBadge } from "@/components/MarketRegimeBadge"
import { MarkdownRenderer } from "@/components/MarkdownRenderer"

export default function ReportPage() {
  const [content, setContent] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    fetchReport()
  }, [])

  async function fetchReport() {
    try {
      setLoading(true)
      const res = await fetch("http://localhost:8000/api/memory/MARKET.md")
      if (!res.ok) throw new Error("fetch failed")
      const data = await res.json()
      setContent(data.content)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  async function runPremarket() {
    setRunning(true)
    try {
      await fetch("http://localhost:8000/api/run/premarket", { method: "POST" })
      // Refetch after a delay to let it process
      setTimeout(fetchReport, 3000)
    } catch {
      // ignore
    } finally {
      setRunning(false)
    }
  }

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

  // Extract date from first line if present
  const dateMatch = content.match(/^#\s*Market.*?(\d{4}-\d{2}-\d{2}|\w+ \d+,?\s*\d{4})/m)
  const dateStr = dateMatch ? dateMatch[1] : "Latest"

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Market Report</h1>
          <p className="text-text-muted text-sm">{dateStr}</p>
        </div>
        <div className="flex items-center gap-4">
          <MarketRegimeBadge content={content} />
          <button
            onClick={runPremarket}
            disabled={running}
            className="px-4 py-2 rounded-md bg-accent-amber/20 text-accent-amber text-sm font-medium hover:bg-accent-amber/30 transition-colors disabled:opacity-50"
          >
            {running ? "Running..." : "Run Pre-market"}
          </button>
        </div>
      </div>

      <div className="bg-surface rounded-lg border border-border p-6">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  )
}
