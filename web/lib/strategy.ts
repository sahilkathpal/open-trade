export const STRATEGIES = [
  { id: "intraday", label: "Intraday Momentum", live: true },
  { id: "swing",    label: "Swing Trading",     live: false },
  { id: "custom",   label: "Custom Strategy",   live: false },
] as const

export type StrategyId = typeof STRATEGIES[number]["id"]

const KEY = "active_strategy"

export function getActiveStrategy(): StrategyId {
  if (typeof window === "undefined") return "intraday"
  return (localStorage.getItem(KEY) as StrategyId) ?? "intraday"
}

export function setActiveStrategy(id: StrategyId) {
  localStorage.setItem(KEY, id)
}

export function getStrategyLabel(id: StrategyId): string {
  return STRATEGIES.find((s) => s.id === id)?.label ?? id
}
