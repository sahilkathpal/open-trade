"use client"

import { useEffect, useState, useCallback } from "react"
import { useAuth } from "@/lib/auth"
import { Approval } from "@/lib/types"
import { ApprovalItem } from "@/components/ApprovalItem"

export default function ApprovalsPage() {
  const { authFetch } = useAuth()
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [loading, setLoading] = useState(true)

  const fetchApprovals = useCallback(async () => {
    try {
      const res = await authFetch("/api/approvals")
      if (!res.ok) return
      const data: Approval[] = await res.json()
      setApprovals(data)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [authFetch])

  useEffect(() => {
    fetchApprovals()
    const interval = setInterval(fetchApprovals, 10000)
    return () => clearInterval(interval)
  }, [fetchApprovals])

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold font-mono text-text-primary">Approvals</h1>
        {approvals.length > 0 && (
          <span className="bg-accent-amber text-black text-xs font-semibold rounded-full px-2 py-0.5">
            {approvals.length}
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-text-muted text-sm font-mono">Loading...</p>
      ) : approvals.length === 0 ? (
        <p className="text-text-muted text-sm font-mono">No pending approvals.</p>
      ) : (
        <div className="space-y-3">
          {approvals.map((approval) => (
            <ApprovalItem
              key={approval.id}
              approval={approval}
              onRespond={fetchApprovals}
            />
          ))}
        </div>
      )}
    </div>
  )
}
