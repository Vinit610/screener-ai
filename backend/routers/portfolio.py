"""
Portfolio & Paper-Trading endpoints.

POST /api/portfolio/upload     — upload broker CSV/XLSX
GET  /api/portfolio            — get holdings + P&L
POST /api/portfolio/holding    — manually add holding
DELETE /api/portfolio/holding/{id} — delete a holding

POST /api/portfolio/paper/buy   — paper buy
POST /api/portfolio/paper/sell  — paper sell
GET  /api/portfolio/paper       — paper portfolio overview
POST /api/portfolio/paper/reset — reset paper portfolio
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from database import supabase
from dependencies.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class AddHoldingRequest(BaseModel):
    symbol: str
    instrument_type: Literal["stock", "mf"] = "stock"
    quantity: float
    avg_buy_price: float
    buy_date: date | None = None
    broker: str | None = None


class HoldingOut(BaseModel):
    id: str
    symbol: str
    instrument_type: str
    quantity: float
    avg_buy_price: float
    current_value: float | None = None
    unrealised_pnl: float | None = None
    buy_date: str | None = None
    broker: str | None = None
    is_paper: bool = False
    created_at: str | None = None


class PortfolioResponse(BaseModel):
    total_invested: float
    total_current_value: float
    total_pnl: float
    total_pnl_pct: float
    holdings: list[HoldingOut]


class PaperTradeRequest(BaseModel):
    symbol: str
    quantity: float


class PaperTradeOut(BaseModel):
    id: str
    symbol: str
    trade_type: str
    quantity: float
    price: float
    total_value: float
    traded_at: str | None = None


class PaperPortfolioResponse(BaseModel):
    cash_balance: float
    holdings: list[HoldingOut]
    total_holdings_value: float
    total_portfolio_value: float
    pnl_vs_baseline: float
    pnl_pct: float
    trades: list[PaperTradeOut]


class UploadResponse(BaseModel):
    parsed_holdings: list[dict]
    broker_detected: str | None = None
    count: int


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_latest_price(symbol: str) -> float | None:
    """Return the latest close price for a symbol from stock_prices."""
    stock_resp = (
        supabase.table("stocks")
        .select("id")
        .eq("symbol", symbol.upper())
        .eq("is_active", True)
        .maybe_single()
        .execute()
    )
    if not stock_resp or not stock_resp.data:
        return None
    stock_id = stock_resp.data["id"]
    price_resp = (
        supabase.table("stock_prices")
        .select("close")
        .eq("stock_id", stock_id)
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    rows = price_resp.data or []
    return rows[0]["close"] if rows else None


def _detect_broker(header: list[str]) -> str | None:
    """Heuristic broker detection from CSV column headers."""
    joined = ",".join(h.lower().strip() for h in header)
    if "tradingsymbol" in joined or "isin" in joined and "average_price" in joined:
        return "zerodha"
    if "folio" in joined or "scheme" in joined:
        return "groww"
    if "token" in joined and "symbol" in joined:
        return "upstox"
    return "other"


def _parse_csv_holdings(content: str) -> tuple[list[dict], str | None]:
    """Parse a broker CSV into a list of holding dicts.

    Returns (holdings, detected_broker).
    """
    reader = csv.DictReader(io.StringIO(content))
    fieldnames = reader.fieldnames or []
    broker = _detect_broker(fieldnames)

    lower_fields = {f.lower().strip(): f for f in fieldnames}
    holdings: list[dict] = []

    for row in reader:
        # normalise keys
        lrow = {k.lower().strip(): v for k, v in row.items()}

        symbol = (
            lrow.get("tradingsymbol")
            or lrow.get("symbol")
            or lrow.get("scrip name")
            or lrow.get("stock symbol")
            or ""
        ).strip().upper()
        if not symbol:
            continue

        qty_raw = (
            lrow.get("quantity")
            or lrow.get("qty")
            or lrow.get("net qty")
            or "0"
        )
        try:
            quantity = float(str(qty_raw).replace(",", ""))
        except ValueError:
            continue

        price_raw = (
            lrow.get("average_price")
            or lrow.get("avg price")
            or lrow.get("buy avg")
            or lrow.get("avg. cost")
            or "0"
        )
        try:
            avg_buy_price = float(str(price_raw).replace(",", ""))
        except ValueError:
            avg_buy_price = 0

        if quantity <= 0:
            continue

        holdings.append(
            {
                "symbol": symbol,
                "instrument_type": "stock",
                "quantity": quantity,
                "avg_buy_price": avg_buy_price,
            }
        )

    return holdings, broker


# ── POST /upload ──────────────────────────────────────────────────────────────

@router.post("/upload", response_model=UploadResponse)
async def upload_portfolio(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
):
    if file.content_type not in (
        "text/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/octet-stream",
    ):
        raise HTTPException(400, "Unsupported file type. Upload a CSV or XLSX file.")

    raw = await file.read()
    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError:
        content = raw.decode("latin-1")

    holdings, broker = _parse_csv_holdings(content)
    if not holdings:
        raise HTTPException(400, "Could not detect broker format. Try manual entry.")

    # Persist parsed holdings
    rows = []
    for h in holdings:
        current_price = _get_latest_price(h["symbol"])
        current_value = (current_price * h["quantity"]) if current_price else None
        rows.append(
            {
                "user_id": user_id,
                "symbol": h["symbol"],
                "instrument_type": h["instrument_type"],
                "quantity": h["quantity"],
                "avg_buy_price": h["avg_buy_price"],
                "current_value": current_value,
                "is_paper": False,
            }
        )

    if rows:
        supabase.table("portfolio_holdings").insert(rows).execute()

    return UploadResponse(
        parsed_holdings=holdings,
        broker_detected=broker,
        count=len(holdings),
    )


# ── GET / ─────────────────────────────────────────────────────────────────────

@router.get("/", response_model=PortfolioResponse)
def get_portfolio(user_id: str = Depends(get_current_user)):
    resp = (
        supabase.table("portfolio_holdings")
        .select("*")
        .eq("user_id", user_id)
        .eq("is_paper", False)
        .execute()
    )
    holdings = resp.data or []

    total_invested = 0.0
    total_current = 0.0

    enriched: list[dict] = []
    for h in holdings:
        invested = h["quantity"] * h["avg_buy_price"]
        total_invested += invested
        cv = h.get("current_value")
        if cv is not None:
            total_current += cv
        else:
            total_current += invested  # fallback
        enriched.append(h)

    pnl = total_current - total_invested
    pnl_pct = (pnl / total_invested * 100) if total_invested else 0.0

    return PortfolioResponse(
        total_invested=round(total_invested, 2),
        total_current_value=round(total_current, 2),
        total_pnl=round(pnl, 2),
        total_pnl_pct=round(pnl_pct, 2),
        holdings=enriched,
    )


# ── POST /holding ─────────────────────────────────────────────────────────────

@router.post("/holding", response_model=HoldingOut)
def add_holding(
    body: AddHoldingRequest,
    user_id: str = Depends(get_current_user),
):
    current_price = _get_latest_price(body.symbol)
    current_value = (current_price * body.quantity) if current_price else None

    row = {
        "user_id": user_id,
        "symbol": body.symbol.upper(),
        "instrument_type": body.instrument_type,
        "quantity": body.quantity,
        "avg_buy_price": body.avg_buy_price,
        "current_value": current_value,
        "buy_date": body.buy_date.isoformat() if body.buy_date else None,
        "broker": body.broker,
        "is_paper": False,
    }
    resp = supabase.table("portfolio_holdings").insert(row).execute()
    if not resp.data:
        raise HTTPException(500, "Failed to insert holding")
    return resp.data[0]


# ── DELETE /holding/{id} ──────────────────────────────────────────────────────

@router.delete("/holding/{holding_id}")
def delete_holding(
    holding_id: str,
    user_id: str = Depends(get_current_user),
):
    resp = (
        supabase.table("portfolio_holdings")
        .delete()
        .eq("id", holding_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Holding not found")
    return {"deleted": True}


# ── Paper Trading: POST /paper/buy ────────────────────────────────────────────

def _ensure_paper_portfolio(user_id: str) -> dict:
    """Get or create the paper_portfolio row for the user."""
    resp = (
        supabase.table("paper_portfolio")
        .select("*")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if resp and resp.data:
        return resp.data
    ins = (
        supabase.table("paper_portfolio")
        .insert({"user_id": user_id, "cash_balance": 1000000.00})
        .execute()
    )
    return ins.data[0]


@router.post("/paper/buy")
def paper_buy(
    body: PaperTradeRequest,
    user_id: str = Depends(get_current_user),
):
    price = _get_latest_price(body.symbol)
    if price is None:
        raise HTTPException(404, f"No price data for {body.symbol}")

    total_cost = body.quantity * price
    portfolio = _ensure_paper_portfolio(user_id)

    if portfolio["cash_balance"] < total_cost:
        raise HTTPException(
            400,
            f"Insufficient cash. Need ₹{total_cost:,.2f}, have ₹{portfolio['cash_balance']:,.2f}",
        )

    # Deduct cash
    new_balance = portfolio["cash_balance"] - total_cost
    supabase.table("paper_portfolio").update(
        {"cash_balance": new_balance, "updated_at": "now()"}
    ).eq("user_id", user_id).execute()

    # Record trade
    supabase.table("paper_trades").insert(
        {
            "user_id": user_id,
            "symbol": body.symbol.upper(),
            "trade_type": "buy",
            "quantity": body.quantity,
            "price": price,
            "total_value": total_cost,
        }
    ).execute()

    # Upsert holding in portfolio_holdings (is_paper=true)
    existing = (
        supabase.table("portfolio_holdings")
        .select("*")
        .eq("user_id", user_id)
        .eq("symbol", body.symbol.upper())
        .eq("is_paper", True)
        .maybe_single()
        .execute()
    )

    if existing and existing.data:
        old_qty = existing.data["quantity"]
        old_avg = existing.data["avg_buy_price"]
        new_qty = old_qty + body.quantity
        new_avg = ((old_avg * old_qty) + (price * body.quantity)) / new_qty
        new_cv = new_qty * price
        supabase.table("portfolio_holdings").update(
            {
                "quantity": new_qty,
                "avg_buy_price": round(new_avg, 2),
                "current_value": round(new_cv, 2),
            }
        ).eq("id", existing.data["id"]).execute()
    else:
        supabase.table("portfolio_holdings").insert(
            {
                "user_id": user_id,
                "symbol": body.symbol.upper(),
                "instrument_type": "stock",
                "quantity": body.quantity,
                "avg_buy_price": price,
                "current_value": round(body.quantity * price, 2),
                "is_paper": True,
            }
        ).execute()

    return {
        "message": f"Bought {body.quantity} of {body.symbol.upper()} at ₹{price:,.2f}",
        "total_cost": round(total_cost, 2),
        "cash_remaining": round(new_balance, 2),
    }


# ── Paper Trading: POST /paper/sell ───────────────────────────────────────────

@router.post("/paper/sell")
def paper_sell(
    body: PaperTradeRequest,
    user_id: str = Depends(get_current_user),
):
    price = _get_latest_price(body.symbol)
    if price is None:
        raise HTTPException(404, f"No price data for {body.symbol}")

    # Check existing paper holding
    existing = (
        supabase.table("portfolio_holdings")
        .select("*")
        .eq("user_id", user_id)
        .eq("symbol", body.symbol.upper())
        .eq("is_paper", True)
        .maybe_single()
        .execute()
    )
    if not existing or not existing.data or existing.data["quantity"] < body.quantity:
        held = existing.data["quantity"] if (existing and existing.data) else 0
        raise HTTPException(
            400,
            f"Insufficient holdings. You hold {held} of {body.symbol.upper()}",
        )

    total_proceeds = body.quantity * price
    portfolio = _ensure_paper_portfolio(user_id)
    new_balance = portfolio["cash_balance"] + total_proceeds

    # Credit cash
    supabase.table("paper_portfolio").update(
        {"cash_balance": new_balance, "updated_at": "now()"}
    ).eq("user_id", user_id).execute()

    # Record trade
    supabase.table("paper_trades").insert(
        {
            "user_id": user_id,
            "symbol": body.symbol.upper(),
            "trade_type": "sell",
            "quantity": body.quantity,
            "price": price,
            "total_value": total_proceeds,
        }
    ).execute()

    # Update or delete holding
    new_qty = existing.data["quantity"] - body.quantity
    if new_qty <= 0:
        supabase.table("portfolio_holdings").delete().eq(
            "id", existing.data["id"]
        ).execute()
    else:
        new_cv = new_qty * price
        supabase.table("portfolio_holdings").update(
            {"quantity": new_qty, "current_value": round(new_cv, 2)}
        ).eq("id", existing.data["id"]).execute()

    return {
        "message": f"Sold {body.quantity} of {body.symbol.upper()} at ₹{price:,.2f}",
        "total_proceeds": round(total_proceeds, 2),
        "cash_remaining": round(new_balance, 2),
    }


# ── Paper Trading: GET /paper ─────────────────────────────────────────────────

@router.get("/paper", response_model=PaperPortfolioResponse)
def get_paper_portfolio(user_id: str = Depends(get_current_user)):
    portfolio = _ensure_paper_portfolio(user_id)

    # Holdings
    holdings_resp = (
        supabase.table("portfolio_holdings")
        .select("*")
        .eq("user_id", user_id)
        .eq("is_paper", True)
        .execute()
    )
    holdings = holdings_resp.data or []

    total_holdings_value = 0.0
    for h in holdings:
        cv = h.get("current_value") or (h["quantity"] * h["avg_buy_price"])
        total_holdings_value += cv

    total_portfolio = portfolio["cash_balance"] + total_holdings_value
    baseline = 1000000.00
    pnl = total_portfolio - baseline
    pnl_pct = (pnl / baseline) * 100

    # Trade history
    trades_resp = (
        supabase.table("paper_trades")
        .select("*")
        .eq("user_id", user_id)
        .order("traded_at", desc=True)
        .limit(100)
        .execute()
    )
    trades = trades_resp.data or []

    return PaperPortfolioResponse(
        cash_balance=round(portfolio["cash_balance"], 2),
        holdings=holdings,
        total_holdings_value=round(total_holdings_value, 2),
        total_portfolio_value=round(total_portfolio, 2),
        pnl_vs_baseline=round(pnl, 2),
        pnl_pct=round(pnl_pct, 2),
        trades=trades,
    )


# ── Paper Trading: POST /paper/reset ──────────────────────────────────────────

@router.post("/paper/reset")
def reset_paper_portfolio(user_id: str = Depends(get_current_user)):
    # Delete paper holdings
    supabase.table("portfolio_holdings").delete().eq(
        "user_id", user_id
    ).eq("is_paper", True).execute()

    # Delete paper trades
    supabase.table("paper_trades").delete().eq("user_id", user_id).execute()

    # Reset or create paper portfolio with default cash
    existing = (
        supabase.table("paper_portfolio")
        .select("id")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if existing and existing.data:
        supabase.table("paper_portfolio").update(
            {"cash_balance": 1000000.00, "updated_at": "now()"}
        ).eq("user_id", user_id).execute()
    else:
        supabase.table("paper_portfolio").insert(
            {"user_id": user_id, "cash_balance": 1000000.00}
        ).execute()

    return {"message": "Paper portfolio reset to ₹10,00,000"}