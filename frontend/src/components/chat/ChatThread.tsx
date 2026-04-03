"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/types";
import ChatMessageComponent from "./ChatMessage";

interface ChatThreadProps {
  messages: ChatMessage[];
  isAIThinking: boolean;
  onRetry?: () => void;
}

export default function ChatThread({ messages, isAIThinking, onRetry }: ChatThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages or content updates (streaming)
  const lastMsgContent = messages[messages.length - 1]?.content;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isAIThinking, lastMsgContent]);

  // Only show thinking dots before the streaming starts (no assistant message yet after last user msg)
  const lastMsg = messages[messages.length - 1];
  const showThinking = isAIThinking && (!lastMsg || lastMsg.role === 'user');

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-4">
      {messages.map((msg) => (
        <ChatMessageComponent
          key={msg.id}
          message={msg}
          onRetry={onRetry}
        />
      ))}
      {showThinking && (
        <div className="mr-auto flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm text-muted">
          <span className="inline-flex gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
          </span>
          Thinking…
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
