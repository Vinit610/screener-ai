import { notFound } from "next/navigation";
import StockDetailClient from "./StockDetailClient";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface PageProps {
  params: Promise<{ symbol: string }>;
}

async function fetchStockDetail(symbol: string) {
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/stocks/${encodeURIComponent(symbol)}`,
      { next: { revalidate: 1800 } }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function StockPage({ params }: PageProps) {
  const { symbol } = await params;
  const data = await fetchStockDetail(symbol.toUpperCase());

  if (!data) {
    notFound();
  }

  return <StockDetailClient data={data} symbol={symbol.toUpperCase()} />;
}