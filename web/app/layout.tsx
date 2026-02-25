"use client"

import { Inter, JetBrains_Mono } from "next/font/google"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { LayoutDashboard, FileText, BookOpen, Target, Settings, LogOut } from "lucide-react"
import clsx from "clsx"
import "./globals.css"
import { AuthProvider, useAuth } from "@/lib/auth"
import { useEffect } from "react"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
})

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/report", label: "Market Brief", icon: FileText },
  { href: "/journal", label: "Trade Journal", icon: BookOpen },
  { href: "/strategy", label: "Strategy", icon: Target },
  { href: "/settings", label: "Settings", icon: Settings },
]

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading, signOut } = useAuth()

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login")
    }
  }, [loading, user, router])

  // Don't render sidebar on login page
  const isLoginPage = pathname?.startsWith("/login")

  if (isLoginPage) {
    return <>{children}</>
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-text-muted font-mono text-sm">Loading...</div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <nav className="w-56 bg-surface border-r border-border flex flex-col pt-16 shrink-0">
        <div className="px-4 py-3 mb-2">
          <span className="text-text-muted text-xs uppercase tracking-wider font-medium">
            Navigation
          </span>
        </div>
        {navItems.map((item) => {
          const Icon = item.icon
          const active = pathname?.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "flex items-center gap-3 px-4 py-2.5 mx-2 rounded-md text-sm transition-colors",
                active
                  ? "bg-background text-text-primary"
                  : "text-text-muted hover:text-text-primary hover:bg-background/50"
              )}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          )
        })}

        {/* User section at bottom */}
        <div className="mt-auto border-t border-border p-4">
          {user.email && (
            <p className="text-xs text-text-muted font-mono truncate mb-3" title={user.email}>
              {user.email}
            </p>
          )}
          <button
            onClick={signOut}
            className="flex items-center gap-2 text-xs text-text-muted hover:text-accent-red transition-colors font-mono"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pt-14 px-6 py-6">
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
      <head><title>vibe-trade</title></head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  )
}
