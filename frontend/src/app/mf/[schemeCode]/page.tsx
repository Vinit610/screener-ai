import { notFound } from "next/navigation";
import MFDetailClient from "./MFDetailClient";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

interface PageProps {
  params: Promise<{ schemeCode: string }>;
}

async function fetchMFDetail(schemeCode: string) {
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/mf/${encodeURIComponent(schemeCode)}`,
      { next: { revalidate: 300 } }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function MFDetailPage({ params }: PageProps) {
  const { schemeCode } = await params;
  const data = await fetchMFDetail(schemeCode);

  if (!data) {
    notFound();
  }

  return <MFDetailClient data={data} />;
}
