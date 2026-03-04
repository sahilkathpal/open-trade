export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  api_calls: number
  cost_usd: number
  by_job: Record<string, { input: number; output: number; calls: number }>
}

export interface AppState {
  capital: { available_balance: number; used_margin: number }
  positions: Array<{
    symbol: string
    entry_price: number
    current_price: number
    quantity: number
    pnl: number
    stop_loss_price: number
    target_price: number
  }>
  pending_approvals: Record<
    string,
    {
      symbol: string
      security_id: string
      transaction_type: string
      quantity: number
      entry_price: number
      stop_loss_price: number
      thesis: string
      target_price: number
    }
  >
  market_open: boolean
  scheduler_status: { last_premarket: string | null; last_eod: string | null; last_heartbeat: string | null }
  upcoming_jobs: Array<{ id: string; next_run: string; label?: string; last_run?: string | null }>
  token_usage: TokenUsage
  dhan_configured: boolean
  token_expired: boolean
  catchup_available: boolean
  agent_pnl?: { realized: number; unrealized: number; total: number }
  cumulative_realized?: number
  strategy_cumulative_realized?: Record<string, number>
  seed_capital?: number
  autonomous?: boolean
  paused?: boolean
  triggers: Array<{
    id: string
    type: string
    reason: string
    expires_at: string
    symbol?: string
    threshold?: number
    at?: string
    buffer_pct?: number
    above_pct?: number
  }>
}

export interface StrategyConfig {
  id: string
  name: string
  live: boolean
  goal: string
  subtitle: string
}

export const STRATEGY_CONFIGS: Record<string, StrategyConfig> = {
  intraday: {
    id: "intraday",
    name: "Intraday Momentum",
    live: true,
    goal:
      "Trade NSE large-cap stocks intraday using momentum strategies. Claude screens pre-market, sets price triggers, and executes entries — exiting all positions by 3:10 PM.",
    subtitle: "NSE large-cap · MIS · exits by 3:10 PM",
  },
}

export const COMING_SOON_STRATEGIES: StrategyConfig[] = [
  {
    id: "swing",
    name: "Swing Trading",
    live: false,
    goal: "Hold positions for 2–5 days to capture medium-term momentum across NSE stocks.",
    subtitle: "Multi-day positions · overnight risk management",
  },
  {
    id: "longterm",
    name: "Long Term Investing",
    live: false,
    goal:
      "Build a portfolio of fundamentally strong stocks for multi-month holding periods, guided by qualitative research and news.",
    subtitle: "Fundamental analysis · buy and hold",
  },
  {
    id: "custom",
    name: "Custom Strategy",
    live: false,
    goal: "Define your own trading thesis and let Claude build an execution framework around it.",
    subtitle: "Bring your own logic",
  },
]
