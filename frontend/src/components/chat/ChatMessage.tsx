"use client";

import type { ChatMessage } from "@/types";
import TextMessage from "./messages/TextMessage";
import FilterAppliedMessage from "./messages/FilterAppliedMessage";
import ErrorMessage from "./messages/ErrorMessage";

interface ChatMessageProps {
  message: ChatMessage;
  onRetry?: () => void;
}

export default function ChatMessageComponent({ message, onRetry }: ChatMessageProps) {
  if (message.type === "error") {
    return <ErrorMessage content={message.content} onRetry={onRetry} />;
  }

  if (message.type === "filter_applied") {
    return (
      <FilterAppliedMessage
        content={message.content}
        filters={message.filters}
        filterCount={message.filterCount}
        resultCount={message.resultCount}
      />
    );
  }

  return <TextMessage content={message.content} role={message.role} />;
}
