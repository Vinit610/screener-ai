"use client";

import { clsx } from "clsx";
import { useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface FullFundamentals {
  pe?: number | null;
  forward_pe?: number | null;
  peg?: number | null;
  pb?: number | null;
  ev_to_ebitda?: number | null;
  price_to_sales?: number | null;
  graham_number?: number | null;
  dividend_yield?: number | null;

  roce?: number | null;
  roa?: number | null;
  roe?: number | null;
  is_financial?: boolean | null;
  gross_margin?: number | null;
  ebitda_margin?: number | null;
  operating_margin?: number | null;
  net_margin?: number | null;
  effective_tax_rate?: number | null;

  revenue_cagr_2y?: number | null;
  revenue_cagr_3y?: number | null;
  revenue_cagr_5y?: number | null;
  pat_cagr_2y?: number | null;
  pat_cagr_3y?: number | null;
  pat_cagr_5y?: number | null;
  ebitda_cagr_2y?: number | null;
  ebitda_cagr_3y?: number | null;
  ebitda_cagr_5y?: number | null;
  revenue_growth_yoy?: number | null;
  pat_growth_yoy?: number | null;
  earnings_growth_forward?: number | null;

  fcf_cr?: number | null;
  fcf_yield?: number | null;
  cash_conversion?: number | null;
  interest_coverage?: number | null;
  operating_cash_flow_cr?: number | null;

  debt_to_equity?: number | null;
  net_debt_cr?: number | null;
  net_debt_to_ebitda?: number | null;
  current_ratio?: number | null;
  quick_ratio?: number | null;

  debtor_days?: number | null;
  inventory_days?: number | null;
  payable_days?: number | null;
  cash_conversion_cycle?: number | null;

  revenue_cr?: number | null;
  ebitda_cr?: number | null;
  net_profit_cr?: number | null;
  eps?: number | null;
  forward_eps?: number | null;
  book_value?: number | null;

  latest_period_end?: string | null;
  annual_periods_count?: number | null;
  fundamentals_updated_at?: string | null;
}

// ── Format helpers ─────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, decimals = 2): string {
  if (v == null) return "–";
  return v.toLocaleString("en-IN", { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "–";
  return `${fmt(v)}%`;
}

function fmtCr(v: number | null | undefined): string {
  if (v == null) return "–";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(1)}L Cr`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(1)}K Cr`;
  return `${sign}₹${abs.toFixed(0)} Cr`;
}

function fyLabel(dateStr: string): string {
  const year = new Date(dateStr).getFullYear();
  return `FY${String(year).slice(2)}`;
}

function cagrLabel(latestEnd: string | null | undefined, years: number): string {
  if (!latestEnd) return `${years}Y CAGR`;
  const endYear = new Date(latestEnd).getFullYear();
  const startYear = endYear - years;
  return `${years}Y CAGR (FY${String(startYear).slice(2)}→FY${String(endYear).slice(2)})`;
}

function bestCagr(
  f: FullFundamentals,
  prefix: "revenue" | "pat" | "ebitda"
): { value: number; years: number } | null {
  for (const y of [5, 3, 2] as const) {
    const v = f[`${prefix}_cagr_${y}y`];
    if (v != null) return { value: v, years: y };
  }
  return null;
}

// ── MetricCell ─────────────────────────────────────────────────────────────

interface MetricCellProps {
  label: string;
  value: string;
  tooltip: string;
  subtitle?: string;
  color?: "default" | "green" | "red" | "yellow";
}

function MetricCell({ label, value, tooltip, subtitle, color = "default" }: MetricCellProps) {
  const [showTip, setShowTip] = useState(false);
  return (
    <div className="relative flex flex-col gap-0.5 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center gap-1">
        <span className="truncate text-[11px] text-muted">{label}</span>
        <button
          type="button"
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
          onClick={() => setShowTip((p) => !p)}
          className="shrink-0 text-muted/40 hover:text-muted"
          aria-label={`Info: ${label}`}
        >
          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
          </svg>
        </button>
        {showTip && (
          <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-border bg-surface p-2 text-[11px] leading-relaxed text-muted shadow-lg">
            {tooltip}
          </div>
        )}
      </div>
      <span
        className={clsx(
          "text-sm font-semibold",
          color === "green" && "text-accent",
          color === "red" && "text-danger",
          color === "yellow" && "text-yellow-400",
          color === "default" && "text-foreground"
        )}
      >
        {value}
      </span>
      {subtitle && <span className="text-[10px] text-muted/60">{subtitle}</span>}
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: JSX.Element | (JSX.Element | false | null | undefined)[] }) {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>
    </div>
  );
}

function growthColor(v: number | null | undefined): "green" | "red" | "default" {
  if (v == null) return "default";
  return v > 0 ? "green" : v < 0 ? "red" : "default";
}

// ── Main component ─────────────────────────────────────────────────────────

export default function FundamentalsGrid({ fundamentals }: { fundamentals: FullFundamentals | null }) {
  if (!fundamentals) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
        No fundamental data available. Run the pipeline to populate metrics.
      </div>
    );
  }

  const f = fundamentals;
  const latestEnd = f.latest_period_end;
  const isFinancial = !!f.is_financial;

  // Best CAGR per metric (longest horizon available)
  const revCagr = bestCagr(f, "revenue");
  const patCagr = bestCagr(f, "pat");
  const ebitdaCagr = bestCagr(f, "ebitda");

  // Period footer label
  const dataLabel = latestEnd
    ? `${fyLabel(latestEnd)} data · ${f.annual_periods_count ?? "?"} annual periods`
    : null;

  return (
    <div className="space-y-5">

      {/* Valuation */}
      <Section title="Valuation">
        <MetricCell label="PE (TTM)" value={fmt(f.pe)} tooltip="Trailing price-to-earnings. Compare within same sector — a 'cheap' stock may simply be a slow-grower." />
        <MetricCell label="Fwd PE" value={fmt(f.forward_pe)} tooltip="Price-to-earnings based on next-12-month analyst estimates. Lower than trailing PE suggests expected earnings growth." />
        <MetricCell label="PEG" value={fmt(f.peg)} tooltip="PE divided by expected earnings growth rate. Below 1 may indicate the market is underpricing growth. Above 2 suggests expensive relative to growth."
          color={f.peg != null ? (f.peg < 1 ? "green" : f.peg > 2 ? "red" : "default") : "default"} />
        <MetricCell label="Price/Book" value={fmt(f.pb)} tooltip="Market cap as a multiple of book value (net assets). Key for banks — a PB of 1 means trading at exact book value." />
        <MetricCell label="EV/EBITDA" value={fmt(f.ev_to_ebitda)} tooltip="Enterprise value relative to operating earnings. Useful cross-sector comparison; excludes capital-structure differences." />
        <MetricCell label="Price/Sales" value={fmt(f.price_to_sales)} tooltip="Market cap divided by revenue. Useful when earnings are negative or volatile." />
        {!isFinancial && (
          <MetricCell label="Graham Number" value={f.graham_number != null ? `₹${fmt(f.graham_number)}` : "–"} tooltip="Conservative fair-value estimate: √(22.5 × EPS × Book Value). Below current price suggests margin of safety." />
        )}
        <MetricCell label="Dividend Yield" value={fmtPct(f.dividend_yield)} tooltip="Annual dividend as % of current price. Indian large-caps typically yield 0.5–2%. Higher yield may signal value or distress."
          color={f.dividend_yield != null ? (f.dividend_yield >= 2 ? "green" : "default") : "default"} />
      </Section>

      {/* Returns & Margins */}
      <Section title="Returns & Profitability">
        {isFinancial ? (
          <MetricCell label="ROA" value={fmtPct(f.roa)} tooltip="Return on Assets — the primary return metric for banks and NBFCs. ROCE is not meaningful when assets are funded by customer deposits."
            color={f.roa != null ? (f.roa > 1 ? "green" : f.roa < 0 ? "red" : "default") : "default"} />
        ) : (
          <MetricCell label="ROCE" value={fmtPct(f.roce)} tooltip="Return on Capital Employed = EBIT ÷ (Total Assets − Current Liabilities). Measures how efficiently the company earns from its full capital base."
            color={f.roce != null ? (f.roce > 0 ? "green" : "red") : "default"} />
        )}
        <MetricCell label="ROE" value={fmtPct(f.roe)} tooltip="Return on Equity — profit generated per rupee of shareholder capital. Above 15% is generally strong; watch D/E to see if it's leverage-driven."
          color={f.roe != null ? (f.roe >= 15 ? "green" : f.roe < 0 ? "red" : "default") : "default"} />
        <MetricCell label="EBITDA Margin" value={fmtPct(f.ebitda_margin)} tooltip="Operating earnings before non-cash charges as % of revenue. Compare within sector — capital-light businesses naturally run higher margins."
          color={f.ebitda_margin != null ? (f.ebitda_margin > 0 ? "green" : "red") : "default"} />
        <MetricCell label="Net Margin" value={fmtPct(f.net_margin)} tooltip="Bottom-line profit as % of revenue after all costs, interest, and taxes."
          color={f.net_margin != null ? (f.net_margin > 0 ? "green" : "red") : "default"} />
        {!isFinancial && (
          <MetricCell label="Gross Margin" value={fmtPct(f.gross_margin)} tooltip="Revenue minus cost of goods sold as % of revenue. High gross margins leave room to absorb operating costs."
            color={f.gross_margin != null ? (f.gross_margin > 0 ? "green" : "red") : "default"} />
        )}
        <MetricCell label="Operating Margin" value={fmtPct(f.operating_margin)} tooltip="EBIT as % of revenue — profitability from core operations before interest and tax."
          color={f.operating_margin != null ? (f.operating_margin > 0 ? "green" : "red") : "default"} />
      </Section>

      {/* Growth */}
      <Section title="Growth">
        {revCagr && (
          <MetricCell
            label="Revenue CAGR"
            value={fmtPct(revCagr.value)}
            subtitle={cagrLabel(latestEnd, revCagr.years)}
            tooltip={`Compound annual revenue growth over ${revCagr.years} years. ${latestEnd ? `Period: ${cagrLabel(latestEnd, revCagr.years)}` : ""}`}
            color={growthColor(revCagr.value)}
          />
        )}
        {patCagr && (
          <MetricCell
            label="PAT CAGR"
            value={fmtPct(patCagr.value)}
            subtitle={cagrLabel(latestEnd, patCagr.years)}
            tooltip={`Compound annual profit-after-tax growth over ${patCagr.years} years. One-off items (mergers, write-offs) can distort this — check period context.`}
            color={growthColor(patCagr.value)}
          />
        )}
        {!isFinancial && ebitdaCagr && (
          <MetricCell
            label="EBITDA CAGR"
            value={fmtPct(ebitdaCagr.value)}
            subtitle={cagrLabel(latestEnd, ebitdaCagr.years)}
            tooltip={`Operating earnings growth over ${ebitdaCagr.years} years. Less affected by accounting changes than PAT CAGR.`}
            color={growthColor(ebitdaCagr.value)}
          />
        )}
        <MetricCell label="Revenue YoY" value={fmtPct(f.revenue_growth_yoy)} tooltip="Year-on-year revenue growth from the last two annual periods."
          color={growthColor(f.revenue_growth_yoy)} />
        <MetricCell label="PAT YoY" value={fmtPct(f.pat_growth_yoy)} tooltip="Year-on-year net profit growth from the last two annual periods."
          color={growthColor(f.pat_growth_yoy)} />
        {f.earnings_growth_forward != null && (
          <MetricCell label="Fwd EPS Growth" value={fmtPct(f.earnings_growth_forward)} tooltip="Analyst consensus estimate for next-12-month EPS growth. Forward-looking; revisions can be significant."
            color={growthColor(f.earnings_growth_forward)} />
        )}
      </Section>

      {/* Cash Flow & Quality */}
      <Section title="Cash Flow & Quality">
        <MetricCell label="Free Cash Flow" value={fmtCr(f.fcf_cr)} tooltip="Operating cash flow minus capital expenditure. Positive FCF means the business generates real cash after maintaining/growing its asset base."
          color={f.fcf_cr != null ? (f.fcf_cr > 0 ? "green" : "red") : "default"} />
        <MetricCell label="FCF Yield" value={fmtPct(f.fcf_yield)} tooltip="FCF as % of market cap. Above 5% is generally attractive; acts like a 'real earnings yield' from cash rather than accounting profit."
          color={f.fcf_yield != null ? (f.fcf_yield > 3 ? "green" : f.fcf_yield < 0 ? "red" : "default") : "default"} />
        <MetricCell label="Cash Conversion" value={f.cash_conversion != null ? fmt(f.cash_conversion) : "–"} tooltip="Operating cash flow ÷ net income. Above 1.0 means the company converts reported profit into real cash at better than 100% — a quality signal."
          color={f.cash_conversion != null ? (f.cash_conversion >= 0.8 ? "green" : f.cash_conversion < 0 ? "red" : "default") : "default"} />
        <MetricCell label="Interest Coverage" value={f.interest_coverage != null ? `${fmt(f.interest_coverage)}×` : "–"} tooltip="EBIT ÷ interest expense. Below 1.5× is concerning (earnings may not cover interest); above 3× is generally comfortable."
          color={f.interest_coverage != null ? (f.interest_coverage >= 3 ? "green" : f.interest_coverage < 1.5 ? "red" : "yellow") : "default"} />
        <MetricCell label="Oper. Cash Flow" value={fmtCr(f.operating_cash_flow_cr)} tooltip="Cash generated from business operations before capex. More reliable than net income as it's harder to manipulate."
          color={f.operating_cash_flow_cr != null ? (f.operating_cash_flow_cr > 0 ? "green" : "red") : "default"} />
      </Section>

      {/* Balance Sheet */}
      <Section title="Balance Sheet">
        <MetricCell label="Debt/Equity" value={fmt(f.debt_to_equity)} tooltip="Total debt divided by shareholder equity. Context-dependent — capital-intensive sectors (infra, telecom) run higher leverage than FMCG or IT."
          color={f.debt_to_equity != null ? (f.debt_to_equity > 3 ? "red" : "default") : "default"} />
        <MetricCell label="Net Debt" value={fmtCr(f.net_debt_cr)} tooltip="Total debt minus cash and equivalents. Negative net debt means the company holds more cash than it owes."
          color={f.net_debt_cr != null ? (f.net_debt_cr < 0 ? "green" : "default") : "default"} />
        <MetricCell label="Net Debt/EBITDA" value={f.net_debt_to_ebitda != null ? `${fmt(f.net_debt_to_ebitda)}×` : "–"} tooltip="How many years of operating earnings it would take to repay net debt. Above 3× is generally elevated; negative means net cash position."
          color={f.net_debt_to_ebitda != null ? (f.net_debt_to_ebitda < 0 ? "green" : f.net_debt_to_ebitda > 3 ? "red" : "default") : "default"} />
        <MetricCell label="Current Ratio" value={fmt(f.current_ratio)} tooltip="Current assets ÷ current liabilities. Below 1.0 means short-term liabilities exceed short-term assets."
          color={f.current_ratio != null ? (f.current_ratio >= 1.5 ? "green" : f.current_ratio < 1 ? "red" : "default") : "default"} />
        <MetricCell label="Quick Ratio" value={fmt(f.quick_ratio)} tooltip="Like current ratio but excludes inventory (less liquid). A stricter liquidity test."
          color={f.quick_ratio != null ? (f.quick_ratio >= 1 ? "green" : "red") : "default"} />
      </Section>

      {/* Working Capital (skip for financials — not meaningful for banks) */}
      {!isFinancial && (
        <Section title="Working Capital">
          <MetricCell label="Debtor Days" value={f.debtor_days != null ? `${fmt(f.debtor_days, 0)} days` : "–"} tooltip="Average days to collect payment from customers. Lower is better; rising debtor days may signal collection stress." />
          <MetricCell label="Inventory Days" value={f.inventory_days != null ? `${fmt(f.inventory_days, 0)} days` : "–"} tooltip="Days of inventory held. High inventory days tie up capital and can signal demand softness." />
          <MetricCell label="Payable Days" value={f.payable_days != null ? `${fmt(f.payable_days, 0)} days` : "–"} tooltip="Days taken to pay suppliers. Higher payable days improve cash flow but extreme values may signal financial stress." />
          <MetricCell label="Cash Conv. Cycle" value={f.cash_conversion_cycle != null ? `${fmt(f.cash_conversion_cycle, 0)} days` : "–"} tooltip="Debtor Days + Inventory Days − Payable Days. Negative CCC (e.g., FMCG retailers) is a working-capital advantage — suppliers finance the business."
            color={f.cash_conversion_cycle != null ? (f.cash_conversion_cycle < 0 ? "green" : "default") : "default"} />
        </Section>
      )}

      {/* Scale */}
      <Section title="Scale">
        <MetricCell label="Revenue" value={fmtCr(f.revenue_cr)} tooltip="Total revenue (turnover) in the latest annual period." subtitle={latestEnd ? fyLabel(latestEnd) : undefined} />
        {!isFinancial && (
          <MetricCell label="EBITDA" value={fmtCr(f.ebitda_cr)} tooltip="Earnings before interest, tax, depreciation & amortisation in the latest annual period." subtitle={latestEnd ? fyLabel(latestEnd) : undefined} />
        )}
        <MetricCell label="Net Profit" value={fmtCr(f.net_profit_cr)} tooltip="Profit after tax in the latest annual period." subtitle={latestEnd ? fyLabel(latestEnd) : undefined}
          color={f.net_profit_cr != null ? (f.net_profit_cr > 0 ? "green" : "red") : "default"} />
        <MetricCell label="EPS (TTM)" value={f.eps != null ? `₹${fmt(f.eps)}` : "–"} tooltip="Trailing twelve-month earnings per share." />
        {f.forward_eps != null && (
          <MetricCell label="Fwd EPS" value={`₹${fmt(f.forward_eps)}`} tooltip="Next-12-month analyst consensus EPS estimate." />
        )}
        <MetricCell label="Book Value/Share" value={f.book_value != null ? `₹${fmt(f.book_value)}` : "–"} tooltip="Net asset value per share (equity ÷ shares outstanding). Key reference for value investors and bank PB analysis." />
      </Section>

      {/* Data freshness footer */}
      {dataLabel && (
        <p className="text-[10px] text-muted/50 text-right">{dataLabel}</p>
      )}
    </div>
  );
}
