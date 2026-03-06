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
  approvals: Approval[]
}

export interface Approval {
  id: string
  type: "trade" | "hard_trigger" | "strategy_proposal"
  created_at: string
  expires_at: string
  strategy_id: string
  description: string
  // trade fields
  symbol?: string
  transaction_type?: string
  quantity?: number
  entry_price?: number
  stop_loss_price?: number
  target_price?: number
  thesis?: string
  product_type?: string
  // hard_trigger fields
  trigger_id?: string
  trigger_type?: string
  action?: string
  reason?: string
  // strategy_proposal fields
  proposal_strategy_id?: string
  name?: string
  rules?: string
  capital_allocation?: number
  risk_config?: {
    max_risk_per_trade_pct?: number
    max_open_positions?: number
  }
}

export interface Strategy {
  id: string
  name: string
  status: "active" | "paused" | "archived"
  capital_allocation?: number
  risk_config?: {
    max_risk_per_trade_pct?: number
    max_open_positions?: number
  }
  thesis?: string
  rules?: string
  learnings?: string
  created_at?: string
  updated_at?: string
  total_realized?: number
  total_trades?: number
}

export interface StrategyProposalItem {
  id: string
  tool: string
  inputs: {
    id: string
    name: string
    thesis: string
    rules: string
    capital_allocation?: number
    risk_config?: {
      max_risk_per_trade_pct?: number
      max_open_positions?: number
    }
  }
  status: "pending" | "accepted" | "rejected"
}

// Kept for backward compatibility — used as a fallback display shape
export interface StrategyConfig {
  id: string
  name: string
  live: boolean
  goal: string
  subtitle: string
}
