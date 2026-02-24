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
        background: "#0D1117",
        surface: "#161B22",
        border: "#30363D",
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
