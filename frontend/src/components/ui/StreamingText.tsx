"use client";

interface StreamingTextProps {
  text: string;
  isStreaming: boolean;
}

export default function StreamingText({ text, isStreaming }: StreamingTextProps) {
  return (
    <span className={isStreaming ? "streaming-cursor" : ""}>
      {text}
    </span>
  );
}
