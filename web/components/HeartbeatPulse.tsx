"use client"

import { motion } from "framer-motion"

interface HeartbeatPulseProps {
  status: "idle" | "running" | "heartbeat"
}

export function HeartbeatPulse({ status }: HeartbeatPulseProps) {
  if (status === "idle") {
    return <span className="w-3 h-3 rounded-full bg-text-muted inline-block" />
  }

  if (status === "running") {
    return (
      <motion.span
        className="w-3 h-3 rounded-full bg-accent-amber inline-block"
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      />
    )
  }

  // heartbeat pulse
  return (
    <motion.span
      className="w-3 h-3 rounded-full bg-accent-green inline-block"
      animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
      transition={{ duration: 0.6, ease: "easeInOut" }}
    />
  )
}
