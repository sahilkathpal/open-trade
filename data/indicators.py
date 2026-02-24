import pandas as pd
import pandas_ta as ta


def compute_indicators(df: pd.DataFrame) -> list[dict]:
    """
    Takes OHLCV DataFrame from Dhan, appends all indicators,
    returns last 50 rows as JSON-serializable list of dicts.

    Expected columns: timestamp, open, high, low, close, volume
    """
    if df.empty:
        return []

    df = df.copy()

    # Set datetime index for pandas-ta; set_index("timestamp") removes it from columns
    if "timestamp" in df.columns:
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
        df = df.set_index("timestamp")

    # Trend indicators
    df.ta.sma(length=20, append=True)
    df.ta.ema(length=12, append=True)
    df.ta.ema(length=26, append=True)

    # Momentum
    df.ta.rsi(length=14, append=True)
    df.ta.macd(fast=12, slow=26, signal=9, append=True)

    # Volatility
    df.ta.bbands(length=20, std=2, append=True)
    df.ta.atr(length=14, append=True)

    # Volume-weighted price
    df.ta.vwap(append=True)

    # Return last 50 rows, reset index, convert to records
    result = df.tail(50).reset_index()

    # Convert any Timestamp objects to strings for JSON serialization
    for col in result.select_dtypes(include=["datetime64[ns, Asia/Kolkata]", "datetime64[ns]"]).columns:
        result[col] = result[col].astype(str)

    # Replace NaN with None for JSON compatibility
    result = result.where(pd.notnull(result), None)

    return result.to_dict(orient="records")
