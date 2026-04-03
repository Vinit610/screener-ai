"""
AI service — Gemini Flash client and all AI-powered functions.

Functions:
  1. parse_natural_language_query  — NL → screener filter JSON
  2. validate_filter_output        — strip invalid / hallucinated keys
  3. stream_stock_explanation      — SSE stream of per-stock AI insight
  4. stream_comparison             — SSE stream of head-to-head narrative
  5. classify_chat_intent          — route user message to appropriate handler
  6. stream_chat_response          — general-purpose stock chat (SSE)
"""
from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

from google import genai
from google.genai import types

from config import settings

logger = logging.getLogger(__name__)

# ── Client setup ─────────────────────────────────────────────────────────────

client = genai.Client(api_key=settings.gemini_api_key)
MODEL_ID = "gemini-2.5-flash"

# ── Prompts ──────────────────────────────────────────────────────────────────

NL_TO_FILTER_PROMPT = """
You are a filter parser for an Indian stock screener.

AVAILABLE FILTERS:
- market_cap_category: "large" (>20,000 Cr) | "mid" (5,000-20,000 Cr) | "small" (500-5,000 Cr) | "micro" (<500 Cr)
- min_pe / max_pe: number (P/E ratio)
- min_pb / max_pb: number (P/B ratio)
- min_roe / max_roe: number (percentage, e.g. 15 means 15%)
- min_roce / max_roce: number (percentage)
- max_debt_to_equity: number (ratio, e.g. 0.5 means 0.5x)
- min_net_margin: number (percentage)
- min_dividend_yield: number (percentage)
- sector: one of exactly — "IT", "Banking", "FMCG", "Pharma", "Auto", "Energy",
  "Metals", "Infrastructure", "Real Estate", "Chemicals", "Telecom", "Financial Services"
- exclude_loss_making: boolean (true removes companies with negative net profit)

RULES:
1. Return ONLY a valid JSON object. No markdown, no explanation, no code blocks.
2. Only include filters explicitly implied by the user's query.
3. "Low debt" → max_debt_to_equity: 0.5
4. "Profitable" or "profit-making" → exclude_loss_making: true
5. "High ROE" → min_roe: 15 (use 15 as default threshold unless specified)
6. "Undervalued" → max_pe: 15
7. "Dividend stocks" → min_dividend_yield: 2
8. "Small-cap" → market_cap_category: "small"
9. "Blue chips" or "Large-cap" → market_cap_category: "large"
10. If ambiguous, use conservative defaults. If completely unclear, return {{}}.

EXAMPLES:
Query: "show me profitable small-caps with low debt"
Output: {{"market_cap_category": "small", "exclude_loss_making": true, "max_debt_to_equity": 0.5}}

Query: "IT companies with high ROE and low PE"
Output: {{"sector": "IT", "min_roe": 15, "max_pe": 20}}

Query: "dividend paying pharma stocks"
Output: {{"sector": "Pharma", "min_dividend_yield": 2}}

Query: "undervalued banking stocks with good margins"
Output: {{"sector": "Banking", "max_pe": 15, "min_net_margin": 10}}

USER QUERY: {user_query}
OUTPUT:
"""

STOCK_EXPLANATION_PROMPTS = {
    "value": """You are a value investing analyst focused on Indian equities.
In 3-4 sentences, explain why this stock appears in the screener results and assess it
through a value investing lens. Mention PE vs sector, balance sheet quality, and ROE.
Avoid generic statements. Be direct. Do not say "Buy" or "Sell".
End with one risk flag if applicable.

Stock: {name} ({symbol})
Sector: {sector}
PE: {pe}
PB: {pb}
ROE: {roe}%
D/E: {debt_to_equity}
Net Margin: {net_margin}%
Dividend Yield: {dividend_yield}%
Market Cap: {market_cap_cr} Cr
""",
    "growth": """You are a growth investing analyst focused on Indian equities.
In 3-4 sentences, explain why this stock appears in the screener results.
Focus on ROE trend, ROCE, and margin profile.
Do not say "Buy" or "Sell". Be direct and specific to the numbers.

Stock: {name} ({symbol})
Sector: {sector}
ROE: {roe}%
ROCE: {roce}%
Net Margin: {net_margin}%
PE: {pe}
EPS: {eps}
Market Cap: {market_cap_cr} Cr
""",
    "dividend": """You are a dividend investing analyst focused on Indian equities.
In 3-4 sentences, explain why this stock appears in the screener results.
Focus on dividend yield sustainability, payout history, and balance sheet strength.
Do not say "Buy" or "Sell".

Stock: {name} ({symbol})
Dividend Yield: {dividend_yield}%
D/E: {debt_to_equity}
Net Profit: {net_profit_cr} Cr
PE: {pe}
Market Cap: {market_cap_cr} Cr
""",
}

COMPARISON_PROMPT = """Compare these two Indian stocks for an investor with a {investment_style} focus.

{name_a} ({symbol_a}):
PE: {pe_a} | PB: {pb_a} | ROE: {roe_a}% | D/E: {de_a} | Net Margin: {margin_a}%

{name_b} ({symbol_b}):
PE: {pe_b} | PB: {pb_b} | ROE: {roe_b}% | D/E: {de_b} | Net Margin: {margin_b}%

First, output a JSON object on a single line with this exact structure:
{{"winner_pe": "{symbol_a} or {symbol_b}", "winner_roe": "...", "winner_de": "...", "winner_margin": "...", "overall_winner": "...", "confidence": "high|medium|low"}}

Then, on a new line, write 3-4 sentences comparing them from a {investment_style} perspective.
No "Buy" or "Sell". Be direct. State which you'd watch more closely and why.
End with one key risk for each.
"""

# ── Validation constants ─────────────────────────────────────────────────────

VALID_FILTER_KEYS = {
    "market_cap_category", "min_pe", "max_pe", "min_pb", "max_pb",
    "min_roe", "max_roe", "min_roce", "max_roce", "max_debt_to_equity",
    "min_net_margin", "min_dividend_yield", "sector", "exclude_loss_making",
}

VALID_SECTORS = {
    "IT", "Banking", "FMCG", "Pharma", "Auto", "Energy",
    "Metals", "Infrastructure", "Real Estate", "Chemicals",
    "Telecom", "Financial Services",
}

VALID_MARKET_CAP_CATEGORIES = {"large", "mid", "small", "micro"}

# ── Intent classification & chat prompts ─────────────────────────────────────

INTENT_CLASSIFICATION_PROMPT = """You are an intent classifier for an Indian stock screener chat.

Classify the user message into ONE of these intents:
- "filter": The user wants to screen/filter stocks by criteria (e.g. "show me IT stocks with high ROE", "small cap stocks with low debt")
- "stock_query": The user is asking about a specific stock or company (e.g. "tell me about TCS", "analyze Reliance fundamentals", "is INFY overvalued?")
- "general": The user is asking a general finance/market question or having a conversation (e.g. "what is PE ratio?", "how to analyze a stock?", "hello")

Also extract the stock symbol if present (Indian NSE symbols like TCS, INFY, RELIANCE, HDFCBANK etc.).

Return ONLY a JSON object:
{{"intent": "filter|stock_query|general", "symbol": "SYMBOL_OR_NULL", "query": "original query"}}

If no specific stock symbol is mentioned, set symbol to null.

USER MESSAGE: {user_message}
OUTPUT:
"""

STOCK_CHAT_PROMPT = """You are a knowledgeable Indian equity analyst assistant. The user wants to understand {symbol} ({name}) in depth.

Here are the current fundamentals:
- Sector: {sector}
- Market Cap: {market_cap_cr} Cr
- PE Ratio: {pe}
- PB Ratio: {pb}
- ROE: {roe}%
- ROCE: {roce}%
- Debt to Equity: {debt_to_equity}
- Net Margin: {net_margin}%
- Operating Margin: {operating_margin}%
- EPS: {eps}
- Revenue: {revenue_cr} Cr
- Net Profit: {net_profit_cr} Cr
- Dividend Yield: {dividend_yield}%
- Book Value: {book_value}
- Graham Number: {graham_number}

User's question: {user_question}

Provide a detailed, data-driven analysis. Reference the actual numbers above. Be specific, not generic.
Structure your response clearly. If the user asked a specific question, answer it directly.
If they just want a general overview, cover: valuation, profitability, balance sheet strength, and key risks.
Do NOT say "Buy" or "Sell". Use phrases like "appears attractively valued" or "warrants caution".
Keep the tone educational and analytical. Use ₹ for currency and Cr for crores.
"""

GENERAL_CHAT_PROMPT = """You are a helpful Indian stock market assistant for a screener app.
You can help users understand financial concepts, analyze stocks, and use the screener.

Key capabilities you should mention when relevant:
- Users can ask you to filter stocks (e.g. "show me profitable IT stocks with low debt")
- Users can ask about specific stocks (e.g. "analyze TCS fundamentals")
- Users can compare stocks using the comparison feature
- The screener has filters for PE, PB, ROE, ROCE, D/E, Net Margin, Dividend Yield, Sector, Market Cap

Be concise but informative. Use Indian market context (NSE/BSE, ₹, Cr).
Do NOT give investment advice. Use educational language only.

User message: {user_message}
"""

# ── Functions ────────────────────────────────────────────────────────────────


def validate_filter_output(raw: dict) -> dict:
    """Strip any keys not in VALID_FILTER_KEYS. Never raises."""
    cleaned: dict = {}
    for key, value in raw.items():
        if key not in VALID_FILTER_KEYS:
            continue
        if key == "sector" and value not in VALID_SECTORS:
            continue
        if key == "market_cap_category" and value not in VALID_MARKET_CAP_CATEGORIES:
            continue
        if key == "exclude_loss_making" and not isinstance(value, bool):
            continue
        # Numeric filters – ensure they are numbers
        if key.startswith("min_") or key.startswith("max_"):
            if not isinstance(value, (int, float)):
                continue
        cleaned[key] = value
    return cleaned


async def parse_natural_language_query(query: str) -> dict:
    """Send the user's NL query to Gemini and return a filter dict."""
    prompt = NL_TO_FILTER_PROMPT.format(user_query=query)
    try:
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )
        text = response.text.strip()
        return json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Gemini returned non-JSON for query: %s", query)
        return {}
    except Exception as exc:
        logger.error("Gemini NL→filter failed: %s", exc)
        return {}


async def stream_stock_explanation(
    symbol: str,
    investment_style: str,
    fundamentals: dict,
) -> AsyncGenerator[str, None]:
    """Yield SSE events with streamed AI explanation tokens."""
    style = investment_style if investment_style in STOCK_EXPLANATION_PROMPTS else "value"

    # Build template kwargs with safe defaults
    tpl_kwargs = {
        "name": fundamentals.get("name", symbol),
        "symbol": symbol,
        "sector": fundamentals.get("sector", "N/A"),
        "pe": fundamentals.get("pe", "N/A"),
        "pb": fundamentals.get("pb", "N/A"),
        "roe": fundamentals.get("roe", "N/A"),
        "roce": fundamentals.get("roce", "N/A"),
        "debt_to_equity": fundamentals.get("debt_to_equity", "N/A"),
        "net_margin": fundamentals.get("net_margin", "N/A"),
        "dividend_yield": fundamentals.get("dividend_yield", "N/A"),
        "market_cap_cr": fundamentals.get("market_cap_cr", "N/A"),
        "eps": fundamentals.get("eps", "N/A"),
        "net_profit_cr": fundamentals.get("net_profit_cr", "N/A"),
    }
    prompt = STOCK_EXPLANATION_PROMPTS[style].format(**tpl_kwargs)

    try:
        response = client.models.generate_content_stream(
            model=MODEL_ID,
            contents=prompt,
        )
        for chunk in response:
            if chunk.text:
                yield f"data: {json.dumps({'token': chunk.text})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as exc:
        logger.error("Gemini stream_stock_explanation failed: %s", exc)
        yield f"data: {json.dumps({'token': f'Error generating explanation: {exc}'})}\n\n"
        yield "data: [DONE]\n\n"


async def stream_comparison(
    symbol_a: str,
    symbol_b: str,
    investment_style: str,
    data_a: dict,
    data_b: dict,
) -> AsyncGenerator[str, None]:
    """Yield SSE events: first a structured JSON winner, then narrative tokens."""
    fund_a = data_a.get("fundamentals") or {}
    fund_b = data_b.get("fundamentals") or {}

    tpl_kwargs = {
        "investment_style": investment_style,
        "name_a": data_a.get("name", symbol_a),
        "symbol_a": symbol_a,
        "pe_a": fund_a.get("pe", "N/A"),
        "pb_a": fund_a.get("pb", "N/A"),
        "roe_a": fund_a.get("roe", "N/A"),
        "de_a": fund_a.get("debt_to_equity", "N/A"),
        "margin_a": fund_a.get("net_margin", "N/A"),
        "name_b": data_b.get("name", symbol_b),
        "symbol_b": symbol_b,
        "pe_b": fund_b.get("pe", "N/A"),
        "pb_b": fund_b.get("pb", "N/A"),
        "roe_b": fund_b.get("roe", "N/A"),
        "de_b": fund_b.get("debt_to_equity", "N/A"),
        "margin_b": fund_b.get("net_margin", "N/A"),
    }
    prompt = COMPARISON_PROMPT.format(**tpl_kwargs)

    sent_structured = False
    full_text = ""

    try:
        response = client.models.generate_content_stream(
            model=MODEL_ID,
            contents=prompt,
        )
        for chunk in response:
            if not chunk.text:
                continue
            full_text += chunk.text

            if "\n" in full_text and not sent_structured:
                first_line = full_text.split("\n")[0].strip()
                try:
                    structured = json.loads(first_line)
                    yield f"data: {json.dumps({'type': 'structured', 'data': structured})}\n\n"
                    sent_structured = True
                    # Send any narrative text after the first line
                    remainder = full_text[full_text.index("\n") + 1 :]
                    if remainder.strip():
                        yield f"data: {json.dumps({'type': 'token', 'text': remainder})}\n\n"
                    continue
                except json.JSONDecodeError:
                    pass

            if sent_structured:
                yield f"data: {json.dumps({'type': 'token', 'text': chunk.text})}\n\n"

        # If we never parsed structured data, send the whole text as narrative
        if not sent_structured and full_text.strip():
            yield f"data: {json.dumps({'type': 'token', 'text': full_text})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"
    except Exception as exc:
        logger.error("Gemini stream_comparison failed: %s", exc)
        yield f"data: {json.dumps({'type': 'token', 'text': f'Error: {exc}'})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"


async def classify_chat_intent(message: str) -> dict:
    """Classify the user's chat message into an intent category."""
    prompt = INTENT_CLASSIFICATION_PROMPT.format(user_message=message)
    try:
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )
        text = response.text.strip()
        result = json.loads(text)
        # Validate intent
        if result.get("intent") not in ("filter", "stock_query", "general"):
            result["intent"] = "general"
        return result
    except Exception as exc:
        logger.error("Gemini intent classification failed: %s", exc)
        return {"intent": "general", "symbol": None, "query": message}


async def stream_stock_chat(
    symbol: str,
    user_question: str,
    stock_data: dict,
) -> AsyncGenerator[str, None]:
    """Stream a detailed fundamental analysis chat response for a specific stock."""
    fundamentals = stock_data.get("fundamentals") or {}
    tpl_kwargs = {
        "name": stock_data.get("name", symbol),
        "symbol": symbol,
        "sector": stock_data.get("sector", "N/A"),
        "pe": stock_data.get("pe", "N/A"),
        "pb": stock_data.get("pb", "N/A"),
        "roe": stock_data.get("roe", "N/A"),
        "roce": stock_data.get("roce", "N/A"),
        "debt_to_equity": stock_data.get("debt_to_equity", "N/A"),
        "net_margin": stock_data.get("net_margin", "N/A"),
        "operating_margin": fundamentals.get("operating_margin", "N/A"),
        "dividend_yield": stock_data.get("dividend_yield", "N/A"),
        "market_cap_cr": stock_data.get("market_cap_cr", "N/A"),
        "eps": stock_data.get("eps", "N/A"),
        "revenue_cr": fundamentals.get("revenue_cr", "N/A"),
        "net_profit_cr": stock_data.get("net_profit_cr", "N/A"),
        "book_value": fundamentals.get("book_value", "N/A"),
        "graham_number": fundamentals.get("graham_number", "N/A"),
        "user_question": user_question,
    }
    prompt = STOCK_CHAT_PROMPT.format(**tpl_kwargs)

    try:
        response = client.models.generate_content_stream(
            model=MODEL_ID,
            contents=prompt,
        )
        for chunk in response:
            if chunk.text:
                yield f"data: {json.dumps({'token': chunk.text})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as exc:
        logger.error("Gemini stream_stock_chat failed: %s", exc)
        yield f"data: {json.dumps({'token': f'Error: {exc}'})}\n\n"
        yield "data: [DONE]\n\n"


async def stream_general_chat(message: str) -> AsyncGenerator[str, None]:
    """Stream a general finance/market chat response."""
    prompt = GENERAL_CHAT_PROMPT.format(user_message=message)

    try:
        response = client.models.generate_content_stream(
            model=MODEL_ID,
            contents=prompt,
        )
        for chunk in response:
            if chunk.text:
                yield f"data: {json.dumps({'token': chunk.text})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as exc:
        logger.error("Gemini stream_general_chat failed: %s", exc)
        yield f"data: {json.dumps({'token': f'Error: {exc}'})}\n\n"
        yield "data: [DONE]\n\n"
