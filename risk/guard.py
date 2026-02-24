from datetime import datetime
import pytz

_IST = pytz.timezone("Asia/Kolkata")


class RiskGuard:
    MAX_POSITION_PCT     = 0.40   # 40% of capital per trade
    MAX_POSITIONS        = 2
    MIN_SL_PCT           = 0.015  # stop loss must be ≥1.5% below entry
    MAX_SL_PCT           = 0.025  # stop loss must be ≤2.5% below entry
    DAILY_LOSS_LIMIT_PCT = 0.05   # 5% of seed capital

    def __init__(self, seed_capital: float):
        self.seed_capital = seed_capital

    def validate(
        self,
        entry_price: float,
        quantity: int,
        stop_loss_price: float,
        open_position_count: int,
        available_funds: float,
        day_pnl: float,
    ) -> tuple[bool, str]:
        position_value = entry_price * quantity
        sl_pct = (entry_price - stop_loss_price) / entry_price

        now = datetime.now(_IST)
        market_open_time = now.replace(hour=9, minute=30, second=0, microsecond=0)
        if now < market_open_time:
            return False, f"No entries before 9:30 AM IST — first candle not yet closed (now {now.strftime('%H:%M')} IST)"

        if open_position_count >= self.MAX_POSITIONS:
            return False, f"Already at max {self.MAX_POSITIONS} open positions"
        if position_value > self.seed_capital * self.MAX_POSITION_PCT:
            return False, f"Position ₹{position_value:.0f} exceeds 40% cap (₹{self.seed_capital * 0.4:.0f})"
        if position_value > available_funds:
            return False, f"Insufficient funds: need ₹{position_value:.0f}, have ₹{available_funds:.0f}"
        if not (self.MIN_SL_PCT <= sl_pct <= self.MAX_SL_PCT):
            return False, f"Stop loss {sl_pct*100:.1f}% must be 1.5–2.5% below entry"
        if day_pnl < -(self.seed_capital * self.DAILY_LOSS_LIMIT_PCT):
            return False, f"Daily loss limit hit (₹{day_pnl:.0f}). No new trades today."
        return True, "ok"
