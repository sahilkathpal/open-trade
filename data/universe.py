from data.dhan_client import _load_instruments


def get_nse_universe() -> list[dict]:
    """
    Return all NSE EQ stocks with their Dhan security_ids.
    Used internally for symbol → security_id resolution only.
    Not exposed as an agent tool (too large to dump into context).
    """
    df = _load_instruments()
    nse_eq = df[
        (df["SEM_EXM_EXCH_ID"] == "NSE") &
        (df["SEM_INSTRUMENT_NAME"] == "EQUITY")
    ].copy()

    return [
        {
            "symbol":      row["SEM_TRADING_SYMBOL"],
            "security_id": str(row["SEM_SMST_SECURITY_ID"]),
            "name":        row.get("SEM_CUSTOM_SYMBOL", row["SEM_TRADING_SYMBOL"]),
        }
        for _, row in nse_eq.iterrows()
    ]
