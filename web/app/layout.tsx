"use client"

import { Inter, JetBrains_Mono } from "next/font/google"
import { usePathname, useRouter } from "next/navigation"
import "./globals.css"
import { AuthProvider, useAuth } from "@/lib/auth"
import { Sidebar } from "@/components/Sidebar"
import { auth } from "@/lib/firebase"
import { useEffect } from "react"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
})

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading } = useAuth()

  const firebaseConfigured = !!auth

  useEffect(() => {
    if (firebaseConfigured && !loading && !user) {
      router.push("/login")
    }
  }, [firebaseConfigured, loading, user, router])

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
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
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
