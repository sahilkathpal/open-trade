"use client"

import { Inter, JetBrains_Mono } from "next/font/google"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutDashboard, FileText, BookOpen, Target } from "lucide-react"
import clsx from "clsx"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
})

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/report", label: "Report", icon: FileText },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/strategy", label: "Strategy", icon: Target },
]

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
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
          </nav>

          {/* Main content */}
          <main className="flex-1 overflow-y-auto pt-14 px-6 py-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
