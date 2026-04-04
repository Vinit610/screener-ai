"use client";

import { useState, useCallback } from "react";

interface CSVUploaderProps {
  onUploadSuccess: () => void;
  backendUrl: string;
  token: string;
}

interface ParsedResult {
  parsed_holdings: {
    symbol: string;
    quantity: number;
    avg_buy_price: number;
    instrument_type: string;
  }[];
  broker_detected: string | null;
  count: number;
}

export default function CSVUploader({
  onUploadSuccess,
  backendUrl,
  token,
}: CSVUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<ParsedResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setResult(null);
      setIsUploading(true);

      const formData = new FormData();
      formData.append("file", file);

      try {
        const resp = await fetch(`${backendUrl}/api/portfolio/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (!resp.ok) {
          const data = await resp.json().catch(() => null);
          throw new Error(
            data?.detail || "Could not detect broker format. Try manual entry."
          );
        }

        const data: ParsedResult = await resp.json();
        setResult(data);
        onUploadSuccess();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setIsUploading(false);
      }
    },
    [backendUrl, token, onUploadSuccess]
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="space-y-4">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 transition ${
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-muted"
        }`}
      >
        <svg
          className="mb-3 h-10 w-10 text-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="text-sm text-muted">
          {isUploading
            ? "Uploading..."
            : "Drag & drop a CSV or XLSX file here"}
        </p>
        <p className="mt-1 text-xs text-muted/60">
          Supports Zerodha, Groww, Upstox formats
        </p>
        <label className="mt-4 cursor-pointer rounded bg-primary px-4 py-2 text-xs font-medium text-white transition hover:bg-primary/80">
          Browse Files
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={handleInputChange}
            disabled={isUploading}
          />
        </label>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Imported {result.count} holdings
            </h3>
            {result.broker_detected && (
              <span className="rounded bg-primary/20 px-2 py-0.5 text-xs text-primary">
                {result.broker_detected}
              </span>
            )}
          </div>
          <div className="max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="px-2 py-1 text-left">Symbol</th>
                  <th className="px-2 py-1 text-right">Qty</th>
                  <th className="px-2 py-1 text-right">Avg Price</th>
                </tr>
              </thead>
              <tbody>
                {result.parsed_holdings.map((h, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="px-2 py-1 font-medium">{h.symbol}</td>
                    <td className="px-2 py-1 text-right">{h.quantity}</td>
                    <td className="px-2 py-1 text-right">
                      ₹{h.avg_buy_price.toLocaleString("en-IN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
