from typing import Optional

def parse_float(val) -> Optional[float]:
    """Safely cast to float, return None on failure."""
    if val is None or val == '':
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None

def format_market_cap_category(market_cap_cr: float) -> str:
    """Return 'large'/'mid'/'small'/'micro' based on INR crore thresholds."""
    if market_cap_cr > 20000:
        return 'large'
    elif market_cap_cr > 5000:
        return 'mid'
    elif market_cap_cr > 500:
        return 'small'
    else:
        return 'micro'