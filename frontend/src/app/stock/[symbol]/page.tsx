interface PageProps {
  params: Promise<{ symbol: string }>;
}

export default async function StockPage({ params }: PageProps) {
  const { symbol } = await params;

  return (
    <div className="flex items-center justify-center min-h-screen bg-background text-white">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Stock: {symbol}</h1>
        <p className="text-muted">Details coming soon...</p>
      </div>
    </div>
  );
}