import yfinance as yf


def get_fundamentals(symbol: str) -> dict:
    """
    Fetch fundamental data for an NSE symbol via yfinance.
    symbol: NSE ticker without .NS suffix (e.g. 'RELIANCE')
    """
    ticker = yf.Ticker(f"{symbol}.NS")
    info = ticker.info
    return {
        "symbol":         symbol,
        "pe_ratio":       info.get("trailingPE"),
        "forward_pe":     info.get("forwardPE"),
        "profit_margins": info.get("profitMargins"),
        "revenue_growth": info.get("revenueGrowth"),
        "roe":            info.get("returnOnEquity"),
        "debt_to_equity": info.get("debtToEquity"),
        "market_cap":     info.get("marketCap"),
        "sector":         info.get("sector"),
        "industry":       info.get("industry"),
        "fifty_two_week_high": info.get("fiftyTwoWeekHigh"),
        "fifty_two_week_low":  info.get("fiftyTwoWeekLow"),
        "avg_volume":     info.get("averageVolume"),
    }
