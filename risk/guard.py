from datetime import datetime
import pytz

_IST = pytz.timezone("Asia/Kolkata")


class RiskGuard:
    def __init__(
        self,
        seed_capital: float,
        max_risk_per_trade_pct: float = 2.0,  # % of strategy allocation; default 2%
    ):
        self.seed_capital           = seed_capital
        self.max_risk_per_trade_pct = max_risk_per_trade_pct

    def validate(
        self,
        entry_price: float,
        quantity: int,
        stop_loss_price: float,
        available_funds: float,
        strategy_allocation: float = 0.0,
    ) -> tuple[bool, str]:

        # 1. SL required
        if stop_loss_price <= 0 or stop_loss_price >= entry_price:
            return False, "Stop loss is required and must be below entry price"

        # 2. Market hours (9:30 AM IST)
        now = datetime.now(_IST)
        market_open_time = now.replace(hour=9, minute=30, second=0, microsecond=0)
        if now < market_open_time:
            return False, f"No entries before 9:30 AM IST — first candle not yet closed (now {now.strftime('%H:%M')} IST)"

        # 3. Max risk per trade (% of strategy allocation)
        if strategy_allocation > 0:
            trade_risk = quantity * (entry_price - stop_loss_price)
            limit = strategy_allocation * self.max_risk_per_trade_pct / 100
            if trade_risk > limit:
                return False, (
                    f"Trade risk ₹{trade_risk:.0f} exceeds {self.max_risk_per_trade_pct}% of allocation "
                    f"(₹{limit:.0f})"
                )

        # 4. Available funds (capped by strategy allocation, not broker balance)
        if entry_price * quantity > available_funds:
            return False, f"Insufficient funds: need ₹{entry_price * quantity:.0f}, have ₹{available_funds:.0f}"

        return True, "ok"
