"use client"

import { Inter, JetBrains_Mono } from "next/font/google"
import { usePathname, useRouter } from "next/navigation"
import "./globals.css"
import { AuthProvider, useAuth } from "@/lib/auth"
import { Sidebar } from "@/components/Sidebar"
import { auth } from "@/lib/firebase"
import { useEffect, useState, useCallback } from "react"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
})

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading, authFetch } = useAuth()
  const [paused, setPaused] = useState(false)
  const [resuming, setResuming] = useState(false)

  const firebaseConfigured = !!auth

  useEffect(() => {
    if (firebaseConfigured && !loading && !user) {
      router.push("/login")
    }
  }, [firebaseConfigured, loading, user, router])

  // Fetch pause state
  const fetchPauseState = useCallback(async () => {
    try {
      const res = await authFetch("/api/state")
      if (!res.ok) return
      const data = await res.json()
      setPaused(data.paused ?? false)
    } catch { /* silent */ }
  }, [authFetch])

  useEffect(() => {
    if (!user) return
    fetchPauseState()
    const interval = setInterval(fetchPauseState, 15000)
    return () => clearInterval(interval)
  }, [user, fetchPauseState])

  const handleResume = useCallback(async () => {
    setResuming(true)
    try {
      await authFetch("/api/resume", { method: "POST" })
      setPaused(false)
    } catch { /* silent */ }
    finally { setResuming(false) }
  }, [authFetch])

  // Don't render sidebar on login page
  const isLoginPage = pathname?.startsWith("/login")

  if (isLoginPage) {
    return <>{children}</>
  }

  if (firebaseConfigured && loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-text-muted font-mono text-sm">Loading...</div>
      </div>
    )
  }

  if (firebaseConfigured && !user) {
    return null
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {paused && (
        <div className="bg-accent-amber/20 border-b border-accent-amber/30 px-4 py-2 flex items-center justify-center gap-3 shrink-0">
          <span className="text-sm text-accent-amber font-mono">
            Trading paused — no scheduled jobs will run.
          </span>
          <button
            onClick={handleResume}
            disabled={resuming}
            className="text-xs font-semibold font-mono px-3 py-1 rounded border border-accent-amber text-accent-amber hover:bg-accent-amber/10 transition-colors disabled:opacity-50"
          >
            {resuming ? "..." : "Resume"}
          </button>
        </div>
      )}
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <head><title>Vibe Trade</title></head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  )
}
