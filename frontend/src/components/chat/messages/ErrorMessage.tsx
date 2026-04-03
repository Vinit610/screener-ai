"use client";

interface ErrorMessageProps {
  content: string;
  onRetry?: () => void;
}

export default function ErrorMessage({ content, onRetry }: ErrorMessageProps) {
  return (
    <div className="mr-auto max-w-[85%] rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      <p>{content}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 text-xs font-medium text-red-400 underline hover:text-red-300"
        >
          Retry
        </button>
      )}
    </div>
  );
}
