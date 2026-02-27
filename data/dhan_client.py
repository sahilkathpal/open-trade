import logging
import os
import time
import tempfile
from pathlib import Path
from datetime import datetime, timedelta

import pandas as pd
import httpx
from dotenv import load_dotenv
from dhanhq import dhanhq

logger = logging.getLogger(__name__)

load_dotenv()

INSTRUMENT_CSV_URL = "https://images.dhan.co/api-data/api-scrip-master.csv"
INSTRUMENT_CACHE = Path(tempfile.gettempdir()) / "dhan_instruments.csv"
CACHE_TTL_HOURS = 24

_instruments_df: pd.DataFrame | None = None
_instruments_loaded_at: float = 0.0


def _load_instruments() -> pd.DataFrame:
    global _instruments_df, _instruments_loaded_at
    now = time.time()
    if _instruments_df is not None and (now - _instruments_loaded_at) < CACHE_TTL_HOURS * 3600:
        return _instruments_df
    if INSTRUMENT_CACHE.exists():
        mtime = INSTRUMENT_CACHE.stat().st_mtime
        if (now - mtime) < CACHE_TTL_HOURS * 3600:
            _instruments_df = pd.read_csv(INSTRUMENT_CACHE, low_memory=False)
            _instruments_loaded_at = now
            return _instruments_df
    with httpx.Client(timeout=30) as client:
        r = client.get(INSTRUMENT_CSV_URL)
        r.raise_for_status()
        INSTRUMENT_CACHE.write_bytes(r.content)
    _instruments_df = pd.read_csv(INSTRUMENT_CACHE, low_memory=False)
    _instruments_loaded_at = now
    return _instruments_df


SANDBOX_BASE_URL = "https://sandbox.dhan.co/v2"

# Dhan NSE_IDX security IDs for major indices
_INDEX_IDS = {
    "NIFTY50":   13,
    "BANKNIFTY": 25,
    "FINNIFTY":  27,
}


def _is_auth_error(resp: dict) -> bool:
    """Return True if the response indicates an expired or invalid access token (DH-901)."""
    if not isinstance(resp, dict) or resp.get("status") != "failure":
        return False
    remarks = resp.get("remarks") or {}
    if isinstance(remarks, dict):
        return remarks.get("error_code") == "DH-901"
    data = resp.get("data") or {}
    if isinstance(data, dict):
        return data.get("errorCode") == "DH-901"
    return False


class DhanClient:
    def __init__(self, client_id: str = None, access_token: str = None):
        self.configured = bool(client_id and access_token)
        self.dhan = dhanhq(client_id or "unconfigured", access_token or "unconfigured")
        if os.getenv("DHAN_SANDBOX", "false").lower() == "true":
            self.dhan.base_url = SANDBOX_BASE_URL

    def symbol_to_security_id(self, symbol: str) -> str:
        df = _load_instruments()
        # Filter NSE equity segment
        nse_eq = df[
            (df["SEM_EXM_EXCH_ID"] == "NSE") &
            (df["SEM_INSTRUMENT_NAME"] == "EQUITY") &
            (df["SEM_TRADING_SYMBOL"] == symbol)
        ]
        if nse_eq.empty:
            raise ValueError(f"Symbol {symbol} not found in NSE EQ universe")
        return str(nse_eq.iloc[0]["SEM_SMST_SECURITY_ID"])

    def get_quote(self, symbols: list[str]) -> dict:
        """Get live LTP + OHLC + volume for a list of NSE EQ symbols."""
        security_ids = [int(self.symbol_to_security_id(sym)) for sym in symbols]
        result = self.dhan.quote_data({"NSE_EQ": security_ids})
        # Sandbox doesn't support the market feed endpoint — return flat ₹100 mock
        if result.get("status") == "failure" and os.getenv("DHAN_SANDBOX", "false").lower() == "true":
            return {
                "status": "success",
                "data": {sym: {"ltp": 100.0, "open": 100.0, "high": 100.0, "low": 100.0, "close": 100.0, "volume": 100000} for sym in symbols},
                "sandbox_mock": True,
            }
        return result

    def get_history(
        self,
        security_id: str,
        interval: str = "1",
        from_date: str | None = None,
        to_date: str | None = None,
    ) -> pd.DataFrame:
        """Fetch OHLCV history. interval: '1','5','15','60','D'"""
        if to_date is None:
            to_date = datetime.now().strftime("%Y-%m-%d")
        if from_date is None:
            from_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")

        if interval == "D":
            resp = self.dhan.historical_daily_data(
                security_id=security_id,
                exchange_segment="NSE_EQ",
                instrument_type="EQUITY",
                from_date=from_date,
                to_date=to_date,
            )
        else:
            resp = self.dhan.intraday_minute_data(
                security_id=security_id,
                exchange_segment="NSE_EQ",
                instrument_type="EQUITY",
                from_date=from_date,
                to_date=to_date,
                interval=int(interval),  # dhanhq v2.0.x requires int, not str
            )

        if not resp or "data" not in resp:
            return pd.DataFrame()

        data = resp["data"]
        df = pd.DataFrame({
            "timestamp": data.get("timestamp", []),
            "open":      data.get("open", []),
            "high":      data.get("high", []),
            "low":       data.get("low", []),
            "close":     data.get("close", []),
            "volume":    data.get("volume", []),
        })
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="s", utc=True).dt.tz_convert("Asia/Kolkata")
        df = df.sort_values("timestamp").reset_index(drop=True)
        return df

    def place_order(
        self,
        security_id: str,
        txn_type: str,
        qty: int,
        order_type: str,
        product_type: str,
        price: float = 0,
        trigger_price: float = 0,
    ) -> dict:
        """Place an order on Dhan."""
        dhan_txn = "BUY" if txn_type == "BUY" else "SELL"
        dhan_order_type = {
            "MARKET": "MARKET",
            "LIMIT": "LIMIT",
            "STOPLIMIT": "STOP_LOSS",
        }.get(order_type, order_type)
        dhan_product = {
            "INTRA": "INTRADAY",
            "CNC": "CNC",
        }.get(product_type, product_type)

        return self.dhan.place_order(
            security_id=security_id,
            exchange_segment="NSE_EQ",
            transaction_type=dhan_txn,
            quantity=qty,
            order_type=dhan_order_type,
            product_type=dhan_product,
            price=price,
            trigger_price=trigger_price,
        )

    def cancel_order(self, order_id: str) -> dict:
        """Cancel an open order by order ID."""
        resp = self.dhan.cancel_order(order_id=order_id)
        return resp if isinstance(resp, dict) else {"raw": resp}

    def get_positions(self) -> list:
        """Get current open positions."""
        resp = self.dhan.get_positions()
        if isinstance(resp, dict):
            if _is_auth_error(resp):
                return [{"error": "token_expired", "token_expired": True}]
            if "data" in resp:
                return resp["data"] or []
        if isinstance(resp, list):
            return resp
        return []

    def get_index_quote(self, index: str = "NIFTY50") -> dict:
        """Get LTP for a NSE index. index: 'NIFTY50' | 'BANKNIFTY' | 'FINNIFTY'"""
        sec_id = _INDEX_IDS.get(index.upper())
        if sec_id is None:
            return {"error": f"Unknown index: {index}. Supported: {list(_INDEX_IDS.keys())}"}
        return self.dhan.quote_data({"IDX_I": [sec_id]})

    def get_funds(self) -> dict:
        """Returns available_balance, used_margin, day_pnl."""
        resp = self.dhan.get_fund_limits()
        if isinstance(resp, dict):
            if resp.get("status") == "failure":
                if _is_auth_error(resp):
                    logger.warning("Dhan token expired for this account")
                    return {"error": "Dhan access token expired", "token_expired": True}
                logger.error("get_fund_limits API error: %s", resp)
                return {"error": str(resp.get("remarks") or resp.get("message") or resp)}
            data = resp.get("data", resp)
            available = float(data.get("availabelBalance", data.get("available_balance", 0)))
            used      = float(data.get("utilizedAmount", data.get("used_margin", 0)))
            sod       = float(data.get("sodLimit", 0))
            # Dhan doesn't expose realized P&L directly; derive it from SOD limit
            day_pnl   = round((available + used) - sod, 2) if sod else 0.0
            return {
                "available_balance": available,
                "used_margin":       used,
                "day_pnl":           day_pnl,
            }
        return {"available_balance": 0.0, "used_margin": 0.0, "day_pnl": 0.0}
