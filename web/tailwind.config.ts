import type { Config } from "tailwindcss"

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "#111111",
        surface: "#1c1c1c",
        border: "#2a2a2a",
        "accent-green": "#3FB950",
        "accent-amber": "#F0883E",
        "accent-red": "#F85149",
        "text-primary": "#E6EDF3",
        "text-muted": "#8B949E",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
}
export default config
