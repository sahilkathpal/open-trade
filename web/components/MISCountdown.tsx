"use client"

import { useEffect, useState } from "react"
import clsx from "clsx"

interface Position {
  symbol: string
}

function getISTTime(): Date {
  const now = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60 * 1000
  return new Date(utcTime + istOffset)
}

export function MISCountdown({ positions }: { positions: Position[] }) {
  const [timeLeft, setTimeLeft] = useState<string | null>(null)
  const [urgent, setUrgent] = useState(false)

  useEffect(() => {
    if (positions.length === 0) return

    function update() {
      const ist = getISTTime()
      const hours = ist.getHours()
      const minutes = ist.getMinutes()

      // Only show between 15:00 and 15:20
      if (hours !== 15 || minutes >= 20) {
        setTimeLeft(null)
        return
      }

      const squareOffMinutes = 20 - minutes
      const squareOffSeconds = 60 - ist.getSeconds()
      const totalSeconds = (squareOffMinutes - 1) * 60 + squareOffSeconds

      const mm = Math.floor(totalSeconds / 60)
        .toString()
        .padStart(2, "0")
      const ss = (totalSeconds % 60).toString().padStart(2, "0")

      setTimeLeft(`${mm}:${ss}`)
      setUrgent(totalSeconds < 300) // under 5 minutes
    }

    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [positions.length])

  if (!timeLeft) return null

  return (
    <div
      className={clsx(
        "fixed bottom-6 right-6 z-50 bg-surface border rounded-lg px-5 py-3 shadow-lg",
        urgent
          ? "border-accent-red animate-pulse"
          : "border-accent-amber"
      )}
    >
      <div className="text-xs text-text-muted uppercase tracking-wider mb-1">MIS Square-off in</div>
      <div
        className={clsx(
          "font-mono text-3xl font-bold",
          urgent ? "text-accent-red" : "text-accent-amber"
        )}
      >
        {timeLeft}
      </div>
    </div>
  )
}
