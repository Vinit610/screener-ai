"use client";

import { useChatStore } from "@/store/chatStore";
import ChatThread from "./ChatThread";
import ChatInput from "./ChatInput";

const SUGGESTED_PROMPTS = [
  "Show me profitable small-caps",
  "Analyze TCS fundamentals",
  "IT stocks with high ROE",
  "Is RELIANCE overvalued?",
  "What is a good PE ratio?",
];

export default function ChatPanel() {
  const { messages, isAIThinking, error, sendQuery, clearMessages } = useChatStore();

  const isEmpty = messages.length === 0;

  const handleRetry = () => {
    // Find the last user message and retry
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      sendQuery(lastUserMsg.content);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-white">AI Chat</h2>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearMessages}
            className="text-xs text-muted hover:text-white transition"
          >
            Clear
          </button>
        )}
      </div>

      {/* Thread or empty state */}
      {isEmpty && !isAIThinking ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
          <p className="text-sm text-muted">
            Ask anything about Indian stocks...
          </p>
          <div className="flex flex-col gap-2 w-full max-w-xs">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => sendQuery(prompt)}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-left text-xs text-gray-300 transition hover:border-primary/50 hover:text-white"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ChatThread
          messages={messages}
          isAIThinking={isAIThinking}
          onRetry={handleRetry}
        />
      )}

      {/* Error banner */}
      {error && (
        <div className="border-t border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Input */}
      <ChatInput
        onSend={sendQuery}
        disabled={false}
        isLoading={isAIThinking}
      />
    </div>
  );
}
