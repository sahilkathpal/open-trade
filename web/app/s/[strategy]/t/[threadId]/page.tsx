"use client"

import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"

// This route redirects to the strategy page with the thread as a query param.
// The chat UI lives inside the Chat tab of the strategy page.
export default function ThreadRedirect() {
  const params = useParams()
  const router = useRouter()
  const strategyId = params.strategy as string
  const threadId = params.threadId as string

  useEffect(() => {
    router.replace(`/s/${strategyId}?t=${threadId}`)
  }, [router, strategyId, threadId])

  return null
}
