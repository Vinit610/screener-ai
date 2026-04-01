export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-white">
      <h1 className="text-4xl font-bold mb-4">screener-ai</h1>
      <p className="text-xl mb-8 text-center max-w-2xl">
        AI-first hybrid screener for self-directed Indian retail investors
      </p>
      <a
        href="/screener"
        className="bg-primary text-white px-6 py-3 rounded-lg hover:bg-primary/80 transition-colors"
      >
        → Open Screener
      </a>
    </div>
  );
}
