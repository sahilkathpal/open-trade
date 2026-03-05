"use client"

import { useEffect, useState, useCallback } from "react"
import { useAuth } from "@/lib/auth"
import { Approval } from "@/lib/types"
import { ApprovalItem } from "@/components/ApprovalItem"
import Link from "next/link"

export function ApprovalToastContainer() {
  const { authFetch, user } = useAuth()
  const [toastApprovals, setToastApprovals] = useState<Approval[]>([])

  const fetchApprovals = useCallback(async () => {
    try {
      const res = await authFetch("/api/approvals")
      if (!res.ok) return
      const data: Approval[] = await res.json()
      setToastApprovals(data)
    } catch { /* silent */ }
  }, [authFetch])

  useEffect(() => {
    if (!user) return
    fetchApprovals()
    const interval = setInterval(fetchApprovals, 10000)
    return () => clearInterval(interval)
  }, [user, fetchApprovals])

  if (toastApprovals.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 w-80">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-mono text-text-muted">{toastApprovals.length} pending approval{toastApprovals.length > 1 ? "s" : ""}</span>
        <Link href="/approvals" className="text-xs font-mono text-accent-amber hover:underline">
          View all
        </Link>
      </div>
      {toastApprovals.slice(0, 3).map((approval) => (
        <ApprovalItem
          key={approval.id}
          approval={approval}
          onRespond={fetchApprovals}
        />
      ))}
    </div>
  )
}
